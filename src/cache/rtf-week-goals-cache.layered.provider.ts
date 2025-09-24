import { Injectable, Logger } from '@nestjs/common'
import { IRtfWeekGoalsCacheAsync } from './rtf-week-goals-cache.async'
import { RedisRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.redis.provider'

/**
 * RTF-B10 (Phase 1): Layered cache (L1 in-memory + L2 Redis)
 *
 * Goals:
 *  - Reduce latency for hot keys (short lived L1, e.g. 5s) while keeping
 *    longer TTL persistence / larger capacity in Redis.
 *  - Provide transparent drop-in replacement for existing async cache token.
 *  - Maintain simple metrics distinguishing L1 vs L2 hit paths.
 *
 * Design notes:
 *  - L1 uses a tiny custom map with monotonic expiry timestamps.
 *  - We keep L1 TTL intentionally small to avoid stale bursts after routine
 *    mutation (invalidation clears both layers; worst-case stale window = L1 TTL).
 *  - Invalidation pattern must mirror existing key strategy weekGoals:{routineId}:{week}
 *    plus forecast:{routineId}:v{version} keys (we invalidate only weekGoals on routine changes
 *    consistent with current routines.service logic).
 */
@Injectable()
export class LayeredRtfWeekGoalsCacheProvider implements IRtfWeekGoalsCacheAsync {
  private readonly logger = new Logger('RtfWeekGoalsLayeredCache')
  private readonly l1 = new Map<string, { value: any; expiresAt: number }>()
  private readonly l1TtlMs: number
  private metrics = {
    driver: 'layered',
    gets: 0,
    hits: 0,
    misses: 0,
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0,
    stampedeWaits: 0,
    stampedeBypass: 0,
    startedAt: Date.now()
  }

  constructor(private readonly l2: RedisRtfWeekGoalsCacheProvider) {
    const raw = process.env.RTF_WEEK_GOALS_L1_TTL_MS
    const ttl = raw ? Number(raw) : 5000
    this.l1TtlMs = !isNaN(ttl) && ttl > 0 ? ttl : 5000
    this.logger.log(`Layered RtF cache active L1 TTL=${this.l1TtlMs}ms (L2=redis)`)    
  }

  private isExpired(entry: { expiresAt: number }) { return entry.expiresAt < Date.now() }

  async get<T = any>(key: string): Promise<T | null> {
    this.metrics.gets++
    const entry = this.l1.get(key)
    if (entry) {
      if (!this.isExpired(entry)) {
        this.metrics.hits++
        this.metrics.l1Hits++
        return entry.value as T
      }
      // expired
      this.l1.delete(key)
      this.metrics.l1Misses++
    } else {
      this.metrics.l1Misses++
    }
    // L1 miss -> check L2
    const fromL2 = await this.l2.get<T>(key)
    if (fromL2) {
      this.metrics.hits++
      this.metrics.l2Hits++
      // refresh into L1
      this.l1.set(key, { value: fromL2, expiresAt: Date.now() + this.l1TtlMs })
      return fromL2
    }
    this.metrics.misses++
    return null
  }

  async set<T = any>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.metrics.sets++
    // Write through: first L2, then L1 (L1 TTL independent / short)
    await this.l2.set(key, value, ttlMs)
    this.l1.set(key, { value, expiresAt: Date.now() + this.l1TtlMs })
  }

  async delete(key: string): Promise<void> {
    this.l1.delete(key)
    await this.l2.delete(key)
    this.metrics.deletes++
  }

  async invalidateRoutine(routineId: string): Promise<void> {
    // Clear matching L1 keys
    let removed = 0
    for (const k of this.l1.keys()) {
      if (k.startsWith(`weekGoals:${routineId}:`)) {
        this.l1.delete(k)
        removed++
      }
    }
    if (removed > 0) this.logger.log(`L1 invalidated ${removed} keys for routine ${routineId}`)
    await this.l2.invalidateRoutine(routineId)
    if (removed > 0) this.metrics.invalidations++
  }

  getMetrics() {
    const { gets, hits, l1Hits, l2Hits, stampedeWaits } = this.metrics
    const hitRate = gets > 0 ? hits / gets : 0
    const l1HitRate = hits > 0 ? l1Hits / hits : 0
    const l2Contribution = hits > 0 ? l2Hits / hits : 0
    return {
      ...this.metrics,
      hitRate,
      l1HitRate,
      l2Contribution,
      uptimeMs: Date.now() - this.metrics.startedAt,
      l1Size: this.l1.size
    }
  }
}
