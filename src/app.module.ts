import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import type { IncomingHttpHeaders } from 'node:http';
import { clientIp } from './common/client-ip';
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
import { ScheduleOverridesModule } from './schedule/schedule-overrides.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { MetricsModule } from './metrics/metrics.module';
import { HealthModule } from './health/health.module';
import { AchievementsModule } from './achievements/achievements.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './notifications/push/push.module';
import { ActivityModule } from './activity/activity.module';
import { ModerationModule } from './moderation/moderation.module';

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
        // TD-46. The default tracker is `req.ip`, which behind Railway is a
        // rotating internal hop rather than the caller -- see `clientIp`. Left
        // as the default the limit is configured but not enforced.
        getTracker: (req: Record<string, any>) =>
          Promise.resolve(
            clientIp(
              (req.headers ?? {}) as IncomingHttpHeaders,
              req.ip as string | undefined,
            ),
          ),
      },
    ]),
    AuthModule,
    UsersModule,
    TokenModule,
    ScheduleModule.forRoot(),
    ExercisesModule,
    RoutinesModule,
    ScheduleOverridesModule,
    WorkoutsModule,
    MetricsModule,
    HealthModule,
    AchievementsModule,
    NotificationsModule,
    PushModule,
    ActivityModule,
    ModerationModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
