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
import { routineDayName } from "./workout-session.selects";

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

/**
 * A record payload's number, or null when it is missing or not a number, so
 * one malformed row can be passed over instead of failing the cast.
 */
function recordValue(
  alias: "events" | "prior" | "previous",
  field: "weight" | "reps",
) {
  const value = Prisma.raw(`${alias}."payload"->'${field}'`);
  const text = Prisma.raw(`${alias}."payload"->>'${field}'`);
  return Prisma.sql`(CASE WHEN jsonb_typeof(${value}) = 'number' THEN (${text})::float8 END)`;
}

function sessionContext(snapshot: WorkoutSessionSnapshotV1) {
  return {
    sessionId: snapshot.sessionId,
    routineName: snapshot.routine.name,
    dayName: routineDayName(snapshot.routineDay),
  };
}

/**
 * The parts of one `PERSONAL_RECORD` event the timeline and a shared record
 * (MSG-11) word alike: its lift, the performance, the best earlier record
 * and why it beat it. Null when it does not beat that best (a stale row,
 * TD-58); throws on a malformed payload.
 */
export function personalRecordParts(row: {
  id: string;
  payload: unknown;
  previousPayload: unknown | null;
}): Pick<
  ProgressTimelinePersonalRecordItem,
  "exerciseId" | "exerciseName" | "current" | "previous" | "reason"
> | null {
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
  if (!reason) return null;
  return {
    exerciseId: payload.exerciseId,
    exerciseName: payload.exerciseName,
    current,
    previous,
    reason,
  };
}

/**
 * The best earlier record of the same lift, as raw SQL over `events`: the
 * lateral join the timeline and a shared record (MSG-11) both read.
 */
export function previousRecordJoin(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
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
            ORDER BY ${recordValue("prior", "weight")} DESC NULLS LAST,
              ${recordValue("prior", "reps")} DESC NULLS LAST,
              prior."occurredAt" DESC, prior."id" DESC
            LIMIT 1
          ) previous ON TRUE`;
}

/**
 * Maps one event row. A record that does not beat the one before it is
 * answered as null and left out of the page: the query already drops such
 * events, and one stale row (TD-58) must never fail the whole timeline.
 */
export function mapProgressTimelineItem(
  row: ProgressTimelineEventRow,
  snapshot: WorkoutSessionSnapshotV1,
): ProgressTimelineItem | null {
  if (row.type === "PERSONAL_RECORD") {
    const parts = personalRecordParts(row);
    if (!parts) return null;
    const item: ProgressTimelinePersonalRecordItem = {
      eventId: row.id,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      session: sessionContext(snapshot),
      ...parts,
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
                  ? {
                      payload: {
                        path: ["exerciseId"],
                        equals: query.exerciseId,
                      },
                    }
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
        // `occurredAt` is a `timestamp` holding UTC wall-clock time. A Date
        // parameter would arrive as `timestamptz` and be shifted by the
        // session's zone before comparing, repeating or skipping rows on any
        // database not set to UTC; the UTC wall clock cast to `timestamp`
        // does not move (the NAV-01 search cursor's rule).
        const cursorAt = cursor
          ? Prisma.sql`CAST(${cursor.occurredAt
              .toISOString()
              .replace("Z", "")} AS timestamp(3))`
          : null;
        const cursorFilter = cursor
          ? Prisma.sql`AND (
              events."occurredAt" < ${cursorAt}
              OR (
                events."occurredAt" = ${cursorAt}
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
          ${previousRecordJoin()}
          WHERE events."userId" = ${userId}
            ${typeFilter}
            ${exerciseFilter}
            ${cursorFilter}
            AND (
              events."type" <> 'PERSONAL_RECORD'
              OR previous."payload" IS NULL
              OR ${recordValue("events", "weight")} > ${recordValue("previous", "weight")}
              OR (
                ${recordValue("events", "weight")} = ${recordValue("previous", "weight")}
                AND ${recordValue("events", "reps")} > ${recordValue("previous", "reps")}
              )
            )
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
        const items = page.flatMap((row) => {
          const snapshot = snapshotsBySession.get(row.sessionId);
          if (!snapshot) {
            throw new Error(
              `Missing session snapshot for training event: ${row.id}`,
            );
          }
          return mapProgressTimelineItem(row, snapshot) ?? [];
        });

        return {
          items,
          // The last row read, not the last item kept, so a skipped row can
          // never end the feed early or be read twice.
          nextCursor: hasNext ? page.at(-1)?.id : undefined,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
