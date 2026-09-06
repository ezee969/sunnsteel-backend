import { Injectable } from '@nestjs/common';
import { WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { WorkoutProgressQueryDto } from './dto/workout-progress.dto';
import {
  PersonalRecordEntry,
  RecentActivityEntry,
  WorkoutProgressResponse,
} from './workout-progress.types';
import { dayNameFrom } from './workout-session.selects';

/**
 * Largest gap, in calendar days, between two training days that still counts as
 * one unbroken streak. Lifting is 3-5x/week, so a day-for-day streak would
 * break on every planned rest day; three days keeps a Fri -> Mon split intact
 * while a skipped week (gap >= 7) still ends the run.
 */
const MAX_STREAK_GAP_DAYS = 3;

const MS_PER_DAY = 86_400_000;

/** How many personal records / recent sessions the dashboard renders. */
const PR_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 5;

function differenceInDays(laterISODate: string, earlierISODate: string): number {
  return Math.round(
    (Date.parse(`${laterISODate}T00:00:00Z`) -
      Date.parse(`${earlierISODate}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/**
 * Counts training days in the most recent unbroken chain, and the longest such
 * chain in the whole history.
 *
 * `trainingDates` are `YYYY-MM-DD` strings in the user's timezone, and may
 * arrive unsorted and with duplicates (several sessions in one day).
 */
export function computeStreaks(
  trainingDates: string[],
  todayISODate: string,
): { current: number; best: number } {
  const days = [...new Set(trainingDates)].sort();
  if (days.length === 0) return { current: 0, best: 0 };

  let best = 1;
  let run = 1;
  // Track the run length as of the final day so `current` reuses this pass.
  for (let i = 1; i < days.length; i += 1) {
    const gap = differenceInDays(days[i], days[i - 1]);
    run = gap <= MAX_STREAK_GAP_DAYS ? run + 1 : 1;
    if (run > best) best = run;
  }

  // The chain is only "current" if the last session is recent enough that the
  // next one could still land inside the tolerance window.
  const sinceLastSession = differenceInDays(todayISODate, days[days.length - 1]);
  const current = sinceLastSession <= MAX_STREAK_GAP_DAYS ? run : 0;

  return { current, best };
}

@Injectable()
export class WorkoutProgressService {
  constructor(private readonly db: DatabaseService) {}

  async getProgress(
    userId: string,
    query: WorkoutProgressQueryDto,
  ): Promise<WorkoutProgressResponse> {
    const [setLogs, recentSessions, sessionDates] = await Promise.all([
      // Every completed set the user has logged. Volume and PRs are both folded
      // from this one read rather than two aggregate round trips.
      this.db.setLog.findMany({
        where: {
          isCompleted: true,
          weight: { not: null },
          reps: { not: null },
          session: { userId, status: WorkoutSessionStatus.COMPLETED },
        },
        select: {
          exerciseId: true,
          weight: true,
          reps: true,
          completedAt: true,
          session: { select: { endedAt: true } },
          exercise: { select: { name: true } },
        },
      }),
      this.db.workoutSession.findMany({
        where: { userId, status: WorkoutSessionStatus.COMPLETED },
        orderBy: { endedAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
          routine: { select: { id: true, name: true } },
          routineDay: { select: { dayOfWeek: true } },
          setLogs: {
            where: { isCompleted: true },
            select: { weight: true, reps: true },
          },
        },
      }),
      this.db.workoutSession.findMany({
        where: {
          userId,
          status: WorkoutSessionStatus.COMPLETED,
          endedAt: { not: null },
        },
        select: { endedAt: true },
      }),
    ]);

    const totalVolumeKg = setLogs.reduce(
      (sum, log) => sum + (log.weight ?? 0) * (log.reps ?? 0),
      0,
    );

    // `en-CA` yields YYYY-MM-DD, which sorts and diffs as a plain string.
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: query.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const { current, best } = computeStreaks(
      sessionDates.map((row) => dateFormatter.format(row.endedAt!)),
      dateFormatter.format(new Date()),
    );

    return {
      totalVolumeKg: Math.round(totalVolumeKg),
      currentStreakDays: current,
      bestStreakDays: best,
      personalRecords: this.foldPersonalRecords(setLogs),
      recentActivity: recentSessions.map(
        (session): RecentActivityEntry => ({
          sessionId: session.id,
          routineId: session.routine.id,
          routineName: session.routine.name,
          dayName: dayNameFrom(session.routineDay.dayOfWeek),
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt?.toISOString() ?? null,
          durationSec: session.durationSec,
          totalVolumeKg: Math.round(
            session.setLogs.reduce(
              (sum, log) => sum + (log.weight ?? 0) * (log.reps ?? 0),
              0,
            ),
          ),
          completedSets: session.setLogs.length,
        }),
      ),
    };
  }

  /**
   * Heaviest completed set per exercise, most recently set record first — so
   * the dashboard reads as "what I've recently got stronger at" rather than a
   * static all-time table. Ties on weight break toward the higher rep count.
   */
  private foldPersonalRecords(
    setLogs: {
      exerciseId: string;
      weight: number | null;
      reps: number | null;
      completedAt: Date | null;
      session: { endedAt: Date | null };
      exercise: { name: string };
    }[],
  ): PersonalRecordEntry[] {
    const bestByExercise = new Map<string, PersonalRecordEntry>();

    for (const log of setLogs) {
      const weight = log.weight ?? 0;
      const reps = log.reps ?? 0;
      if (weight <= 0 || reps <= 0) continue;

      const achievedAt = log.completedAt ?? log.session.endedAt;
      if (!achievedAt) continue;

      const incumbent = bestByExercise.get(log.exerciseId);
      const beatsIncumbent =
        !incumbent ||
        weight > incumbent.weight ||
        (weight === incumbent.weight && reps > incumbent.reps);
      if (!beatsIncumbent) continue;

      bestByExercise.set(log.exerciseId, {
        exerciseId: log.exerciseId,
        exerciseName: log.exercise.name,
        weight,
        reps,
        estimated1rm: Math.round(weight * (1 + reps / 30) * 10) / 10,
        achievedAt: achievedAt.toISOString(),
      });
    }

    return [...bestByExercise.values()]
      .sort((a, b) => Date.parse(b.achievedAt) - Date.parse(a.achievedAt))
      .slice(0, PR_LIMIT);
  }
}
