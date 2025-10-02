import { Global, Module } from '@nestjs/common';
import { InMemoryRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.provider';
import { RedisRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.redis.provider';
import {
  AsyncRtfWeekGoalsCacheAdapter,
  RTF_WEEK_GOALS_CACHE,
} from './rtf-week-goals-cache.async';
import { CacheMetricsService } from './cache-metrics.service';
import { LayeredRtfWeekGoalsCacheProvider } from './rtf-week-goals-cache.layered.provider';

// Lazy import createClient to avoid hard dependency when Redis not used
let redisFactory: any = null;
try {
  const redis = require('redis');
  redisFactory = redis.createClient;
} catch {
  // redis package not installed or not desired; silently ignore
}

const cacheDriver = process.env.RTF_CACHE_DRIVER?.toLowerCase() || 'memory';
const useRedis = cacheDriver === 'redis' && redisFactory;
const layeredEnabled = (process.env.RTF_CACHE_LAYERED ?? '1') !== '0';

function buildProviders() {
  if (useRedis) {
    const url = process.env.RTF_REDIS_URL || undefined;
    return [
      {
        provide: RedisRtfWeekGoalsCacheProvider,
        useFactory: async () => {
          const client = redisFactory({ url });
          await client.connect();
          return new RedisRtfWeekGoalsCacheProvider(client);
        },
      },
      // When layered enabled, wrap redis with layered provider (L1 + L2)
      ...(layeredEnabled
        ? [
            {
              provide: LayeredRtfWeekGoalsCacheProvider,
              useFactory: (r: RedisRtfWeekGoalsCacheProvider) =>
                new LayeredRtfWeekGoalsCacheProvider(r),
              inject: [RedisRtfWeekGoalsCacheProvider],
            },
            {
              provide: RTF_WEEK_GOALS_CACHE,
              useExisting: LayeredRtfWeekGoalsCacheProvider,
            },
          ]
        : [
            {
              provide: RTF_WEEK_GOALS_CACHE,
              useExisting: RedisRtfWeekGoalsCacheProvider,
            },
          ]),
    ];
  }
  return [
    InMemoryRtfWeekGoalsCacheProvider,
    {
      provide: AsyncRtfWeekGoalsCacheAdapter,
      useFactory: (m: InMemoryRtfWeekGoalsCacheProvider) =>
        new AsyncRtfWeekGoalsCacheAdapter(m),
      inject: [InMemoryRtfWeekGoalsCacheProvider],
    },
    {
      provide: RTF_WEEK_GOALS_CACHE,
      useExisting: AsyncRtfWeekGoalsCacheAdapter,
    },
  ];
}

// Global cache module so all feature modules share a single instance
// of the in-memory RtF week goals cache (RTF-B04 Phase 1.5 singleton)
@Global()
@Module({
  providers: [...buildProviders(), CacheMetricsService],
  exports: [RTF_WEEK_GOALS_CACHE, CacheMetricsService],
})
export class CacheModule {}
