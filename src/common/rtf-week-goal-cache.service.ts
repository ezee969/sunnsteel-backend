import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

interface CacheEntry<T> { value: T; expiresAt: number }

/**
 * Simple in-memory TTL cache for RtF week goals.
 * Key: weekGoals:${routineId}:${week}
 * Env: RTF_WEEK_GOAL_TTL_SEC (default 600 seconds)
 */
@Injectable()
export class RtfWeekGoalCacheService {
	private readonly logger = new Logger(RtfWeekGoalCacheService.name)
	private store = new Map<string, CacheEntry<unknown>>()
	private ttlMs: number

	constructor(config: ConfigService) {
		const ttlSec = Number(config.get('RTF_WEEK_GOAL_TTL_SEC') ?? 600)
		this.ttlMs = isNaN(ttlSec) ? 600_000 : ttlSec * 1000
	}

	private now() { return Date.now() }

	makeKey(routineId: string, week: number) { return `weekGoals:${routineId}:${week}` }

	get<T>(key: string): T | null {
		const entry = this.store.get(key)
		if (!entry) return null
		if (entry.expiresAt < this.now()) { this.store.delete(key); return null }
		return entry.value as T
	}

	set<T>(key: string, value: T) {
		const expiresAt = this.now() + this.ttlMs
		this.store.set(key, { value, expiresAt })
	}

	invalidateRoutine(routineId: string) {
		let removed = 0
		for (const key of this.store.keys()) {
			if (key.startsWith(`weekGoals:${routineId}:`)) { this.store.delete(key); removed++ }
		}
		if (removed > 0) this.logger.debug(`Invalidated ${removed} RtF week goal cache entries for routine ${routineId}`)
	}

	_stats() { return { size: this.store.size, ttlMs: this.ttlMs } }
}
