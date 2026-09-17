import { STREAK_MAX_GAP_DAYS } from '@sunsteel/contracts';

/**
 * NOTIF-06: whether today is the last local date that can still save a run.
 *
 * Nothing here is a judgement about effort. `nextStreak` in
 * `analytics-contribution.ts` continues a run while the gap between training
 * dates is at most `STREAK_MAX_GAP_DAYS`, so the run ends after that — and the
 * last date that can still extend it is exactly `lastTrainingDate + 3`. The
 * nudge states that fact and never tells anyone to train, because a rest day
 * ending a streak is the plan working rather than a failure.
 */

const dayDifference = (later: string, earlier: string) =>
  Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86400000,
  );

export interface StreakRiskInput {
  /** The account's local date today. */
  today: string;
  /** From the analytics projection; null when nothing has been trained. */
  lastTrainingDate: string | null;
  /** The run that would end, from the same projection. */
  currentRun: number;
  /** True when a session has already been started or finished today. */
  trainedToday: boolean;
}

export interface StreakRisk {
  /** The run at stake, always at least one day. */
  runDays: number;
  lastTrainingDate: string;
  /** Local dates since the last session, one to three. */
  daysSince: number;
}

/**
 * Returns the risk only on the final day. Firing earlier would be the generic
 * daily pressure this feature exists instead of: on day one or two of a gap,
 * nothing is at stake yet.
 */
export function streakAtRisk(input: StreakRiskInput): StreakRisk | null {
  const { today, lastTrainingDate, currentRun, trainedToday } = input;
  if (trainedToday) return null;
  if (!lastTrainingDate || currentRun < 1) return null;

  const daysSince = dayDifference(today, lastTrainingDate);
  // Before the last day nothing is at stake; after it the run has already
  // ended, and announcing a streak that is gone would be untrue.
  if (daysSince !== STREAK_MAX_GAP_DAYS) return null;

  return { runDays: currentRun, lastTrainingDate, daysSince };
}

/** States the evidence. No imperative, and no count of days "left". */
export function describeStreakRisk(risk: StreakRisk): string {
  const days = `${risk.runDays} ${risk.runDays === 1 ? 'day' : 'days'}`;
  return `Your ${days} run continues if you train today. It has been ${risk.daysSince} days since your last session.`;
}
