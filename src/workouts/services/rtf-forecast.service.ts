import { Injectable, Inject } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RTF_WEEK_GOALS_CACHE, IRtfWeekGoalsCacheAsync } from '../../cache/rtf-week-goals-cache.async';

@Injectable()
export class RtfForecastService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(RTF_WEEK_GOALS_CACHE)
    private readonly rtfCache: IRtfWeekGoalsCacheAsync,
  ) {}

  public static readonly RTF_WEEK_GOALS_VERSION = 1;

  public cacheKey(routineId: string, week: number) {
    return `weekGoals:${routineId}:${week}`;
  }

  public forecastCacheKey(routineId: string, remainingOnly = false) {
    const suffix = remainingOnly ? ':rem' : '';
    return `forecast:${routineId}:v${RtfForecastService.RTF_WEEK_GOALS_VERSION}${suffix}`;
  }

  public async cacheGet(key: string) {
    return this.rtfCache.get(key);
  }

  public async cacheSet(key: string, value: any) {
    await this.rtfCache.set(key, value);
  }

  private metrics = {
    stampedeWaits: 0,
    stampedeBypass: 0,
    forecastSets: 0,
    forecastHits: 0,
    forecastMisses: 0,
    weekGoalsSets: 0,
    weekGoalsHits: 0,
    weekGoalsMisses: 0,
    startedAt: Date.now(),
  };

  public getInternalMetrics() {
    const uptimeMs = Date.now() - this.metrics.startedAt;
    return { ...this.metrics, uptimeMs };
  }

  public static inFlight = new Map<string, Promise<any>>();
  
  public async withStampedeProtection<T>(
    key: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    if (RtfForecastService.inFlight.has(key)) {
      this.metrics.stampedeWaits++;
      return RtfForecastService.inFlight.get(key) as Promise<T>;
    }
    this.metrics.stampedeBypass++;
    const p = factory().finally(() => {
      RtfForecastService.inFlight.delete(key);
    });
    RtfForecastService.inFlight.set(key, p as Promise<any>);
    return p;
  }
}
