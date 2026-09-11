import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkoutSessionStatus } from "@prisma/client";
import type {
  ExercisePerformanceHistoryResponse,
  ExercisePerformancePrescription,
  ExercisePerformanceSession,
  ExercisePerformanceSummary,
  ProgressionChange,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { readSnapshot } from "./analytics/session-snapshot";
import { ExercisePerformanceHistoryQueryDto } from "./dto/exercise-performance-history.dto";
import { dayNameFrom } from "./workout-session.selects";

interface ExerciseSummaryRow {
  exerciseId: string;
  exerciseName: string;
  lastPerformedAt: Date;
  hasStrengthTrend: boolean;
}

interface ProgressionEventRow {
  sessionId: string;
  payload: Prisma.JsonValue;
}

function mapPrescription(
  exercise: ReturnType<typeof readSnapshot>["routineDay"]["exercises"][number],
): ExercisePerformancePrescription {
  return {
    routineExerciseId: exercise.id,
    restSeconds: exercise.restSeconds,
    note: exercise.note,
    progressionScheme: exercise.progressionScheme,
    minWeightIncrementKg: exercise.minWeightIncrement,
    sets: exercise.sets.map((set) => ({
      setNumber: set.setNumber,
      repType: set.repType,
      reps: set.reps,
      minReps: set.minReps,
      maxReps: set.maxReps,
      weightKg: set.weight,
      rir: set.rir,
    })),
  };
}

@Injectable()
export class WorkoutExercisePerformanceService {
  constructor(private readonly db: DatabaseService) {}

  async getExercisePerformance(
    userId: string,
    query: ExercisePerformanceHistoryQueryDto,
  ): Promise<ExercisePerformanceHistoryResponse> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : new Date();
    if (from && from > to) {
      throw new BadRequestException("from must be before or equal to to");
    }
    const take = (query.limit ?? 10) + 1;

    return this.db.$transaction(
      async (tx) => {
        const exerciseRows = await tx.$queryRaw<ExerciseSummaryRow[]>`
          SELECT
            logs."exerciseId" AS "exerciseId",
            exercises."name" AS "exerciseName",
            MAX(sessions."endedAt") AS "lastPerformedAt",
            BOOL_OR(records."exerciseId" IS NOT NULL) AS "hasStrengthTrend"
          FROM "SetLog" logs
          INNER JOIN "WorkoutSession" sessions ON sessions."id" = logs."sessionId"
          INNER JOIN "Exercise" exercises ON exercises."id" = logs."exerciseId"
          LEFT JOIN "PersonalRecord" records
            ON records."userId" = sessions."userId"
            AND records."exerciseId" = logs."exerciseId"
          WHERE sessions."userId" = ${userId}
            AND sessions."status" IN ('COMPLETED', 'ABORTED')
            AND sessions."endedAt" IS NOT NULL
            AND logs."isCompleted"
            AND logs."reps" > 0
          GROUP BY logs."exerciseId", exercises."name"
          ORDER BY
            BOOL_OR(records."exerciseId" IS NOT NULL) DESC,
            MAX(records."achievedAt") DESC NULLS LAST,
            exercises."name" ASC`;
        const exercises: ExercisePerformanceSummary[] = exerciseRows.map(
          (row) => ({
            exerciseId: row.exerciseId,
            exerciseName: row.exerciseName,
            lastPerformedAt: row.lastPerformedAt.toISOString(),
            hasStrengthTrend: row.hasStrengthTrend,
          }),
        );
        const selectedExercise = query.exerciseId
          ? (exercises.find(
              (exercise) => exercise.exerciseId === query.exerciseId,
            ) ?? null)
          : (exercises[0] ?? null);
        if (query.exerciseId && !selectedExercise) {
          throw new NotFoundException(
            "No completed performance found for this exercise",
          );
        }
        if (!selectedExercise) {
          return { exercises, selectedExercise: null, items: [] };
        }

        const sessions = await tx.workoutSession.findMany({
          where: {
            userId,
            status: {
              in: [
                WorkoutSessionStatus.COMPLETED,
                WorkoutSessionStatus.ABORTED,
              ],
            },
            endedAt: {
              not: null,
              ...(from ? { gte: from } : {}),
              lte: to,
            },
            setLogs: {
              some: {
                exerciseId: selectedExercise.exerciseId,
                isCompleted: true,
                reps: { gt: 0 },
              },
            },
          },
          orderBy: [{ endedAt: "desc" }, { id: "desc" }],
          take,
          skip: query.cursor ? 1 : 0,
          cursor: query.cursor ? { id: query.cursor } : undefined,
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            notes: true,
            snapshot: { select: { payload: true } },
            setLogs: {
              where: {
                exerciseId: selectedExercise.exerciseId,
                isCompleted: true,
                reps: { gt: 0 },
              },
              orderBy: [
                { sourceRoutineExerciseId: "asc" },
                { routineExerciseId: "asc" },
                { setNumber: "asc" },
              ],
              select: {
                sourceRoutineExerciseId: true,
                routineExerciseId: true,
                setNumber: true,
                reps: true,
                weight: true,
                rpe: true,
              },
            },
          },
        });
        const hasNext = sessions.length === take;
        const page = hasNext ? sessions.slice(0, -1) : sessions;
        const sessionIds = page.map((session) => session.id);
        const progressionRows = sessionIds.length
          ? await tx.$queryRaw<ProgressionEventRow[]>`
              SELECT "sessionId", "payload"
              FROM "TrainingEvent"
              WHERE "userId" = ${userId}
                AND "type" = 'PROGRESSION_CHANGED'
                AND "sessionId" IN (${Prisma.join(sessionIds)})
                AND "payload"->>'exerciseId' = ${selectedExercise.exerciseId}
              ORDER BY "occurredAt" ASC, "id" ASC`
          : [];
        const progressionBySession = new Map<string, ProgressionChange[]>();
        for (const row of progressionRows) {
          const changes = progressionBySession.get(row.sessionId) ?? [];
          changes.push(row.payload as unknown as ProgressionChange);
          progressionBySession.set(row.sessionId, changes);
        }

        const items = page.map((session): ExercisePerformanceSession => {
          const snapshot = readSnapshot(session.snapshot!.payload);
          const prescriptions = snapshot.routineDay.exercises
            .filter(
              (exercise) =>
                exercise.exercise.id === selectedExercise.exerciseId,
            )
            .map(mapPrescription);
          return {
            sessionId: session.id,
            status: session.status as ExercisePerformanceSession["status"],
            routineName: snapshot.routine.name,
            dayName:
              typeof snapshot.routineDay.dayOfWeek === "number"
                ? dayNameFrom(snapshot.routineDay.dayOfWeek)
                : null,
            startedAt: session.startedAt.toISOString(),
            endedAt: session.endedAt!.toISOString(),
            durationSec:
              session.durationSec ??
              Math.max(
                0,
                Math.round(
                  (session.endedAt!.getTime() - session.startedAt.getTime()) /
                    1000,
                ),
              ),
            sessionNotes: session.notes,
            sets: session.setLogs.flatMap((set) => {
              const routineExerciseId =
                set.sourceRoutineExerciseId ?? set.routineExerciseId;
              return routineExerciseId && set.reps !== null
                ? [
                    {
                      routineExerciseId,
                      setNumber: set.setNumber,
                      reps: set.reps,
                      weightKg: set.weight,
                      rpe: set.rpe,
                    },
                  ]
                : [];
            }),
            prescriptions,
            progressionChanges:
              progressionBySession.get(session.id) ?? [],
          };
        });
        return {
          exercises,
          selectedExercise,
          items,
          nextCursor: hasNext ? items.at(-1)?.sessionId : undefined,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
