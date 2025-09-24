import { Inject, Injectable, Optional } from '@nestjs/common'
import { RTF_WEEK_GOALS_CACHE } from './rtf-week-goals-cache.async'
import { InMemoryRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.provider'
import { RedisRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.redis.provider'
import { LayeredRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.layered.provider'

/**
 * Provides a unified metrics snapshot for the active RtF week goals cache driver.
 * Falls back gracefully if metrics method is absent.
 */
@Injectable()
export class CacheMetricsService {
	constructor(
		@Optional() private readonly memory?: InMemoryRtfWeekGoalsCacheProvider,
		@Optional() private readonly redis?: RedisRtfWeekGoalsCacheProvider,
		@Optional() private readonly layered?: LayeredRtfWeekGoalsCacheProvider
	) {}

	getWeekGoalsCacheMetrics() {
		const src = this.layered || this.redis || this.memory
		if (!src || typeof (src as any).getMetrics !== 'function') {
			return { driver: 'unknown', error: 'metrics_not_available' }
		}
		return (src as any).getMetrics()
	}
}
