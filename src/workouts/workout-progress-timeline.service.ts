import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ProgressTimelineItem,
  ProgressTimelinePersonalRecordItem,
  ProgressTimelineProgressionItem,
  ProgressTimelineRecordPerformance,
  ProgressTimelineResponse,
  ProgressionChange,
  WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { readSnapshot } from "./analytics/session-snapshot";
import { ProgressTimelineQueryDto } from "./dto/progress-timeline.dto";
import { dayNameFrom } from "./workout-session.selects";

const DEFAULT_PAGE_SIZE = 20;

export interface ProgressTimelineEventRow {
  id: string;
  sessionId: string;
  type: "PERSONAL_RECORD" | "PROGRESSION_CHANGED";
  occurredAt: Date;
  payload: unknown;
  previousPayload: unknown | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function recordPerformance(
  value: unknown,
): ProgressTimelineRecordPerformance | null {
  const payload = objectValue(value);
  if (
    !payload ||
    !finiteNumber(payload.weight) ||
    !finiteNumber(payload.reps) ||
    !finiteNumber(payload.estimated1rm)
  ) {
    return null;
  }
  return {
    weightKg: payload.weight,
    reps: payload.reps,
    estimated1rmKg: payload.estimated1rm,
  };
}

function progressionChange(value: unknown, eventId: string): ProgressionChange {
  const payload = objectValue(value);
  const sets = payload?.sets;
  if (
    !payload ||
    typeof payload.routineExerciseId !== "string" ||
    typeof payload.exerciseId !== "string" ||
    typeof payload.exerciseName !== "string" ||
    !["DOUBLE_PROGRESSION", "DYNAMIC_DOUBLE_PROGRESSION"].includes(
      String(payload.progressionScheme),
    ) ||
    !["ALL_SETS_REACHED_TARGET", "SET_REACHED_TARGET"].includes(
      String(payload.rule),
    ) ||
    !finiteNumber(payload.minWeightIncrementKg) ||
    !Array.isArray(sets) ||
    !sets.every((set) => {
      const item = objectValue(set);
      return (
        item &&
        finiteNumber(item.setNumber) &&
        finiteNumber(item.targetReps) &&
        finiteNumber(item.performedReps) &&
        finiteNumber(item.previousWeightKg) &&
        finiteNumber(item.newWeightKg)
      );
    })
  ) {
    throw new Error(`Invalid PROGRESSION_CHANGED event payload: ${eventId}`);
  }
  return payload as unknown as ProgressionChange;
}

function sessionContext(snapshot: WorkoutSessionSnapshotV1) {
  const dayOfWeek = snapshot.routineDay.dayOfWeek;
  return {
    sessionId: snapshot.sessionId,
    routineName: snapshot.routine.name,
    dayName: typeof dayOfWeek === "number" ? dayNameFrom(dayOfWeek) : null,
  };
}

export function mapProgressTimelineItem(
  row: ProgressTimelineEventRow,
  snapshot: WorkoutSessionSnapshotV1,
): ProgressTimelineItem {
  if (row.type === "PERSONAL_RECORD") {
    const payload = objectValue(row.payload);
    const current = recordPerformance(row.payload);
    const previous = row.previousPayload
      ? recordPerformance(row.previousPayload)
      : null;
    if (
      !payload ||
      typeof payload.exerciseId !== "string" ||
      typeof payload.exerciseName !== "string" ||
      !current ||
      (row.previousPayload && !previous)
    ) {
      throw new Error(`Invalid PERSONAL_RECORD event payload: ${row.id}`);
    }
    const reason = !previous
      ? "FIRST_RECORDED_BEST"
      : current.weightKg > previous.weightKg
        ? "HEAVIER_LOAD"
        : current.weightKg === previous.weightKg && current.reps > previous.reps
          ? "MORE_REPS_AT_SAME_LOAD"
          : null;
    if (!reason) {
      throw new Error(`Non-improving PERSONAL_RECORD event: ${row.id}`);
    }
    const item: ProgressTimelinePersonalRecordItem = {
      eventId: row.id,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      session: sessionContext(snapshot),
      exerciseId: payload.exerciseId,
      exerciseName: payload.exerciseName,
      current,
      previous,
      reason,
    };
    return item;
  }

  const change = progressionChange(row.payload, row.id);
  const item: ProgressTimelineProgressionItem = {
    eventId: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    session: sessionContext(snapshot),
    exerciseId: change.exerciseId,
    exerciseName: change.exerciseName,
    change,
  };
  return item;
}

@Injectable()
export class WorkoutProgressTimelineService {
  constructor(private readonly db: DatabaseService) {}

  async getProgressTimeline(
    userId: string,
    query: ProgressTimelineQueryDto,
  ): Promise<ProgressTimelineResponse> {
    const take = (query.limit ?? DEFAULT_PAGE_SIZE) + 1;
    return this.db.$transaction(
      async (tx) => {
        const cursor = query.cursor
          ? await tx.trainingEvent.findFirst({
              where: {
                id: query.cursor,
                userId,
                type: query.type
                  ? query.type
                  : { in: ["PERSONAL_RECORD", "PROGRESSION_CHANGED"] },
                ...(query.exerciseId
                  ? { payload: { path: ["exerciseId"], equals: query.exerciseId } }
                  : {}),
              },
              select: { id: true, occurredAt: true },
            })
          : null;
        if (query.cursor && !cursor) {
          throw new BadRequestException("Invalid progress timeline cursor");
        }

        const typeFilter = query.type
          ? Prisma.sql`AND events."type" = ${query.type}::"TrainingEventType"`
          : Prisma.sql`AND events."type" IN ('PERSONAL_RECORD', 'PROGRESSION_CHANGED')`;
        // Both event families carry the catalog exercise id at the top of
        // their payload, so one exercise's history (EXER-01) walks the same
        // owner-scoped index as the unfiltered feed.
        const exerciseFilter = query.exerciseId
          ? Prisma.sql`AND events."payload"->>'exerciseId' = ${query.exerciseId}`
          : Prisma.empty;
        const cursorFilter = cursor
          ? Prisma.sql`AND (
              events."occurredAt" < ${cursor.occurredAt}
              OR (
                events."occurredAt" = ${cursor.occurredAt}
                AND events."id" < ${cursor.id}
              )
            )`
          : Prisma.empty;
        const rows = await tx.$queryRaw<ProgressTimelineEventRow[]>(Prisma.sql`
          SELECT
            events."id",
            events."sessionId",
            events."type",
            events."occurredAt",
            events."payload",
            previous."payload" AS "previousPayload"
          FROM "TrainingEvent" events
          LEFT JOIN LATERAL (
            SELECT prior."payload"
            FROM "TrainingEvent" prior
            WHERE events."type" = 'PERSONAL_RECORD'
              AND prior."userId" = events."userId"
              AND prior."type" = 'PERSONAL_RECORD'
              AND prior."payload"->>'exerciseId' = events."payload"->>'exerciseId'
              AND (
                prior."occurredAt" < events."occurredAt"
                OR (
                  prior."occurredAt" = events."occurredAt"
                  AND prior."id" < events."id"
                )
              )
            ORDER BY prior."occurredAt" DESC, prior."id" DESC
            LIMIT 1
          ) previous ON TRUE
          WHERE events."userId" = ${userId}
            ${typeFilter}
            ${exerciseFilter}
            ${cursorFilter}
          ORDER BY events."occurredAt" DESC, events."id" DESC
          LIMIT ${take}`);

        const hasNext = rows.length === take;
        const page = hasNext ? rows.slice(0, -1) : rows;
        const sessionIds = [...new Set(page.map((row) => row.sessionId))];
        const snapshots = sessionIds.length
          ? await tx.workoutSessionSnapshot.findMany({
              where: { sessionId: { in: sessionIds } },
              select: { sessionId: true, payload: true },
            })
          : [];
        const snapshotsBySession = new Map(
          snapshots.map((snapshot) => [
            snapshot.sessionId,
            readSnapshot(snapshot.payload),
          ]),
        );
        const items = page.map((row) => {
          const snapshot = snapshotsBySession.get(row.sessionId);
          if (!snapshot) {
            throw new Error(
              `Missing session snapshot for training event: ${row.id}`,
            );
          }
          return mapProgressTimelineItem(row, snapshot);
        });

        return {
          items,
          nextCursor: hasNext ? items.at(-1)?.eventId : undefined,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
