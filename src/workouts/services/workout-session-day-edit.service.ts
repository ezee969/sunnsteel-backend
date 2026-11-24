import {
  BadRequestException,
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
  reorderedDay,
} from "../session-day-edit";
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
      );
      // The routine from the next workout: the same order on its rows, in
      // place. A row the workout does not hold keeps its place after them.
      const rows = await tx.routineExercise.findMany({
        where: { routineDayId: session.routineDayId },
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
      return this.save(tx, session, {
        ...snapshot,
        routineDay: { ...snapshot.routineDay, exercises },
      });
    });
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
