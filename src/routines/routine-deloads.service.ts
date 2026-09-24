import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyDeload,
  DELOAD_MAX_DAYS,
  DELOAD_NOT_LIGHTER,
  type CreateDeloadRequest,
  type RoutineTemporaryOverride,
  type RoutineTemporaryOverridesResponse,
  type RoutineVersionSetup,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { localClock } from '../notifications/push/local-time';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import { ROUTINE_OWNER_SELECT } from './routine.selects';
import { assertDeloadDates, endedEarlyEndDate } from './routine-deloads';
import { captureRoutineSetup, readRoutineSetup } from './routine-versions';
import { workingCopyDays } from './routine-working-copy';

const OVERRIDE_SELECT = {
  id: true,
  routineId: true,
  kind: true,
  startDate: true,
  endDate: true,
  loadReductionPercent: true,
  setMode: true,
  sourceKind: true,
  sourceTrainingBlockSeriesId: true,
  sourceTrainingBlockName: true,
  originalSetup: true,
  setup: true,
  endedEarlyAt: true,
  createdAt: true,
} as const;

type OverrideEntity = Prisma.RoutineTemporaryOverrideGetPayload<{
  select: typeof OVERRIDE_SELECT;
}>;

const ROUTINE_FOR_DELOAD_SELECT = {
  ...ROUTINE_OWNER_SELECT,
  user: { select: { timeZone: true } },
} as const;

function overrideState(
  row: { startDate: string; endDate: string },
  today: string,
): RoutineTemporaryOverride['state'] {
  if (row.endDate < today || row.endDate < row.startDate) return 'COMPLETE';
  return today < row.startDate ? 'FUTURE' : 'ACTIVE';
}

function toOverride(
  row: OverrideEntity,
  today: string,
): RoutineTemporaryOverride {
  return {
    id: row.id,
    routineId: row.routineId,
    kind: row.kind,
    startDate: row.startDate,
    endDate: row.endDate,
    loadReductionPercent:
      row.loadReductionPercent as RoutineTemporaryOverride['loadReductionPercent'],
    setMode: row.setMode,
    source: {
      kind: row.sourceKind,
      trainingBlockId: row.sourceTrainingBlockSeriesId,
      trainingBlockName: row.sourceTrainingBlockName,
    },
    originalSetup: readRoutineSetup(row.originalSetup),
    setup: readRoutineSetup(row.setup),
    endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    state: overrideState(row, today),
  };
}

/**
 * ROUT-16: temporary deload overrides. A deload copies the prescription in
 * force on its dates -- a training block's working copy with its progressed
 * loads, or the baseline -- makes it lighter with contracts' `applyDeload`, and
 * is trained through its own working copy, so neither the routine nor the
 * block ever changes. `resolveRoutinePlan` gives it precedence on its dates.
 */
@Injectable()
export class RoutineDeloadsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    userId: string,
    routineId: string,
  ): Promise<RoutineTemporaryOverridesResponse> {
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { user: { select: { timeZone: true } } },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    const today = localClock(new Date(), routine.user.timeZone ?? 'UTC').date;
    const rows = await this.db.routineTemporaryOverride.findMany({
      where: { routineId },
      select: OVERRIDE_SELECT,
      orderBy: { startDate: 'desc' },
      take: 26,
    });
    return {
      overrides: rows.map((row) => toOverride(row, today)),
      maxDays: DELOAD_MAX_DAYS,
      today,
    };
  }

  create(
    userId: string,
    routineId: string,
    input: CreateDeloadRequest,
  ): Promise<RoutineTemporaryOverride> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await tx.routine.findFirst({
        where: { id: routineId, userId },
        select: ROUTINE_FOR_DELOAD_SELECT,
      });
      if (!routine) throw new NotFoundException('Routine not found');
      const today = localClock(new Date(), routine.user.timeZone ?? 'UTC').date;
      const others = await tx.routineTemporaryOverride.findMany({
        where: { routineId },
        select: { startDate: true, endDate: true },
      });
      const block = assertDeloadDates({
        startDate: input.startDate,
        endDate: input.endDate,
        today,
        overrides: others,
        blocks: routine.trainingBlocks,
      });
      const source = block
        ? routine.trainingBlocks.find((candidate) => candidate.id === block.id)
        : null;

      // The prescription in force: the block's working copy, whose loads may
      // have progressed since it was authored, with the block's schedule; or
      // the routine as it is now.
      let original: RoutineVersionSetup;
      if (source) {
        const authored = readRoutineSetup(source.setup);
        original = captureRoutineSetup({
          ...routine,
          scheduleMode: authored.scheduleMode,
          restDays:
            authored.scheduleMode === 'WEEKLY' ? [...authored.restDays] : [],
          rotationWeekdays:
            authored.scheduleMode === 'ROTATION'
              ? [...(authored.rotationWeekdays ?? [])]
              : [],
          days: source.days,
        });
      } else {
        original = captureRoutineSetup(routine);
      }
      if (original.days.every((day) => day.exercises.length === 0)) {
        throw new BadRequestException('There is nothing to deload yet');
      }
      const lighter = applyDeload(original, input);
      if (!lighter) throw new BadRequestException(DELOAD_NOT_LIGHTER);

      const row = await tx.routineTemporaryOverride.create({
        data: {
          routineId,
          kind: 'DELOAD',
          startDate: input.startDate,
          endDate: input.endDate,
          loadReductionPercent: input.loadReductionPercent,
          setMode: input.setMode,
          sourceKind: source ? 'TRAINING_BLOCK' : 'BASELINE',
          sourceTrainingBlockSeriesId: source?.seriesId ?? null,
          sourceTrainingBlockName: source?.name ?? null,
          originalSetup: original as unknown as Prisma.InputJsonValue,
          setup: lighter as unknown as Prisma.InputJsonValue,
          days: workingCopyDays(routineId, lighter),
        },
        select: OVERRIDE_SELECT,
      });
      return toOverride(row, today);
    });
  }

  /** Stops an active deload from today; what it trained stays as it was. */
  endEarly(
    userId: string,
    routineId: string,
    overrideId: string,
  ): Promise<RoutineTemporaryOverride> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const { row, today } = await this.owned(
        tx,
        userId,
        routineId,
        overrideId,
      );
      if (overrideState(row, today) !== 'ACTIVE') {
        throw new ConflictException(
          'Only a deload in progress can be ended early',
        );
      }
      const updated = await tx.routineTemporaryOverride.update({
        where: { id: row.id },
        data: { endDate: endedEarlyEndDate(today), endedEarlyAt: new Date() },
        select: OVERRIDE_SELECT,
      });
      return toOverride(updated, today);
    });
  }

  /** Cancels a deload that has not started; its working copy goes with it. */
  async cancel(userId: string, routineId: string, overrideId: string) {
    await this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const { row, today } = await this.owned(
        tx,
        userId,
        routineId,
        overrideId,
      );
      if (overrideState(row, today) !== 'FUTURE') {
        throw new ConflictException(
          'Only a deload that has not started can be cancelled',
        );
      }
      await tx.routineTemporaryOverride.delete({ where: { id: row.id } });
    });
  }

  private async owned(
    tx: Prisma.TransactionClient,
    userId: string,
    routineId: string,
    overrideId: string,
  ) {
    const routine = await tx.routine.findFirst({
      where: { id: routineId, userId },
      select: { user: { select: { timeZone: true } } },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    const row = await tx.routineTemporaryOverride.findFirst({
      where: { id: overrideId, routineId },
      select: OVERRIDE_SELECT,
    });
    if (!row) throw new NotFoundException('Deload not found');
    return {
      row,
      today: localClock(new Date(), routine.user.timeZone ?? 'UTC').date,
    };
  }
}
