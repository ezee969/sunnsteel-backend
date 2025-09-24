import { Injectable } from '@nestjs/common'
import { InMemoryRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.provider'

export interface IRtfWeekGoalsCacheAsync {
	get<T = any>(key: string): Promise<T | null>
	set<T = any>(key: string, value: T, ttlMs?: number): Promise<void>
	delete(key: string): Promise<void>
	invalidateRoutine(routineId: string): Promise<void>
}

export const RTF_WEEK_GOALS_CACHE = 'RTF_WEEK_GOALS_CACHE'

/**
 * Async adapter over the legacy in-memory synchronous provider.
 * Keeps existing logic while exposing Promise-based API.
 */
@Injectable()
export class AsyncRtfWeekGoalsCacheAdapter implements IRtfWeekGoalsCacheAsync {
	constructor(private readonly inner: InMemoryRtfWeekGoalsCacheProvider) {}
	async get<T = any>(key: string): Promise<T | null> { return this.inner.get<T>(key) }
	async set<T = any>(key: string, value: T, ttlMs?: number): Promise<void> { this.inner.set(key, value, ttlMs) }
	async delete(key: string): Promise<void> { this.inner.delete(key) }
	async invalidateRoutine(routineId: string): Promise<void> { this.inner.invalidateRoutine(routineId) }
}
