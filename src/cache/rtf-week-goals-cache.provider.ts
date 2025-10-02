import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * RTF-B04 External Cache Abstraction (Phase 1: Interface + In-memory default)
 *
 * This provider abstracts week-goals caching behind a minimal contract so we
 * can later swap to Redis/Upstash without touching domain logic.
 *
 * Key strategy remains: weekGoals:${routineId}:${week}
 * Value: Arbitrary serializable object (currently the week goals payload)
 */
export interface IRtfWeekGoalsCacheProvider {
  get<T = any>(key: string): T | null;
  set<T = any>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  invalidateRoutine(routineId: string): void;
}

@Injectable()
export class InMemoryRtfWeekGoalsCacheProvider
  implements IRtfWeekGoalsCacheProvider, OnModuleDestroy
{
  private readonly logger = new Logger('RtfWeekGoalsCache');
  private store = new Map<string, { expiresAt: number; value: any }>();
  private defaultTtlMs: number;
  private metrics = {
    gets: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0,
    startedAt: Date.now(),
  };

  constructor() {
    const raw = process.env.RTF_WEEK_GOAL_TTL_SEC;
    const sec = raw ? Number(raw) : 600;
    this.defaultTtlMs = (!isNaN(sec) ? sec : 600) * 1000;
    this.logger.log(
      `Initialized in-memory RtF cache TTL=${this.defaultTtlMs}ms`,
    );
  }

  private isExpired(entry: { expiresAt: number }) {
    return entry.expiresAt < Date.now();
  }

  // --- Sync (deprecated) ---
  get<T = any>(key: string): T | null {
    this.metrics.gets++;
    const entry = this.store.get(key);
    if (!entry) {
      this.metrics.misses++;
      return null;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.metrics.misses++;
      return null;
    }
    this.metrics.hits++;
    return entry.value as T;
  }

  set<T = any>(key: string, value: T, ttlMs?: number): void {
    this.metrics.sets++;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  invalidateRoutine(routineId: string): void {
    let removed = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(`weekGoals:${routineId}:`)) {
        this.store.delete(k);
        removed++;
      }
    }
    if (removed > 0)
      this.logger.log(`Invalidated ${removed} keys for routine ${routineId}`);
    if (removed > 0) this.metrics.invalidations++;
  }

  // Metrics snapshot used by telemetry service
  getMetrics() {
    return {
      driver: 'memory',
      ...this.metrics,
      uptimeMs: Date.now() - this.metrics.startedAt,
    };
  }

  onModuleDestroy() {
    this.store.clear();
  }
}
