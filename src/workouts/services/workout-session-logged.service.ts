import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  apiError,
  LOGGED_WORKOUTS_PER_ROUTINE_MAX,
  type LogPastWorkoutRequest,
  type LogPastWorkoutResponse,
  type RemoveLoggedWorkoutResponse,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

import { removeActivityEntries } from "../../activity/activity-entry-removal";
import { DatabaseService } from "../../database/database.service";
import { readLinearState } from "../../routines/linear-periodization";
import { estimateDaySeconds } from "../../routines/routine-facets";
import { lockTrainingAccount } from "../analytics/analytics-lock";
import { summarizeSession } from "../analytics/analytics-writer";
import { startHistoryRebuild } from "../analytics/history-rebuild";
import { ensureSessionSnapshot } from "../analytics/session-snapshot";
import {
  loggedBlockSteps,
  loggedSetRows,
  loggedWorkoutConflict,
  loggedWorkoutTimes,
  rewindLoggedDay,
} from "../logged-workout-rules";
import { toWorkoutSessionResponse } from "../workout-session.mapper";
import { buildWorkoutSessionSelect } from "../workout-session.selects";

const LOGGED_DAY_SELECT = {
  id: true,
  routineId: true,
  trainingBlockId: true,
  temporaryOverrideId: true,
  routine: { select: { userId: true, createdAt: true } },
  exercises: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      exerciseId: true,
      progressionScheme: true,
      linearPeriodization: true,
      restSeconds: true,
      exercise: {
        select: {
          primaryMuscles: true,
          secondaryMuscles: true,
          equipmentRequired: true,
        },
      },
      sets: {
        orderBy: { setNumber: "asc" },
        select: {
          setNumber: true,
          kind: true,
          repType: true,
          reps: true,
          minReps: true,
          maxReps: true,
        },
      },
    },
  },
} satisfies Prisma.RoutineDaySelect;

/**
 * LIVE-23: a workout done before the routine existed in Sunnsteel, recorded
 * after it happened. It is a session of one of the routine's own days with a
 * snapshot, like any other, so everything that reads history reads it; it
 * runs no progression and moves no 8-week block, and it is never announced:
 * it has no SESSION_COMPLETED event, the one the activity feed, partner
 * alerts and comebacks read. Because it lands earlier than what analytics
 * have already counted, the history is replayed in a new generation.
 */
@Injectable()
export class WorkoutSessionLoggedService {
  constructor(private readonly db: DatabaseService) {}

  async log(
    userId: string,
    request: LogPastWorkoutRequest,
  ): Promise<LogPastWorkoutResponse> {
    return this.db.$transaction(
      async (tx) => {
        await lockTrainingAccount(tx, userId);
        const day = await tx.routineDay.findFirst({
          where: {
            id: request.routineDayId,
            routineId: request.routineId,
            routine: { userId },
          },
          select: LOGGED_DAY_SELECT,
        });
        if (!day) {
          throw new NotFoundException(apiError("ROUTINE_DAY_NOT_FOUND"));
        }
        if (day.trainingBlockId || day.temporaryOverrideId) {
          throw new ConflictException(
            apiError("LOGGED_WORKOUT_DAY_NOT_BASELINE"),
          );
        }
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { timeZone: true },
        });
        const times = loggedWorkoutTimes({
          date: request.date,
          startMinute: request.startMinute,
          durationSec: request.durationSec,
          estimateSec: estimateDaySeconds(day),
          timeZone: user.timeZone ?? "UTC",
          routineCreatedAt: day.routine.createdAt,
          now: new Date(),
        });

        const logged = await tx.workoutSession.count({
          where: { userId, routineId: day.routineId, origin: "LOGGED_LATER" },
        });
        if (logged >= LOGGED_WORKOUTS_PER_ROUTINE_MAX) {
          throw loggedWorkoutConflict("LOGGED_WORKOUT_LIMIT", {
            max: LOGGED_WORKOUTS_PER_ROUTINE_MAX,
          });
        }
        const sameDay = await tx.workoutSession.count({
          where: {
            userId,
            routineDayId: day.id,
            startedAt: { gte: times.dayFrom, lt: times.dayTo },
          },
        });
        if (sameDay > 0) throw loggedWorkoutConflict("LOGGED_WORKOUT_SAME_DAY");
        const overlapping = await tx.workoutSession.count({
          where: {
            userId,
            status: { in: ["COMPLETED", "ABORTED"] },
            startedAt: { lt: times.endedAt },
            endedAt: { gt: times.startedAt },
          },
        });
        if (overlapping > 0) throw loggedWorkoutConflict("LOGGED_WORKOUT_OVERLAP");

        const slots = day.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseId: exercise.exerciseId,
          progressionScheme: exercise.progressionScheme,
          linearPeriodization: readLinearState(exercise.linearPeriodization),
          sets: exercise.sets,
        }));
        const rows = loggedSetRows(slots, request.sets);
        const steps = loggedBlockSteps(slots, request.lpSteps);

        const session = await tx.workoutSession.create({
          data: {
            userId,
            routineId: day.routineId,
            routineDayId: day.id,
            status: "COMPLETED",
            origin: "LOGGED_LATER",
            startedAt: times.startedAt,
            endedAt: times.endedAt,
            durationSec: times.durationSec,
            lastActivityAt: times.endedAt,
            notes: request.notes?.trim() ? request.notes.trim() : null,
            setLogs: {
              createMany: {
                data: rows.map((row) => ({
                  routineExerciseId: row.routineExerciseId,
                  exerciseId: row.exerciseId,
                  setNumber: row.setNumber,
                  reps: row.reps,
                  weight: row.weight,
                  rpe: row.rpe,
                  isCompleted: row.isCompleted,
                  kind: row.kind,
                  completedAt: row.isCompleted ? times.endedAt : null,
                })),
              },
            },
          },
          select: { id: true },
        });

        // The plan it trained, reconstructed: the day as it is now, with each
        // 8-week slot at the week the member named.
        const snapshot = await ensureSessionSnapshot(tx, session.id, "LOGGED");
        if (steps.size > 0) {
          const rewound: WorkoutSessionSnapshotV1 = {
            ...snapshot,
            routineDay: rewindLoggedDay(snapshot.routineDay, steps),
          };
          await tx.workoutSessionSnapshot.update({
            where: { sessionId: session.id },
            data: { payload: rewound as unknown as Prisma.InputJsonValue },
          });
        }
        await summarizeSession(tx, session.id);
        const analytics = await startHistoryRebuild(tx, userId);
        const stored = await tx.workoutSession.findUniqueOrThrow({
          where: { id: session.id },
          select: buildWorkoutSessionSelect(true),
        });
        return { session: toWorkoutSessionResponse(stored), analytics };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Removes a workout logged later, with everything derived from it, and
   * replays the history without it. A workout trained in the app is never
   * removed here.
   */
  async remove(
    userId: string,
    sessionId: string,
  ): Promise<RemoveLoggedWorkoutResponse> {
    return this.db.$transaction(
      async (tx) => {
        await lockTrainingAccount(tx, userId);
        const session = await tx.workoutSession.findFirst({
          where: { id: sessionId, userId },
          select: { id: true, origin: true },
        });
        if (!session) {
          throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
        }
        if (session.origin !== "LOGGED_LATER") {
          throw new ConflictException(apiError("LOGGED_WORKOUT_NOT_LOGGED"));
        }
        const events = await tx.trainingEvent.findMany({
          where: { userId, sessionId },
          select: { eventKey: true },
        });
        await tx.trainingEvent.deleteMany({ where: { userId, sessionId } });
        await removeActivityEntries(
          tx,
          userId,
          events.map((event) => event.eventKey),
        );
        // A best it held is found again by the replay among what remains.
        await tx.personalRecord.deleteMany({ where: { userId, sessionId } });
        await tx.workoutSession.delete({ where: { id: sessionId } });
        return { analytics: await startHistoryRebuild(tx, userId) };
      },
      { timeout: 30_000 },
    );
  }
}
