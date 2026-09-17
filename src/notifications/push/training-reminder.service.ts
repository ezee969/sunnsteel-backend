import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  PushPayload,
  StreakAtRiskPushPayload,
  TrainingReminderPushPayload,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { PushConfigService } from './push-config.service';
import { isWithinReminderWindow, localClock } from './local-time';
import { ScheduledPushService } from './scheduled-push.service';
import { describeStreakRisk, streakAtRisk } from './streak-risk';
import { describePlannedRoutines, routinesPlannedOn } from './training-days';

/**
 * How late a reminder may still go out. The planner ticks more often than this,
 * so a restart or a slow tick does not drop the day; the per-date dedupe key is
 * what keeps it to one.
 */
export const REMINDER_WINDOW_MINUTES = 10;

/**
 * NOTIF-04. A reminder on the days an account is planned to train, at a time
 * the owner picked.
 *
 * It is not "before your session": a routine day carries a weekday and nothing
 * records an intended hour, so there is no session time to count back from.
 * Guessing one from history would present an inference as a schedule.
 */
@Injectable()
export class TrainingReminderService {
  private readonly logger = new Logger(TrainingReminderService.name);
  private planning = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly scheduled: ScheduledPushService,
    private readonly config: PushConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async planDueReminders(): Promise<void> {
    if (this.planning || !this.config.isConfigured) return;
    this.planning = true;
    try {
      // Only accounts that chose a time, left the category on, registered a
      // zone and have somewhere to deliver. Everyone else costs one predicate.
      const candidates = await this.db.user.findMany({
        where: {
          reminderMinuteOfDay: { not: null },
          // Either category is reason enough to look; which one fires is
          // decided per account once the day is known.
          OR: [{ notifyTrainingReminder: true }, { notifyStreakAtRisk: true }],
          timeZone: { not: null },
          pushSubscriptions: { some: {} },
        },
        select: {
          id: true,
          timeZone: true,
          reminderMinuteOfDay: true,
          notifyTrainingReminder: true,
          notifyStreakAtRisk: true,
        },
      });

      const now = new Date();
      for (const candidate of candidates) {
        await this.planFor(candidate, now).catch((error: unknown) => {
          // One account's bad time zone must not stop everyone else's reminder.
          this.logger.warn(
            `Reminder planning failed for one account: ${String(error)}`,
          );
        });
      }
    } catch (error) {
      this.logger.error(`Reminder planning sweep failed: ${String(error)}`);
    } finally {
      this.planning = false;
    }
  }

  private async planFor(
    candidate: {
      id: string;
      timeZone: string | null;
      reminderMinuteOfDay: number | null;
      notifyTrainingReminder: boolean;
      notifyStreakAtRisk: boolean;
    },
    now: Date,
  ): Promise<void> {
    const userId = candidate.id;
    const timeZone = candidate.timeZone!;
    const reminderMinuteOfDay = candidate.reminderMinuteOfDay!;
    const clock = localClock(now, timeZone);
    if (
      !isWithinReminderWindow(
        clock.minuteOfDay,
        reminderMinuteOfDay,
        REMINDER_WINDOW_MINUTES,
      )
    ) {
      return;
    }

    const dedupeKey = `reminder:${clock.date}`;
    const existing = await this.db.scheduledPush.findFirst({
      where: { userId, dedupeKey },
      select: { id: true },
    });
    // Already planned this local date, inside this window or an earlier tick.
    if (existing) return;

    const payload = await this.payloadFor(userId, clock.date, candidate);
    if (!payload) return;

    // `sendAt` is now: the window already decided this is the moment, and the
    // existing sweep is the single path every push leaves by.
    // The payload's kind is the category, so suppression at send needs no
    // second field to carry it.
    await this.scheduled.schedule({ userId, dedupeKey, sendAt: now, payload });
  }

  /**
   * NOTIF-06 takes precedence over NOTIF-04 and replaces it: one push a day,
   * carrying whichever fact matters more. A streak on its last day is worth
   * saying on a planned day and on an unplanned one, which is exactly what
   * makes it worth having beside the reminder.
   */
  private async payloadFor(
    userId: string,
    date: string,
    categories: { notifyTrainingReminder: boolean; notifyStreakAtRisk: boolean },
  ): Promise<PushPayload | null> {
    const trainedToday = await this.hasSessionOn(userId, date);

    if (categories.notifyStreakAtRisk) {
      const projection = await this.db.workoutAnalyticsProjection.findFirst({
        where: { userId },
        select: { lastTrainingDate: true, currentRun: true },
      });
      const risk = streakAtRisk({
        today: date,
        lastTrainingDate: projection?.lastTrainingDate ?? null,
        currentRun: projection?.currentRun ?? 0,
        trainedToday,
      });
      if (risk) {
        const payload: StreakAtRiskPushPayload = {
          kind: 'STREAK_AT_RISK',
          title: 'Your streak ends after today',
          body: describeStreakRisk(risk),
          url: '/progress',
          tag: `reminder-${date}`,
        };
        return payload;
      }
    }

    if (!categories.notifyTrainingReminder) return null;
    if (trainedToday) return null;

    const planned = await this.plannedRoutineNames(userId, date);
    if (planned.length === 0) return null;

    const payload: TrainingReminderPushPayload = {
      kind: 'TRAINING_REMINDER',
      title: 'Training day',
      body: `${describePlannedRoutines(planned)} is planned for today.`,
      url: '/schedule',
      tag: `reminder-${date}`,
    };
    return payload;
  }

  private async hasSessionOn(userId: string, date: string): Promise<boolean> {
    const session = await this.db.workoutSession.findFirst({
      where: {
        userId,
        startedAt: {
          gte: new Date(`${date}T00:00:00.000Z`),
          lte: new Date(`${date}T23:59:59.999Z`),
        },
      },
      select: { id: true },
    });
    return session !== null;
  }

  private async plannedRoutineNames(
    userId: string,
    date: string,
  ): Promise<string[]> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const [routines, overrides, sessions] = await Promise.all([
      this.db.routine.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          scheduleMode: true,
          isCompleted: true,
          createdAt: true,
          restDays: true,
          rotationWeekdays: true,
          days: { select: { dayOfWeek: true } },
        },
      }),
      this.db.scheduleOverride.findMany({
        where: { userId, OR: [{ date }, { toDate: date }] },
        select: { routineId: true, kind: true, date: true, toDate: true },
      }),
      // A day already trained needs no reminder. The bounds are the account's
      // local date widened to UTC, which is deliberately generous: a session
      // just outside it only costs one unnecessary reminder, never a wrong one.
      this.db.workoutSession.findMany({
        where: { userId, startedAt: { gte: dayStart, lte: dayEnd } },
        select: { routineId: true },
      }),
    ]);

    return routinesPlannedOn({
      date,
      routines: routines.map((routine) => ({
        ...routine,
        scheduleMode: routine.scheduleMode as 'WEEKLY' | 'ROTATION',
      })),
      overrides: overrides.map((override) => ({
        routineId: override.routineId,
        kind: override.kind as 'MOVE' | 'SKIP',
        date: override.date,
        toDate: override.toDate,
      })),
      // A quick workout has no routine; it cannot satisfy a planned routine.
      routineIdsTrainedOnDate: sessions
        .map((session) => session.routineId)
        .filter((id): id is string => id !== null),
    });
  }
}
