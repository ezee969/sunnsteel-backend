import { Module } from '@nestjs/common'
import { PrometheusMetricsService } from './prometheus-metrics.service'
import { MetricsController } from './metrics.controller'
import { WorkoutsModule } from '../workouts/workouts.module'
import { RoutinesModule } from '../routines/routines.module'
import { CacheModule } from '../cache/cache.module'

/**
 * MetricsModule
 * Encapsulates metrics services and controllers with proper dependencies
 */
@Module({
	imports: [WorkoutsModule, RoutinesModule, CacheModule],
	providers: [PrometheusMetricsService],
	controllers: [MetricsController],
	exports: [PrometheusMetricsService]
})
export class MetricsModule {}