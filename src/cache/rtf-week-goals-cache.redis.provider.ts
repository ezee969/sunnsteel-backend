import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { IRtfWeekGoalsCacheAsync } from './rtf-week-goals-cache.async'
// We type against redis client shape but keep dependency optional unless configured.
// If redis package is not installed, compilation will fail only if this provider is imported.
// For safety in current phase, we avoid importing runtime from 'redis' directly unless enabled.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClientType = any

/**
 * RTF-B04 Phase 2: Redis Implementation (Optional)
 *
 * Drop-in replacement for the in-memory provider. All methods are async-capable
 * but preserve the IRtfWeekGoalsCacheProvider sync signature by returning void
 * or values when awaited by an adapter wrapper (planned). For now we expose
 * async methods and keep WorkoutsService using the in-memory provider.
 * A future refactor (Phase 2b) will introduce an async-aware interface.
 */
@Injectable()
export class RedisRtfWeekGoalsCacheProvider implements IRtfWeekGoalsCacheAsync, OnModuleDestroy {
	private readonly logger = new Logger('RtfWeekGoalsRedisCache')
	private client?: RedisClientType
	private defaultTtlSec: number
	private ready = false
	private metrics = {
		gets: 0,
		hits: 0,
		misses: 0,
		sets: 0,
		deletes: 0,
		invalidations: 0,
		startedAt: Date.now()
	}

	constructor(@Optional() client?: RedisClientType) {
		const raw = process.env.RTF_WEEK_GOAL_TTL_SEC
		const sec = raw ? Number(raw) : 600
		this.defaultTtlSec = !isNaN(sec) ? sec : 600
		if (client) {
			this.client = client
			this.ready = true
			this.logger.log(`Redis RtF cache wired TTL=${this.defaultTtlSec}s`)
		} else {
			this.logger.warn('Redis client not injected; provider acts as NO-OP')
		}
	}

	private ensure() { return this.ready && this.client }

	async get<T = any>(key: string): Promise<T | null> {
		this.metrics.gets++
		if (!this.ensure()) return null
		try {
			const raw = await this.client!.get(key)
			if (!raw) return null
			this.metrics.hits++
			return JSON.parse(raw) as T
		} catch (err) {
			this.logger.error(`get failed key=${key}`, err as any)
			return null
		}
	}

	async set<T = any>(key: string, value: T, ttlMs?: number): Promise<void> {
		if (!this.ensure()) return
		const ttlSec = Math.ceil((ttlMs ?? this.defaultTtlSec * 1000) / 1000)
		try {
			await this.client!.set(key, JSON.stringify(value), { EX: ttlSec })
			this.metrics.sets++
		} catch (err) {
			this.logger.error(`set failed key=${key}`, err as any)
		}
	}

	async delete(key: string): Promise<void> {
		if (!this.ensure()) return
		try { await this.client!.del(key); this.metrics.deletes++ } catch (err) { this.logger.error(`delete failed key=${key}`, err as any) }
	}

	async invalidateRoutine(routineId: string): Promise<void> {
		if (!this.ensure()) return
		try {
			const pattern = `weekGoals:${routineId}:*`
			let cursor = '0'
			let total = 0
			do {
				// Using SCAN to avoid blocking Redis
				const res: any = await this.client!.scan(cursor, { MATCH: pattern, COUNT: 100 })
				cursor = res.cursor || res[0]
				const keys: string[] = res.keys || res[1] || []
				if (keys.length) {
					await this.client!.del(keys)
					total += keys.length
				}
			} while (cursor !== '0')
			if (total > 0) this.logger.log(`Invalidated ${total} Redis week-goal keys for routine ${routineId}`)
			if (total > 0) this.metrics.invalidations++
		} catch (err) {
			this.logger.error(`invalidateRoutine failed routineId=${routineId}`, err as any)
		}
	}

	getMetrics() {
		return { driver: 'redis', ...this.metrics, uptimeMs: Date.now() - this.metrics.startedAt }
	}

	onModuleDestroy() {
		if (this.client) {
			try { this.client.quit() } catch {}
		}
	}
}
