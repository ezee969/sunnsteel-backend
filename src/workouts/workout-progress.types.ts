/**
 * Response shapes for `GET /workouts/progress`.
 *
 * These live here rather than in `@sunsteel/contracts` because that package is
 * consumed from the npm registry (see CLAUDE.md — no `file:` linking), so a new
 * shared shape would require publishing a release first. Move them into the
 * contracts package on the next version bump and delete this file.
 */

export interface PersonalRecordEntry {
  exerciseId: string;
  exerciseName: string;
  /** Heaviest weight ever completed for this exercise, in kg. */
  weight: number;
  /** Reps performed on the record set. */
  reps: number;
  /** Epley estimate: weight * (1 + reps / 30), rounded to 1dp. */
  estimated1rm: number;
  achievedAt: string;
}

export interface RecentActivityEntry {
  sessionId: string;
  routineId: string;
  routineName: string;
  dayName: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  totalVolumeKg: number;
  completedSets: number;
}

export interface WorkoutProgressResponse {
  /** Sum of weight * reps across every completed set the user has logged. */
  totalVolumeKg: number;
  currentStreakDays: number;
  bestStreakDays: number;
  personalRecords: PersonalRecordEntry[];
  recentActivity: RecentActivityEntry[];
}
