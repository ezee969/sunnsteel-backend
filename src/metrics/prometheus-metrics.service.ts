import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * PrometheusMetricsService
 * Exposes a registry with default Node.js process metrics.
 */
@Injectable()
export class PrometheusMetricsService {
  private readonly registry = new Registry();

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  async metricsText() {
    return await this.registry.metrics();
  }
}
