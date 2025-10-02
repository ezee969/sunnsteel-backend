import { Controller, Get, Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { TokenModule } from './token/token.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ExercisesModule } from './exercises/exercises.module';
import { RoutinesModule } from './routines/routines.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { CacheModule } from './cache/cache.module';
import { CacheMetricsService } from './cache/cache-metrics.service';
import { MetricsModule } from './metrics/metrics.module';

// Add this to your existing app.module.ts
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

@Controller('internal/cache-metrics')
export class CacheMetricsController {
  constructor(private readonly metrics: CacheMetricsService) {}
  @Get()
  getMetrics() {
    return { weekGoals: this.metrics.getWeekGoalsCacheMetrics() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    PassportModule,
    ThrottlerModule.forRoot([
      {
        name: 'long',
        ttl: 60000,
        limit: 100,
      },
    ]),
    AuthModule,
    UsersModule,
    TokenModule,
    ScheduleModule.forRoot(),
    ExercisesModule,
    // Global cache (RTF-B04) needs early import so feature modules share
    // singleton instance for RtF week goals cache provider
    CacheModule,
    RoutinesModule,
    WorkoutsModule,
    MetricsModule,
  ],
  controllers: [HealthController, CacheMetricsController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
