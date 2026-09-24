import { ConflictException } from '@nestjs/common';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProgressionScheme } from '@prisma/client';
import { Routine, RoutineScheduleMode, SetKind } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { resolveRoutineLineage } from './routine-lineage';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { ROUTINE_OWNER_SELECT, ROUTINE_TOGGLE_SELECT } from './routine.selects';
import {
  RoutineOwnerEntity,
  toRoutineResponse,
  toTemporaryOverridePlan,
  toTrainingBlockPlan,
} from './routine.mapper';
import {
  nextRotationDayId,
  normalizeRestDays,
  normalizeRotationWeekdays,
  normalizeRoutineDays,
} from './routine-schedule';

type RoutineSetInput = {
  setNumber: number;
  repType: 'RANGE' | 'FIXED';
  reps?: number | null;
  minReps?: number | null;
  maxReps?: number | null;
  weight?: number | null;
  rir?: number | null;
  kind?: SetKind;
};

type RoutineExerciseInput = {
  exerciseId: string;
  order?: number;
  restSeconds: number;
  note?: string;
  progressionScheme: ProgressionScheme;
  minWeightIncrement?: number;
  sets: RoutineSetInput[];
};

type RoutineDayInput = {
  dayOfWeek: number | null;
  name: string | null;
  order: number;
  exercises: RoutineExerciseInput[];
};

/** The day's order when a session ran, from its snapshot (ROUT-11). */
function snapshotDayOrder(payload: unknown): number | null {
  const order = (payload as { routineDay?: { order?: unknown } } | null)
    ?.routineDay?.order;
  return typeof order === 'number' ? order : null;
}

@Injectable()
export class RoutinesService {
  constructor(private readonly db: DatabaseService) {}

  private mapRoutineSetForCreate(set: RoutineSetInput) {
    if (set.repType === 'RANGE') {
      if (typeof set.minReps !== 'number' || typeof set.maxReps !== 'number') {
        throw new BadRequestException(
          'For RANGE repType, minReps and maxReps are required',
        );
      }
      if (set.minReps > set.maxReps) {
        throw new BadRequestException(
          'minReps must be less than or equal to maxReps',
        );
      }
    } else if (set.repType === 'FIXED') {
      if (typeof set.reps !== 'number') {
        throw new BadRequestException('For FIXED repType, reps is required');
      }
    }

    const repTypeVal: 'RANGE' | 'FIXED' =
      set.repType === 'RANGE' ? 'RANGE' : 'FIXED';

    return {
      setNumber: set.setNumber,
      repType: repTypeVal,
      weight: set.weight,
      kind: set.kind ?? 'WORKING',
      ...(typeof set.rir === 'number' ? { rir: set.rir } : {}),
      ...(repTypeVal === 'FIXED' && typeof set.reps === 'number'
        ? { reps: set.reps }
        : {}),
      ...(repTypeVal === 'RANGE' &&
      typeof set.minReps === 'number' &&
      typeof set.maxReps === 'number'
        ? { minReps: set.minReps, maxReps: set.maxReps }
        : {}),
    };
  }

  private mapRoutineExerciseForCreate(exercise: RoutineExerciseInput) {
    return {
      exercise: { connect: { id: exercise.exerciseId } },
      order: exercise.order ?? 0,
      restSeconds: exercise.restSeconds,
      note: exercise.note,
      progressionScheme: exercise.progressionScheme ?? 'NONE',
      minWeightIncrement: exercise.minWeightIncrement ?? 2.5,
      sets: {
        create: exercise.sets.map((set) => this.mapRoutineSetForCreate(set)),
      },
    };
  }

  private mapRoutineDayForCreate(day: RoutineDayInput) {
    return {
      dayOfWeek: day.dayOfWeek,
      name: day.name,
      order: day.order,
      exercises: {
        create: day.exercises.map((exercise) =>
          this.mapRoutineExerciseForCreate(exercise),
        ),
      },
    };
  }

  /**
   * ROUT-11: a ROTATION routine reports the day after its last completed
   * session (aborted ones do not advance it). One indexed lookup per rotation
   * routine; weekly routines need none.
   */
  private async toResponses(
    userId: string,
    routines: RoutineOwnerEntity[],
    db: Prisma.TransactionClient = this.db,
  ): Promise<Routine[]> {
    // ROUT-06: these are the owner's own routines, so no follow or block can
    // stand between them and a source they cloned; only the source routine's
    // own rules apply, which `resolveRoutineLineage` reads.
    const lineageFor = (routine: RoutineOwnerEntity) =>
      resolveRoutineLineage(
        {
          routineId: routine.clonedFromRoutine?.id ?? null,
          clonedAt: routine.clonedAt,
          author: routine.clonedFromUser
            ? {
                id: routine.clonedFromUser.id,
                username: routine.clonedFromUser.username ?? '',
                name: routine.clonedFromUser.name,
                lastName: routine.clonedFromUser.lastName,
                avatarUrl: routine.clonedFromUser.avatarUrl,
              }
            : null,
          sourceVisibility: routine.clonedFromRoutine?.visibility ?? null,
          sourceModerationHiddenAt:
            routine.clonedFromRoutine?.moderationHiddenAt ?? null,
          authorRoutinesRule:
            routine.clonedFromUser?.routinesVisibility ?? null,
        },
        {
          isOwner: routine.clonedFromUser?.id === userId,
          isFollower: false,
          isBlocked: false,
        },
      );

    // ROUT-11/ROUT-15: a rotation continues from the last completed session of
    // the same plan -- the baseline counts only baseline sessions and each
    // block only its own series -- so a block starts on its first day and the
    // baseline resumes where it left off once the block ends.
    const nextDayAfterLast = async (
      routineId: string,
      trainingBlockSeriesId: string | null,
      days: ReadonlyArray<{ id: string; order: number }>,
    ) => {
      const last = await db.workoutSession.findFirst({
        where: {
          userId,
          routineId,
          trainingBlockSeriesId,
          status: 'COMPLETED',
        },
        orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
        select: {
          routineDayId: true,
          snapshot: { select: { payload: true } },
        },
      });
      return nextRotationDayId(
        days,
        last
          ? {
              routineDayId: last.routineDayId,
              order: snapshotDayOrder(last.snapshot?.payload),
            }
          : null,
      );
    };

    return Promise.all(
      routines.map(async (routine) => {
        const trainingBlocks = await Promise.all(
          routine.trainingBlocks.map(async (block) => {
            const plan = toTrainingBlockPlan(block);
            return plan.scheduleMode === 'ROTATION'
              ? {
                  ...plan,
                  nextRotationDayId: await nextDayAfterLast(
                    routine.id,
                    block.seriesId,
                    block.days,
                  ),
                }
              : plan;
          }),
        );
        const next =
          routine.scheduleMode === 'ROTATION'
            ? await nextDayAfterLast(routine.id, null, routine.days)
            : null;
        // ROUT-16: a deload continues the rotation of the plan it lightened.
        const orderOf = (days: { id: string; order: number }[], id: string | null) =>
          days.find((day) => day.id === id)?.order ?? null;
        const temporaryOverrides = routine.temporaryOverrides.map((row) => {
          const block = row.sourceTrainingBlockSeriesId
            ? trainingBlocks.find(
                (plan) => plan.seriesId === row.sourceTrainingBlockSeriesId,
              )
            : null;
          const underlyingNextOrder = block
            ? orderOf(block.days, block.nextRotationDayId)
            : orderOf(routine.days, next);
          return toTemporaryOverridePlan(row, underlyingNextOrder);
        });
        return toRoutineResponse(
          routine,
          next,
          lineageFor(routine),
          trainingBlocks,
          temporaryOverrides,
        );
      }),
    );
  }

  private async toResponse(
    userId: string,
    routine: RoutineOwnerEntity,
    db: Prisma.TransactionClient = this.db,
  ): Promise<Routine> {
    const [response] = await this.toResponses(userId, [routine], db);
    return response;
  }

  async create(userId: string, dto: CreateRoutineDto): Promise<Routine> {
    const scheduleMode: RoutineScheduleMode = dto.scheduleMode ?? 'WEEKLY';
    const days = normalizeRoutineDays(scheduleMode, dto.days);
    const routine = await this.db.routine.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        name: dto.name,
        description: dto.description,
        // ROUT-07: undeclared stays undeclared; there is no default claim.
        goal: dto.goal ?? null,
        experienceLevel: dto.experienceLevel ?? null,
        isPeriodized: false,
        scheduleMode,
        restDays: normalizeRestDays(scheduleMode, days, dto.restDays),
        rotationWeekdays: normalizeRotationWeekdays(
          scheduleMode,
          dto.rotationWeekdays,
        ),
        days: {
          create: days.map((day) => this.mapRoutineDayForCreate(day)),
        },
      },
      select: ROUTINE_OWNER_SELECT,
    });
    return this.toResponse(userId, routine);
  }

  async findAll(
    userId: string,
    filter?: { isFavorite?: boolean; isCompleted?: boolean },
  ): Promise<Routine[]> {
    const where: Prisma.RoutineWhereInput = { userId };
    if (typeof filter?.isFavorite === 'boolean') {
      where.isFavorite = filter.isFavorite;
    }
    if (typeof filter?.isCompleted === 'boolean') {
      where.isCompleted = filter.isCompleted;
    }

    const routines = await this.db.routine.findMany({
      where,
      select: ROUTINE_OWNER_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return this.toResponses(userId, routines);
  }

  async findOne(userId: string, id: string): Promise<Routine> {
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: ROUTINE_OWNER_SELECT,
    });

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    return this.toResponse(userId, routine);
  }

  update(userId: string, id: string, dto: UpdateRoutineDto): Promise<Routine> {
    return this.db.$transaction((tx) =>
      this.updateInTransaction(tx, userId, id, dto),
    );
  }

  /** A routine edit inside the caller's transaction (ROUT-08 restores). */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    dto: UpdateRoutineDto,
  ): Promise<Routine> {
    await lockTrainingAccount(tx, userId);
    await this.assertHistorySafe(tx, userId, id, !!dto.days);
    // Verify ownership
    const existing = await tx.routine.findFirst({
      where: { id, userId },
      select: {
        id: true,
        scheduleMode: true,
        restDays: true,
        rotationWeekdays: true,
        days: {
          where: { trainingBlockId: null, temporaryOverrideId: null },
          select: { dayOfWeek: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to edit it.',
      );
    }

    const scheduleMode = dto.scheduleMode ?? existing.scheduleMode;
    if (scheduleMode !== existing.scheduleMode && !dto.days) {
      throw new BadRequestException(
        'Changing the schedule mode requires the routine days',
      );
    }
    const days = dto.days
      ? normalizeRoutineDays(scheduleMode, dto.days)
      : undefined;
    // SCHED-07: omitted rest days are kept, minus new training weekdays.
    const restDays = normalizeRestDays(
      scheduleMode,
      days ?? existing.days,
      dto.restDays,
      existing.restDays,
    );
    // SCHED-06: omitted training weekdays are kept; a weekly routine has none.
    const rotationWeekdays = normalizeRotationWeekdays(
      scheduleMode,
      dto.rotationWeekdays,
      existing.rotationWeekdays,
    );

    // Remove current days (cascade removes exercises and sets)
    // Only delete and recreate days if days array is provided in the update
    if (dto.days) {
      // ROUT-15: the baseline only; a block's working copy is not the routine's.
      await tx.routineDay.deleteMany({
        where: { routineId: id, trainingBlockId: null, temporaryOverrideId: null },
      });
    }

    const updated = await tx.routine.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.goal !== undefined && { goal: dto.goal }),
        ...(dto.experienceLevel !== undefined && {
          experienceLevel: dto.experienceLevel,
        }),
        isPeriodized: false,
        scheduleMode,
        restDays,
        rotationWeekdays,
        ...(days && {
          days: {
            create: days.map((day) => this.mapRoutineDayForCreate(day)),
          },
        }),
      },
      select: ROUTINE_OWNER_SELECT,
    });

    return this.toResponse(userId, updated, tx);
  }

  async updateExerciseNote(
    userId: string,
    routineId: string,
    routineExerciseId: string,
    note: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      await this.assertHistorySafe(tx, userId, routineId, false);
      // Verify ownership
      const routine = await tx.routine.findFirst({
        where: { id: routineId, userId },
      });
      if (!routine) {
        throw new NotFoundException('Routine not found');
      }

      // Verify routineExercise belongs to routine
      const re = await tx.routineExercise.findFirst({
        where: {
          id: routineExerciseId,
          routineDay: { routineId },
        },
      });

      if (!re) {
        throw new NotFoundException('Exercise not found in this routine');
      }

      return tx.routineExercise.update({
        where: { id: routineExerciseId },
        data: { note },
      });
    });
  }

  async setFavorite(userId: string, id: string, isFavorite: boolean) {
    // Ensure routine belongs to user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!routine) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to modify it.',
      );
    }

    return this.db.routine.update({
      where: { id },
      data: { isFavorite },
      select: ROUTINE_TOGGLE_SELECT,
    });
  }

  async setCompleted(userId: string, id: string, isCompleted: boolean) {
    // Ensure routine belongs to user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!routine) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to modify it.',
      );
    }

    return this.db.routine.update({
      where: { id },
      data: { isCompleted },
      select: ROUTINE_TOGGLE_SELECT,
    });
  }

  async findCompleted(userId: string): Promise<Routine[]> {
    const routines = await this.db.routine.findMany({
      where: { userId, isCompleted: true },
      select: ROUTINE_OWNER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(userId, routines);
  }

  async findFavorites(userId: string): Promise<Routine[]> {
    const routines = await this.db.routine.findMany({
      where: { userId, isFavorite: true },
      select: ROUTINE_OWNER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return this.toResponses(userId, routines);
  }

  async remove(userId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      await this.assertHistorySafe(tx, userId, id, true);
      const routine = await tx.routine.findFirst({ where: { id, userId } });
      if (!routine) throw new NotFoundException('Routine not found');
      return tx.routine.delete({ where: { id } });
    });
  }

  private async assertHistorySafe(
    tx: Prisma.TransactionClient,
    userId: string,
    routineId: string,
    structural: boolean,
  ) {
    if (
      structural &&
      (await tx.workoutSession.findFirst({
        where: { userId, routineId, status: 'IN_PROGRESS' },
        select: { id: true },
      }))
    ) {
      throw new ConflictException(
        'Finish the active session before changing the routine structure',
      );
    }
    if (
      await tx.workoutSession.findFirst({
        where: { userId, routineId, snapshot: { is: null } },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'Historical snapshots are still being prepared; retry after analytics setup',
      );
    }
    if (
      structural &&
      (await tx.workoutSession.findFirst({
        where: { userId, routineId },
        select: { id: true },
      }))
    ) {
      // Check the actual FK, not an env flag that could authorize data loss.
      const constraints = await tx.$queryRaw<
        Array<{ confdeltype: string }>
      >`SELECT confdeltype::text FROM pg_constraint
        WHERE conrelid = '"WorkoutSession"'::regclass AND conname IN ('WorkoutSession_routineId_fkey', 'WorkoutSession_routineDayId_fkey')
        UNION ALL SELECT confdeltype::text FROM pg_constraint WHERE conrelid = '"SetLog"'::regclass AND conname = 'SetLog_routineExerciseId_fkey'`;
      if (
        constraints.length !== 3 ||
        constraints.some((c) => c.confdeltype !== 'n')
      ) {
        throw new ConflictException(
          'History-preserving routine changes require the analytics FK cutover',
        );
      }
    }
  }
}
