import { Module } from '@nestjs/common';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * MetricsModule
 * Encapsulates metrics services and controllers
 */
@Module({
  providers: [PrometheusMetricsService],
  controllers: [MetricsController],
  exports: [PrometheusMetricsService],
})
export class MetricsModule {}
