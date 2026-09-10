import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ExerciseStrengthSummary,
  ExerciseStrengthTrendPoint,
  ExerciseStrengthTrendResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { ExerciseStrengthTrendQueryDto } from "./dto/exercise-strength-trend.dto";

const MAX_TREND_POINTS = 500;

interface PersonalRecordEventRow {
  id: string;
  sessionId: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function mapStrengthTrendPoint(
  row: PersonalRecordEventRow,
): ExerciseStrengthTrendPoint {
  const payload = row.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !finiteNumber(payload.weight) ||
    !finiteNumber(payload.reps) ||
    !finiteNumber(payload.estimated1rm)
  ) {
    throw new Error(`Invalid PERSONAL_RECORD event payload: ${row.id}`);
  }
  return {
    sessionId: row.sessionId,
    achievedAt: row.occurredAt.toISOString(),
    weightKg: payload.weight,
    reps: payload.reps,
    estimated1rmKg: payload.estimated1rm,
  };
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException("Invalid strength trend date range");
  }
  return parsed;
}

@Injectable()
export class WorkoutStrengthTrendService {
  constructor(private readonly db: DatabaseService) {}

  async getStrengthTrend(
    userId: string,
    query: ExerciseStrengthTrendQueryDto,
  ): Promise<ExerciseStrengthTrendResponse> {
    const to = parseDate(query.to, new Date());
    const from = query.from ? parseDate(query.from, to) : null;
    if (from && from > to) {
      throw new BadRequestException("from must be before or equal to to");
    }

    return this.db.$transaction(
      async (tx) => {
        const records = await tx.personalRecord.findMany({
          where: { userId },
          orderBy: [{ achievedAt: "desc" }, { exerciseName: "asc" }],
          select: {
            exerciseId: true,
            exerciseName: true,
            weight: true,
            reps: true,
            estimated1rm: true,
            achievedAt: true,
          },
        });
        const exercises: ExerciseStrengthSummary[] = records.map((record) => ({
          exerciseId: record.exerciseId,
          exerciseName: record.exerciseName,
          weightKg: record.weight,
          reps: record.reps,
          estimated1rmKg: record.estimated1rm,
          achievedAt: record.achievedAt.toISOString(),
        }));
        const selectedExercise = query.exerciseId
          ? (exercises.find(
              (exercise) => exercise.exerciseId === query.exerciseId,
            ) ?? null)
          : (exercises[0] ?? null);
        if (query.exerciseId && !selectedExercise) {
          throw new NotFoundException(
            "No strength records found for this exercise",
          );
        }
        if (!selectedExercise) {
          return {
            exercises,
            selectedExercise: null,
            range: { from: from?.toISOString() ?? null, to: to.toISOString() },
            baseline: null,
            points: [],
            truncated: false,
          };
        }

        const exerciseId = selectedExercise.exerciseId;
        const baselineRows = from
          ? await tx.$queryRaw<PersonalRecordEventRow[]>`
              SELECT "id", "sessionId", "occurredAt", "payload"
              FROM "TrainingEvent"
              WHERE "userId" = ${userId}
                AND "type" = 'PERSONAL_RECORD'
                AND "payload"->>'exerciseId' = ${exerciseId}
                AND "occurredAt" < ${from}
              ORDER BY "occurredAt" DESC, "id" DESC
              LIMIT 1`
          : [];
        const eventRows = from
          ? await tx.$queryRaw<PersonalRecordEventRow[]>`
              SELECT "id", "sessionId", "occurredAt", "payload"
              FROM "TrainingEvent"
              WHERE "userId" = ${userId}
                AND "type" = 'PERSONAL_RECORD'
                AND "payload"->>'exerciseId' = ${exerciseId}
                AND "occurredAt" >= ${from}
                AND "occurredAt" <= ${to}
              ORDER BY "occurredAt" DESC, "id" DESC
              LIMIT ${MAX_TREND_POINTS + 1}`
          : await tx.$queryRaw<PersonalRecordEventRow[]>`
              SELECT "id", "sessionId", "occurredAt", "payload"
              FROM "TrainingEvent"
              WHERE "userId" = ${userId}
                AND "type" = 'PERSONAL_RECORD'
                AND "payload"->>'exerciseId' = ${exerciseId}
                AND "occurredAt" <= ${to}
              ORDER BY "occurredAt" DESC, "id" DESC
              LIMIT ${MAX_TREND_POINTS + 1}`;
        const truncated = eventRows.length > MAX_TREND_POINTS;
        const points = eventRows
          .slice(0, MAX_TREND_POINTS)
          .reverse()
          .map(mapStrengthTrendPoint);
        return {
          exercises,
          selectedExercise,
          range: { from: from?.toISOString() ?? null, to: to.toISOString() },
          baseline: baselineRows[0]
            ? mapStrengthTrendPoint(baselineRows[0])
            : null,
          points,
          truncated,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
