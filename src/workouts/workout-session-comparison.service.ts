import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WorkoutSessionStatus } from "@prisma/client";
import type {
  SessionComparisonResponse,
  SessionComparisonRoutineDay,
  SessionComparisonSession,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { readSnapshot } from "./analytics/session-snapshot";
import { SessionComparisonQueryDto } from "./dto/session-comparison.dto";
import { summarizeRecapSets } from "./session-recap";
import { dayNameFrom } from "./workout-session.selects";

const ROUTINE_DAY_LIMIT = 100;

interface RoutineDayRow {
  routineDayId: string;
  routineId: string;
  routineName: string | null;
  dayOfWeek: number | null;
  lastCompletedAt: Date;
  completedSessionCount: number;
}

function mapRoutineDay(row: RoutineDayRow): SessionComparisonRoutineDay {
  return {
    routineDayId: row.routineDayId,
    routineId: row.routineId,
    routineName: row.routineName ?? "Workout",
    dayName:
      typeof row.dayOfWeek === "number" ? dayNameFrom(row.dayOfWeek) : null,
    lastCompletedAt: row.lastCompletedAt.toISOString(),
    completedSessionCount: row.completedSessionCount,
  };
}

@Injectable()
export class WorkoutSessionComparisonService {
  constructor(private readonly db: DatabaseService) {}

  async getSessionComparison(
    userId: string,
    query: SessionComparisonQueryDto,
  ): Promise<SessionComparisonResponse> {
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<RoutineDayRow[]>`
          WITH completed AS (
            SELECT
              sessions."id",
              COALESCE(
                sessions."sourceRoutineDayId",
                sessions."routineDayId",
                snapshots."payload"->>'sourceRoutineDayId'
              ) AS "routineDayId",
              COALESCE(
                sessions."sourceRoutineId",
                sessions."routineId",
                snapshots."payload"->>'sourceRoutineId'
              ) AS "routineId",
              snapshots."payload",
              sessions."endedAt" AS "lastCompletedAt",
              COUNT(*) OVER (
                PARTITION BY COALESCE(
                  sessions."sourceRoutineDayId",
                  sessions."routineDayId",
                  snapshots."payload"->>'sourceRoutineDayId'
                )
              )::int AS "completedSessionCount"
            FROM "WorkoutSession" sessions
            INNER JOIN "WorkoutSessionSnapshot" snapshots
              ON snapshots."sessionId" = sessions."id"
            WHERE sessions."userId" = ${userId}
              AND sessions."status" = 'COMPLETED'
              AND sessions."endedAt" IS NOT NULL
          ), latest AS (
            SELECT DISTINCT ON ("routineDayId")
              "id",
              "routineDayId",
              "routineId",
              "payload",
              "lastCompletedAt",
              "completedSessionCount"
            FROM completed
            WHERE "routineDayId" IS NOT NULL
              AND "routineId" IS NOT NULL
            ORDER BY "routineDayId", "lastCompletedAt" DESC, "id" DESC
          )
          SELECT
            "routineDayId",
            "routineId",
            "payload"->'routine'->>'name' AS "routineName",
            ("payload"->'routineDay'->>'dayOfWeek')::int AS "dayOfWeek",
            "lastCompletedAt",
            "completedSessionCount"
          FROM latest
          ORDER BY
            ("completedSessionCount" > 1) DESC,
            "lastCompletedAt" DESC,
            "routineDayId" ASC
          LIMIT ${ROUTINE_DAY_LIMIT}`;

        const routineDays = rows.map(mapRoutineDay);
        const selectedRoutineDay = query.routineDayId
          ? (routineDays.find(
              (day) => day.routineDayId === query.routineDayId,
            ) ?? null)
          : (routineDays[0] ?? null);

        if (query.routineDayId && !selectedRoutineDay) {
          throw new NotFoundException(
            "No completed sessions found for this routine day",
          );
        }
        if (!selectedRoutineDay) {
          return {
            routineDays,
            selectedRoutineDay: null,
            latestSession: null,
            previousSession: null,
          };
        }

        const sessions = await tx.workoutSession.findMany({
          where: {
            userId,
            status: WorkoutSessionStatus.COMPLETED,
            endedAt: { not: null },
            OR: [
              { sourceRoutineDayId: selectedRoutineDay.routineDayId },
              {
                sourceRoutineDayId: null,
                routineDayId: selectedRoutineDay.routineDayId,
              },
            ],
          },
          orderBy: [{ endedAt: "desc" }, { id: "desc" }],
          take: 2,
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            totalVolumeKg: true,
            completedSets: true,
            notes: true,
            snapshot: { select: { payload: true } },
            setLogs: {
              where: { isCompleted: true, reps: { gt: 0 } },
              orderBy: [
                { sourceRoutineExerciseId: "asc" },
                { routineExerciseId: "asc" },
                { setNumber: "asc" },
              ],
              select: {
                sourceRoutineExerciseId: true,
                routineExerciseId: true,
                exerciseId: true,
                setNumber: true,
                reps: true,
                weight: true,
                rpe: true,
                isCompleted: true,
              },
            },
          },
        });

        const mapped = sessions.map((session): SessionComparisonSession => {
          const snapshot = readSnapshot(session.snapshot!.payload);
          const setsByExercise = new Map<
            string,
            SessionComparisonSession["exercises"][number]["sets"]
          >();
          for (const set of session.setLogs) {
            const routineExerciseId =
              set.sourceRoutineExerciseId ?? set.routineExerciseId;
            if (!routineExerciseId || set.reps === null) continue;
            const sets = setsByExercise.get(routineExerciseId) ?? [];
            sets.push({
              routineExerciseId,
              setNumber: set.setNumber,
              reps: set.reps,
              weightKg: set.weight,
              rpe: set.rpe,
            });
            setsByExercise.set(routineExerciseId, sets);
          }
          const fallback = summarizeRecapSets(session.setLogs);
          const endedAt = session.endedAt!;
          const dayOfWeek = snapshot.routineDay.dayOfWeek;

          return {
            sessionId: session.id,
            routineDayId: snapshot.sourceRoutineDayId,
            routineName: snapshot.routine.name,
            dayName:
              typeof dayOfWeek === "number" ? dayNameFrom(dayOfWeek) : null,
            startedAt: session.startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationSec:
              session.durationSec ??
              Math.max(
                0,
                Math.round(
                  (endedAt.getTime() - session.startedAt.getTime()) / 1000,
                ),
              ),
            totalVolumeKg: session.totalVolumeKg ?? fallback.totalVolumeKg,
            completedSets: session.completedSets ?? fallback.completedSets,
            notes: session.notes,
            exercises: snapshot.routineDay.exercises.map((exercise) => ({
              routineExerciseId: exercise.id,
              exerciseId: exercise.exercise.id,
              exerciseName: exercise.exercise.name,
              order: exercise.order,
              sets: setsByExercise.get(exercise.id) ?? [],
            })),
          };
        });

        return {
          routineDays,
          selectedRoutineDay,
          latestSession: mapped[0] ?? null,
          previousSession: mapped[1] ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
