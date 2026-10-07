import { NotFoundException } from "@nestjs/common";
import { WorkoutSessionStatus } from "@prisma/client";
import {
  apiError,
  type MessageAttachment,
  type MessageWorkoutSummary,
  type SharedRoutine,
  type SharedRoutineSummary,
  type SharedWorkout,
  type SharedWorkoutExercise,
  type WorkoutSessionRecap,
} from "@sunsteel/contracts";
import type { DatabaseService } from "../database/database.service";
import { withoutOwnersBlocks } from "../routines/linear-periodization";
import { ROUTINE_WITH_DAYS_SELECT } from "../routines/routine.selects";
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from "../routines/routine-summary";
import { captureRoutineSetup } from "../routines/routine-versions";
import { isHiddenFromViewer } from "../users/member-blocks";
import { readSnapshot } from "../workouts/analytics/session-snapshot";
import { routineDayName } from "../workouts/workout-session.selects";

/**
 * MSG-07 and MSG-10: what a message carries beside its text -- one of the
 * sender's routines or finished workouts. Sending it is the sender's consent,
 * like a `ROUT-04` or `SOC-07` link, to the conversation's other participant:
 * they may open it whatever the sender's privacy, until the message is
 * deleted. Nothing is copied into the message; the card and the object are
 * read as they are now, so an edit or a correction shows and a deleted or
 * hidden object reads as no longer available.
 */

export type AttachmentKind = "ROUTINE" | "WORKOUT";

export interface AttachmentRef {
  senderId: string;
  attachmentKind?: AttachmentKind | null;
  attachmentId?: string | null;
}

/** The objects a page of messages carries, keyed by id, as they are now. */
export interface MessageObjects {
  routines: ReadonlyMap<string, SharedRoutineSummary>;
  workouts: ReadonlyMap<string, MessageWorkoutSummary>;
}

export const NO_OBJECTS: MessageObjects = {
  routines: new Map(),
  workouts: new Map(),
};

/**
 * Whether the viewer reads what a message carries: never once it is deleted,
 * nor while moderation hides it from them (its author still does). The same
 * rule as its text.
 */
export function attachmentFor(
  row: AttachmentRef & {
    deletedAt: Date | null;
    moderationHiddenAt: Date | null;
  },
  viewerId: string,
  objects: MessageObjects = NO_OBJECTS,
): MessageAttachment | null {
  if (!row.attachmentKind || !row.attachmentId) return null;
  if (row.deletedAt !== null) return null;
  if (row.moderationHiddenAt !== null && row.senderId !== viewerId) return null;
  return row.attachmentKind === "ROUTINE"
    ? {
        kind: "ROUTINE",
        routine: objects.routines.get(row.attachmentId) ?? null,
      }
    : {
        kind: "WORKOUT",
        workout: objects.workouts.get(row.attachmentId) ?? null,
      };
}

const WORKOUT_SUMMARY_SELECT = {
  id: true,
  userId: true,
  startedAt: true,
  endedAt: true,
  durationSec: true,
  totalVolumeKg: true,
  completedSets: true,
  snapshot: { select: { payload: true } },
  routine: { select: { name: true } },
  routineDay: { select: { dayOfWeek: true, name: true, order: true } },
} as const;

interface WorkoutSummaryRow {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  totalVolumeKg: number | null;
  completedSets: number | null;
  snapshot: { payload: unknown } | null;
  routine: { name: string } | null;
  routineDay: {
    dayOfWeek: number | null;
    name: string | null;
    order: number;
  } | null;
}

function snapshotOf(row: { snapshot: { payload: unknown } | null }) {
  if (!row.snapshot) return null;
  try {
    return readSnapshot(row.snapshot.payload);
  } catch {
    return null;
  }
}

/** A workout's card, named as its recap names it, from the stored totals. */
export function toWorkoutSummary(
  row: WorkoutSummaryRow & { endedAt: Date },
): MessageWorkoutSummary {
  const snapshot = snapshotOf(row);
  return {
    sessionId: row.id,
    routineName: snapshot?.routine.name ?? row.routine?.name ?? "Workout",
    dayName: routineDayName(snapshot?.routineDay ?? row.routineDay),
    endedAt: row.endedAt.toISOString(),
    durationSec:
      row.durationSec ??
      Math.max(
        0,
        Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000),
      ),
    totalVolumeKg: row.totalVolumeKg ?? 0,
    completedSets: row.completedSets ?? 0,
  };
}

type ObjectDb = Pick<DatabaseService, "routine" | "workoutSession">;

/**
 * The objects some messages carry, read once for the page. One counts only
 * while it is still its sender's: a routine moderation has not hidden -- a
 * hide is "hidden from everyone", and a message must not be a way around
 * it -- and a workout that is still a finished one.
 */
export async function messageObjects(
  db: ObjectDb,
  rows: AttachmentRef[],
): Promise<MessageObjects> {
  const routineIds = new Map<string, string>();
  const sessionIds = new Map<string, string>();
  for (const row of rows) {
    if (!row.attachmentId) continue;
    if (row.attachmentKind === "ROUTINE") {
      routineIds.set(row.attachmentId, row.senderId);
    } else if (row.attachmentKind === "WORKOUT") {
      sessionIds.set(row.attachmentId, row.senderId);
    }
  }
  const routines = routineIds.size
    ? await db.routine.findMany({
        where: {
          id: { in: [...routineIds.keys()] },
          moderationHiddenAt: null,
        },
        select: { ...ROUTINE_SUMMARY_SELECT, userId: true },
      })
    : [];
  const workouts = sessionIds.size
    ? await db.workoutSession.findMany({
        where: {
          id: { in: [...sessionIds.keys()] },
          status: WorkoutSessionStatus.COMPLETED,
          endedAt: { not: null },
        },
        select: WORKOUT_SUMMARY_SELECT,
      })
    : [];
  return {
    routines: new Map(
      routines
        .filter((routine) => routineIds.get(routine.id) === routine.userId)
        .map((routine) => [routine.id, toSharedRoutineSummary(routine)]),
    ),
    workouts: new Map(
      workouts.flatMap((session) =>
        sessionIds.get(session.id) === session.userId && session.endedAt
          ? [
              [
                session.id,
                toWorkoutSummary({ ...session, endedAt: session.endedAt }),
              ] as const,
            ]
          : [],
      ),
    ),
  };
}

/**
 * What a send carries: at most one object, and only the sender's own -- a
 * routine moderation has not hidden, or a finished workout. Anything else is
 * the 404 an object they cannot see gets.
 */
export async function assertSendableRoutine(
  db: Pick<DatabaseService, "routine">,
  senderId: string,
  routineId: string,
): Promise<void> {
  const routine = await db.routine.findFirst({
    where: { id: routineId, userId: senderId, moderationHiddenAt: null },
    select: { id: true },
  });
  if (!routine) throw new NotFoundException(apiError("ROUTINE_NOT_FOUND"));
}

export async function assertSendableWorkout(
  db: Pick<DatabaseService, "workoutSession">,
  senderId: string,
  sessionId: string,
): Promise<void> {
  const session = await db.workoutSession.findFirst({
    where: {
      id: sessionId,
      userId: senderId,
      status: WorkoutSessionStatus.COMPLETED,
      endedAt: { not: null },
    },
    select: { id: true },
  });
  if (!session) {
    throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
  }
}

type GateDb = Pick<DatabaseService, "message" | "userBlock" | "user">;

/**
 * The gate every opened object passes: the viewer must be a participant who
 * can still read that message where it is -- after their own "delete
 * conversation", while it is neither deleted nor hidden from them, and with
 * no block or hide between the two, the conversation's own gate. It answers
 * the sender and the object's id, or throws `notFound`.
 */
async function openSharedObject(
  db: GateDb,
  viewerId: string,
  messageId: string,
  kind: AttachmentKind,
  notFound: () => Error,
  conversationId?: string,
): Promise<{ senderId: string; objectId: string }> {
  const message = await db.message.findFirst({
    where: {
      id: messageId,
      ...(conversationId ? { conversationId } : {}),
      conversation: { participants: { some: { userId: viewerId } } },
    },
    select: {
      senderId: true,
      deletedAt: true,
      moderationHiddenAt: true,
      createdAt: true,
      attachmentKind: true,
      attachmentId: true,
      conversation: {
        select: { participants: { select: { userId: true, clearedAt: true } } },
      },
    },
  });
  if (!message || message.attachmentKind !== kind) throw notFound();
  if (!attachmentFor(message, viewerId) || !message.attachmentId) {
    throw notFound();
  }
  const mine = message.conversation.participants.find(
    (row) => row.userId === viewerId,
  );
  if (mine?.clearedAt && message.createdAt <= mine.clearedAt) throw notFound();
  const other = message.conversation.participants.find(
    (row) => row.userId !== viewerId,
  );
  if (other && (await isHiddenFromViewer(db, viewerId, other.userId))) {
    throw notFound();
  }
  return { senderId: message.senderId, objectId: message.attachmentId };
}

const OWNER_SELECT = {
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

type ReadDb = GateDb & Pick<DatabaseService, "routine">;

/**
 * MSG-07: the routine a message shared, in full, as it is now. Every refusal
 * is the same 404, so a message cannot be used to learn whether a routine
 * exists.
 */
export async function readMessageRoutine(
  db: ReadDb,
  viewerId: string,
  messageId: string,
  conversationId?: string,
): Promise<SharedRoutine> {
  const notFound = () => new NotFoundException(apiError("ROUTINE_NOT_FOUND"));
  const { senderId, objectId } = await openSharedObject(
    db,
    viewerId,
    messageId,
    "ROUTINE",
    notFound,
    conversationId,
  );
  const routine = await db.routine.findFirst({
    where: { id: objectId, userId: senderId, moderationHiddenAt: null },
    select: { ...ROUTINE_WITH_DAYS_SELECT, user: { select: OWNER_SELECT } },
  });
  if (!routine) throw notFound();
  return {
    routineId: routine.id,
    setup: withoutOwnersBlocks(captureRoutineSetup(routine)),
    owner: {
      username: routine.user.username ?? "",
      name: routine.user.name,
      lastName: routine.user.lastName,
      avatarUrl: routine.user.avatarUrl,
    },
    source: "MESSAGE",
    updatedAt: routine.updatedAt.toISOString(),
  };
}

/**
 * MSG-10: one exercise's sets as a shared workout shows them -- in the order
 * the day trained them (the snapshot's), else as they were first done, each
 * exercise's sets by number. Completed sets only, and never their RPE.
 */
export function sharedWorkoutExercises(
  logs: Array<{
    exerciseId: string;
    routineExerciseId: string | null;
    setNumber: number;
    kind: SharedWorkoutExercise["sets"][number]["kind"];
    weight: number | null;
    reps: number | null;
    completedAt: Date | null;
    exerciseName: string;
  }>,
  dayOrder: string[],
): SharedWorkoutExercise[] {
  const position = (log: (typeof logs)[number]) => {
    const at = log.routineExerciseId
      ? dayOrder.indexOf(log.routineExerciseId)
      : -1;
    return at < 0 ? dayOrder.length : at;
  };
  const firstDone = new Map<string, number>();
  for (const log of logs) {
    const at = log.completedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const key = `${log.routineExerciseId}|${log.exerciseId}`;
    firstDone.set(key, Math.min(firstDone.get(key) ?? at, at));
  }
  const groups = new Map<string, typeof logs>();
  for (const log of logs) {
    const key = `${log.routineExerciseId}|${log.exerciseId}`;
    groups.set(key, [...(groups.get(key) ?? []), log]);
  }
  return [...groups.entries()]
    .sort(
      ([a, [first]], [b, [second]]) =>
        position(first) - position(second) ||
        (firstDone.get(a) ?? 0) - (firstDone.get(b) ?? 0),
    )
    .map(([, sets]) => ({
      exerciseId: sets[0].exerciseId,
      name: sets[0].exerciseName,
      sets: [...sets]
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((set) => ({
          setNumber: set.setNumber,
          kind: set.kind,
          weightKg: set.weight,
          reps: set.reps,
        })),
    }));
}

type WorkoutReadDb = GateDb &
  Pick<DatabaseService, "workoutSession" | "setLog">;

/**
 * MSG-10: the workout a message shared, opened: its summary, the records it
 * set (the recap's own) and each exercise's completed sets. `readRecap` is
 * the owner's recap, the same one a `SOC-07` link projects. Every refusal is
 * the same 404.
 */
export async function readMessageWorkout(
  db: WorkoutReadDb,
  readRecap: (
    ownerId: string,
    sessionId: string,
  ) => Promise<WorkoutSessionRecap>,
  viewerId: string,
  messageId: string,
  conversationId?: string,
): Promise<SharedWorkout> {
  const notFound = () =>
    new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
  const { senderId, objectId } = await openSharedObject(
    db,
    viewerId,
    messageId,
    "WORKOUT",
    notFound,
    conversationId,
  );
  const session = await db.workoutSession.findFirst({
    where: {
      id: objectId,
      userId: senderId,
      status: WorkoutSessionStatus.COMPLETED,
      endedAt: { not: null },
    },
    select: {
      ...WORKOUT_SUMMARY_SELECT,
      user: { select: { ...OWNER_SELECT, weightUnit: true } },
    },
  });
  if (!session?.endedAt) throw notFound();
  const [recap, logs] = await Promise.all([
    readRecap(senderId, session.id).catch(() => {
      throw notFound();
    }),
    db.setLog.findMany({
      where: { sessionId: session.id, isCompleted: true },
      select: {
        exerciseId: true,
        routineExerciseId: true,
        setNumber: true,
        kind: true,
        weight: true,
        reps: true,
        completedAt: true,
        exercise: { select: { name: true } },
      },
    }),
  ]);
  const snapshot = snapshotOf(session);
  return {
    ...toWorkoutSummary({ ...session, endedAt: session.endedAt }),
    owner: {
      username: session.user.username ?? "",
      name: session.user.name,
      lastName: session.user.lastName,
      avatarUrl: session.user.avatarUrl,
    },
    weightUnit: session.user.weightUnit,
    records: recap.records,
    exercises: sharedWorkoutExercises(
      logs.map((log) => ({ ...log, exerciseName: log.exercise.name })),
      (snapshot?.routineDay.exercises ?? []).map((exercise) => exercise.id),
    ),
  };
}
