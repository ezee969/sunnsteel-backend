import { Injectable } from '@nestjs/common'
import { Registry, collectDefaultMetrics, Counter, Gauge } from 'prom-client'
import { WorkoutsService } from '../workouts/workouts.service'
import { CacheMetricsService } from '../cache/cache-metrics.service'
import { RoutinesService } from '../routines/routines.service'

/**
 * PrometheusMetricsService
 * Exposes a registry with application + RtF cache / stampede metrics (RTF-B07).
 * Lightweight integration to avoid adding global interceptors prematurely.
 */
@Injectable()
export class PrometheusMetricsService {
  private readonly registry = new Registry()
  private readonly weekGoalsHitRate: Gauge
  private readonly layeredL1Size: Gauge
  private readonly forecastHitRate: Gauge
  private readonly stampedeWaits: Counter
  private readonly stampedeBypass: Counter
  private readonly tmAdjustments: Counter
  private readonly tmGuardrailRejects: Counter
  private readonly tmUnknownExerciseRejects: Counter
  private readonly tmOwnershipRejects: Counter

  private lastStampedeWaits = 0
  private lastStampedeBypass = 0
  private lastTmAdjustments = 0
  private lastTmGuardrailRejects = 0
  private lastTmUnknownExerciseRejects = 0
  private lastTmOwnershipRejects = 0

  constructor(
    private readonly workouts: WorkoutsService,
    private readonly cacheMetrics: CacheMetricsService,
    private readonly routines: RoutinesService
  ) {
    collectDefaultMetrics({ register: this.registry })

    this.weekGoalsHitRate = new Gauge({
      name: 'rtf_week_goals_hit_rate',
      help: 'Hit rate for week goals (derived)',
      registers: [this.registry]
    })
    this.layeredL1Size = new Gauge({
      name: 'rtf_layered_l1_entries',
      help: 'Current number of L1 cache entries',
      registers: [this.registry]
    })
    this.forecastHitRate = new Gauge({
      name: 'rtf_forecast_hit_rate',
      help: 'Hit rate for forecast cache (derived)',
      registers: [this.registry]
    })
    this.stampedeWaits = new Counter({
      name: 'rtf_stampede_wait_total',
      help: 'Total times a request waited on in-flight computation',
      registers: [this.registry]
    })
    this.stampedeBypass = new Counter({
      name: 'rtf_stampede_bypass_total',
      help: 'Total times a request executed factory (not waiting)',
      registers: [this.registry]
    })
    this.tmAdjustments = new Counter({
      name: 'rtf_tm_adjustments_total',
      help: 'Total TM adjustment events created',
      registers: [this.registry]
    })
    this.tmGuardrailRejects = new Counter({
      name: 'rtf_tm_guardrail_rejections_total',
      help: 'Total TM adjustments rejected by guardrails',
      registers: [this.registry]
    })
    this.tmUnknownExerciseRejects = new Counter({
      name: 'rtf_tm_unknown_exercise_rejections_total',
      help: 'Rejections due to missing/invalid exercise in routine',
      registers: [this.registry]
    })
    this.tmOwnershipRejects = new Counter({
      name: 'rtf_tm_routine_access_rejections_total',
      help: 'Rejections due to routine ownership/program issues',
      registers: [this.registry]
    })
  }

  /** Collect latest values into gauges/counters. */
  snapshot() {
    const w = this.workouts.getInternalMetrics()
    const cache = this.cacheMetrics.getWeekGoalsCacheMetrics() as any
    if (cache.driver === 'layered') {
      if (typeof cache.hitRate === 'number') {
        this.weekGoalsHitRate.set(cache.hitRate)
      }
      if (typeof cache.l1Size === 'number') {
        this.layeredL1Size.set(cache.l1Size)
      }
      if (typeof cache.l2Contribution === 'number' && typeof cache.hits === 'number' && typeof cache.gets === 'number') {
        // we rely on workouts internal metrics for forecast rate instead of layered cache here
      }
    }
    // Forecast hit rate (derived from internal metrics)
    const fTotal = w.forecastHits + w.forecastMisses
    if (fTotal > 0) {
      this.forecastHitRate.set(w.forecastHits / fTotal)
    }

    // Increment counters by delta since last snapshot
    if (w.stampedeWaits > this.lastStampedeWaits) this.stampedeWaits.inc(w.stampedeWaits - this.lastStampedeWaits)
    if (w.stampedeBypass > this.lastStampedeBypass) this.stampedeBypass.inc(w.stampedeBypass - this.lastStampedeBypass)
    this.lastStampedeWaits = w.stampedeWaits
    this.lastStampedeBypass = w.stampedeBypass

    // TM metrics
    const r = this.routines.getInternalMetrics?.() || {}
    const adj = r.tmAdjustmentsCreated || 0
    const gr = r.tmGuardrailRejections || 0
    const ex = r.tmUnknownExerciseRejections || 0
    const ow = r.tmOwnershipOrProgramRejections || 0

    if (adj > this.lastTmAdjustments) this.tmAdjustments.inc(adj - this.lastTmAdjustments)
    if (gr > this.lastTmGuardrailRejects) this.tmGuardrailRejects.inc(gr - this.lastTmGuardrailRejects)
    if (ex > this.lastTmUnknownExerciseRejects) this.tmUnknownExerciseRejects.inc(ex - this.lastTmUnknownExerciseRejects)
    if (ow > this.lastTmOwnershipRejects) this.tmOwnershipRejects.inc(ow - this.lastTmOwnershipRejects)
    this.lastTmAdjustments = adj
    this.lastTmGuardrailRejects = gr
    this.lastTmUnknownExerciseRejects = ex
    this.lastTmOwnershipRejects = ow
  }

  async metricsText() {
    this.snapshot()
    return await this.registry.metrics()
  }
}
