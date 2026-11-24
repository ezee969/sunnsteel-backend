import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkoutSessionStatus } from "@prisma/client";
import {
  DAY_EDIT_EXERCISES_MAX,
  apiError,
  type SessionDayEditResponse,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";
import { DatabaseService } from "../../database/database.service";
import { usableExerciseWhere } from "../../exercises/exercise-access";
import { assertMatchSets } from "../../routines/match-sets";
import { routineSetCreateData } from "../../routines/routine-set-data";
import { lockTrainingAccount } from "../analytics/analytics-lock";
import { ensureSessionSnapshot } from "../analytics/session-snapshot";
import {
  AddSessionExerciseDto,
  ReorderSessionExercisesDto,
} from "../dto/session-day-edit.dto";
import {
  assertSetNumbers,
  dayEditPlan,
  plannedExerciseRemoval,
  plannedSetRemoval,
  reorderedDay,
} from "../session-day-edit";
import { readExerciseNotes } from "../session-notes";
import {
  readSubstitutions,
  withoutSubstitution,
} from "../session-substitutions";
import { toWorkoutSessionResponse } from "../workout-session.mapper";
import { buildWorkoutSessionSelect } from "../workout-session.selects";

/** A routine exercise as the snapshot captures it (`ensureSessionSnapshot`). */
const SNAPSHOT_EXERCISE_SELECT =
  buildWorkoutSessionSelect().routineDay.select.exercises.select;

type SnapshotExercise =
  WorkoutSessionSnapshotV1["routineDay"]["exercises"][number];

/**
 * LIVE-25: change the day being trained, for good, from the live workout.
 *
 * Every change is a routine change first -- written in place to the plan the
 * workout trains (a block's or deload's working copy while one is in force),
 * never by recreating the day's rows, which would orphan the workout's set
 * logs -- and the workout's snapshot follows at once, so the set-log checks,
 * the finish, the recap and corrections read the day as it now stands. An
 * exercise for today only is still not offered.
 */
@Injectable()
export class WorkoutSessionDayEditService {
  constructor(private readonly db: DatabaseService) {}

  addExercise(
    userId: string,
    sessionId: string,
    dto: AddSessionExerciseDto,
  ): Promise<SessionDayEditResponse> {
    return this.db.$transaction(async (tx) => {
      const { session, snapshot } = await this.load(tx, userId, sessionId);
      const exercises = snapshot.routineDay.exercises;
      if (exercises.length >= DAY_EDIT_EXERCISES_MAX)
        throw new BadRequestException(
          apiError("DAY_EDIT_EXERCISES_MAX", { max: DAY_EDIT_EXERCISES_MAX }),
        );
      const exercise = await tx.exercise.findFirst({
        where: { id: dto.exerciseId, ...usableExerciseWhere(userId) },
        select: { id: true },
      });
      if (!exercise)
        throw new NotFoundException(apiError("EXERCISE_NOT_FOUND"));
      assertSetNumbers(dto.sets);
      assertMatchSets(dto.sets, false);

      const last = await tx.routineExercise.findFirst({
        where: { routineDayId: session.routineDayId },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const created = await tx.routineExercise.create({
        data: {
          routineDayId: session.routineDayId,
          exerciseId: dto.exerciseId,
          // At the end of the day: the reorder moves it from there.
          order: Math.max((last?.order ?? -1) + 1, exercises.length),
          restSeconds: dto.restSeconds,
          note: dto.note?.trim() || null,
          progressionScheme: dto.progressionScheme,
          minWeightIncrement: dto.minWeightIncrement ?? 2.5,
          sets: {
            create: [...dto.sets]
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((set) => routineSetCreateData(set)),
          },
        },
        select: SNAPSHOT_EXERCISE_SELECT,
      });

      const added = {
        ...created,
        order: exercises.length,
        linkedToNext: false,
        linearPeriodization: null,
        addedAt: new Date().toISOString(),
      } as unknown as SnapshotExercise;
      return this.save(tx, session, {
        ...snapshot,
        routineDay: {
          ...snapshot.routineDay,
          exercises: [...exercises, added],
        },
      });
    });
  }

  reorder(
    userId: string,
    sessionId: string,
    dto: ReorderSessionExercisesDto,
  ): Promise<SessionDayEditResponse> {
    return this.db.$transaction(async (tx) => {
      const { session, snapshot } = await this.load(tx, userId, sessionId);
      const exercises = reorderedDay(
        snapshot.routineDay.exercises,
        dto.routineExerciseIds,
        dto.linkedToNext,
      );
      await this.writeDayOrder(tx, session.routineDayId, exercises);
      return this.save(tx, session, {
        ...snapshot,
        routineDay: { ...snapshot.routineDay, exercises },
      });
    });
  }

  /**
   * LIVE-27: remove a prescribed set that is not done, for good -- from the
   * plan being trained and from today's snapshot -- renumbering the sets
   * after it, their routine rows and their logs (extras included), lowest
   * first so no two ever hold one number.
   */
  removeSet(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    setNumber: number,
  ): Promise<SessionDayEditResponse> {
    return this.db.$transaction(async (tx) => {
      const { session, snapshot } = await this.load(tx, userId, sessionId);
      const slot = snapshot.routineDay.exercises.find(
        (exercise) => exercise.id === routineExerciseId,
      );
      if (!slot)
        throw new NotFoundException(apiError("SESSION_EXERCISE_NOT_FOUND"));
      const logs = await tx.setLog.findMany({
        where: {
          sessionId,
          OR: [
            { sourceRoutineExerciseId: routineExerciseId },
            { sourceRoutineExerciseId: null, routineExerciseId },
          ],
        },
        orderBy: { setNumber: "asc" },
        select: { id: true, setNumber: true, isCompleted: true },
      });
      const swapped = readSubstitutions(
        (
          await tx.workoutSession.findUniqueOrThrow({
            where: { id: sessionId },
            select: { exerciseSubstitutions: true },
          })
        ).exerciseSubstitutions,
      ).some((swap) => swap.routineExerciseId === routineExerciseId);
      const plan = plannedSetRemoval(slot.sets, setNumber, {
        done: logs.some(
          (log) => log.setNumber === setNumber && log.isCompleted,
        ),
        // ROUT-17: a block's working sets are its own, unless swapped today.
        linearBlock: !swapped && Boolean(slot.linearPeriodization),
      });
      if ("refusal" in plan) {
        const code = plan.refusal;
        if (code === "SET_REMOVE_NOT_PRESCRIBED")
          throw new BadRequestException(apiError(code));
        throw new ConflictException(apiError(code));
      }

      // Today's logs: the removed set's draft goes, those after it move down.
      for (const log of logs) {
        if (log.setNumber === setNumber)
          await tx.setLog.delete({ where: { id: log.id } });
        else if (log.setNumber > setNumber)
          await tx.setLog.update({
            where: { id: log.id },
            data: { setNumber: log.setNumber - 1 },
          });
      }

      // The plan being trained, in place.
      const rows = await tx.routineExerciseSet.findMany({
        where: {
          routineExerciseId,
          routineExercise: { routineDayId: session.routineDayId },
        },
        orderBy: { setNumber: "asc" },
        select: { id: true, setNumber: true },
      });
      for (const row of rows) {
        if (row.setNumber === setNumber)
          await tx.routineExerciseSet.delete({ where: { id: row.id } });
        else if (row.setNumber > setNumber)
          await tx.routineExerciseSet.update({
            where: { id: row.id },
            data: { setNumber: row.setNumber - 1 },
          });
      }

      return this.save(tx, session, {
        ...snapshot,
        routineDay: {
          ...snapshot.routineDay,
          exercises: snapshot.routineDay.exercises.map((exercise) =>
            exercise.id === routineExerciseId
              ? { ...exercise, sets: plan.sets }
              : exercise,
          ),
        },
      });
    });
  }

  /**
   * LIVE-28: remove an exercise from the day being trained, for good -- from
   * today's workout with every set it holds, done or not (its work no longer
   * counts: the exercise is gone either way), its swap and its note, and from
   * the plan being trained, its sets and an 8-week block with its row. The
   * day keeps at least one exercise; the rest close up in order, links
   * bridged as the builder bridges them.
   */
  removeExercise(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
  ): Promise<SessionDayEditResponse> {
    return this.db.$transaction(async (tx) => {
      const { session, snapshot } = await this.load(tx, userId, sessionId);
      const plan = plannedExerciseRemoval(
        snapshot.routineDay.exercises,
        routineExerciseId,
      );
      if ("refusal" in plan) {
        if (plan.refusal === "SESSION_EXERCISE_NOT_FOUND")
          throw new NotFoundException(apiError(plan.refusal));
        throw new ConflictException(apiError(plan.refusal));
      }

      // Today: every log of the slot goes, and the slot's swap and note.
      await tx.setLog.deleteMany({
        where: {
          sessionId,
          OR: [
            { sourceRoutineExerciseId: routineExerciseId },
            { sourceRoutineExerciseId: null, routineExerciseId },
          ],
        },
      });
      const facts = await tx.workoutSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { exerciseSubstitutions: true, exerciseNotes: true },
      });
      await tx.workoutSession.update({
        where: { id: sessionId },
        data: {
          exerciseSubstitutions: withoutSubstitution(
            readSubstitutions(facts.exerciseSubstitutions),
            routineExerciseId,
          ) as unknown as Prisma.InputJsonValue,
          exerciseNotes: readExerciseNotes(facts.exerciseNotes).filter(
            (note) => note.routineExerciseId !== routineExerciseId,
          ) as unknown as Prisma.InputJsonValue,
        },
      });

      // The plan being trained, in place: the row goes with its sets (and an
      // 8-week block's state, which lives on it); earlier workouts' logs keep
      // their own snapshot, as after any routine edit.
      await tx.routineExercise.deleteMany({
        where: { id: routineExerciseId, routineDayId: session.routineDayId },
      });
      await this.writeDayOrder(tx, session.routineDayId, plan.exercises);

      return this.save(tx, session, {
        ...snapshot,
        routineDay: { ...snapshot.routineDay, exercises: plan.exercises },
      });
    });
  }

  /**
   * The day's rows in the workout's order, in place, each with the link the
   * workout's day gives it. A row the workout does not hold keeps its place
   * after them, unlinked.
   */
  private async writeDayOrder(
    tx: Prisma.TransactionClient,
    routineDayId: string,
    exercises: readonly SnapshotExercise[],
  ) {
    const rows = await tx.routineExercise.findMany({
      where: { routineDayId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    const position = new Map(exercises.map((e, index) => [e.id, index]));
    let after = exercises.length;
    for (const row of rows) {
      const index = position.get(row.id);
      await tx.routineExercise.update({
        where: { id: row.id },
        data:
          index === undefined
            ? { order: after++, linkedToNext: false }
            : {
                order: index,
                linkedToNext: Boolean(exercises[index].linkedToNext),
              },
      });
    }
  }

  private async load(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
  ) {
    await lockTrainingAccount(tx, userId);
    const session = await tx.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        status: true,
        routineDayId: true,
        trainingBlockId: true,
        temporaryOverrideId: true,
      },
    });
    if (!session)
      throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
    if (
      session.status !== WorkoutSessionStatus.IN_PROGRESS ||
      !session.routineDayId
    )
      throw new BadRequestException(apiError("DAY_EDIT_SESSION_NOT_ACTIVE"));
    const snapshot = await ensureSessionSnapshot(tx, sessionId);
    return {
      session: { ...session, routineDayId: session.routineDayId },
      snapshot,
    };
  }

  private async save(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      trainingBlockId: string | null;
      temporaryOverrideId: string | null;
    },
    snapshot: WorkoutSessionSnapshotV1,
  ): Promise<SessionDayEditResponse> {
    await tx.workoutSessionSnapshot.update({
      where: { sessionId: session.id },
      data: { payload: snapshot as unknown as Prisma.InputJsonValue },
    });
    const updated = await tx.workoutSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
      select: buildWorkoutSessionSelect(true),
    });
    return {
      session: toWorkoutSessionResponse(updated),
      plan: dayEditPlan(session),
    };
  }
}
