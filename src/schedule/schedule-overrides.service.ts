import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ScheduleOverride,
  ScheduleOverridesResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import {
  MoveOccurrenceDto,
  SkipOccurrenceDto,
} from './dto/move-occurrence.dto';
import {
  assertMovable,
  assertOverrideRange,
  assertSkippable,
} from './schedule-overrides';

const OVERRIDE_SELECT = {
  id: true,
  routineId: true,
  date: true,
  kind: true,
  toDate: true,
  createdAt: true,
} as const;

type OverrideEntity = Prisma.ScheduleOverrideGetPayload<{
  select: typeof OVERRIDE_SELECT;
}>;

function toScheduleOverride(row: OverrideEntity): ScheduleOverride {
  return {
    id: row.id,
    routineId: row.routineId,
    date: row.date,
    kind: row.kind,
    toDate: row.toDate,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * SCHED-04/05: the owner's per-date overrides of their routines' plans.
 * Reads are bounded ranges; a move or skip is an upsert on (routine, date),
 * so changing an occurrence again replaces its override.
 */
@Injectable()
export class ScheduleOverridesService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    userId: string,
    from: string,
    to: string,
  ): Promise<ScheduleOverridesResponse> {
    assertOverrideRange(from, to);
    const rows = await this.db.scheduleOverride.findMany({
      where: {
        userId,
        OR: [
          { date: { gte: from, lte: to } },
          { toDate: { gte: from, lte: to } },
        ],
      },
      select: OVERRIDE_SELECT,
      orderBy: [{ date: 'asc' }, { routineId: 'asc' }],
    });
    return { overrides: rows.map(toScheduleOverride) };
  }

  move(
    userId: string,
    dto: MoveOccurrenceDto,
    now = new Date(),
  ): Promise<ScheduleOverride> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await this.occurrenceRoutine(tx, userId, dto.routineId);
      const others = await tx.scheduleOverride.findMany({
        where: { routineId: dto.routineId, NOT: { date: dto.date } },
        select: { date: true, kind: true, toDate: true },
      });
      assertMovable({
        date: dto.date,
        toDate: dto.toDate,
        now,
        routine,
        others,
      });
      return this.upsert(tx, userId, dto.routineId, dto.date, {
        kind: 'MOVE',
        toDate: dto.toDate,
      });
    });
  }

  skip(
    userId: string,
    dto: SkipOccurrenceDto,
    now = new Date(),
  ): Promise<ScheduleOverride> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await this.occurrenceRoutine(tx, userId, dto.routineId);
      assertSkippable({ date: dto.date, now, routine });
      return this.upsert(tx, userId, dto.routineId, dto.date, {
        kind: 'SKIP',
        toDate: null,
      });
    });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.db.scheduleOverride.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new NotFoundException('Override not found');
  }

  private async occurrenceRoutine(
    tx: Prisma.TransactionClient,
    userId: string,
    routineId: string,
  ) {
    const routine = await tx.routine.findFirst({
      where: { id: routineId, userId },
      select: { scheduleMode: true, days: { select: { dayOfWeek: true } } },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    return {
      scheduleMode: routine.scheduleMode,
      trainingWeekdays: routine.days
        .map((day) => day.dayOfWeek)
        .filter((weekday): weekday is number => weekday !== null),
    };
  }

  private async upsert(
    tx: Prisma.TransactionClient,
    userId: string,
    routineId: string,
    date: string,
    change: Pick<Prisma.ScheduleOverrideUncheckedCreateInput, 'kind' | 'toDate'>,
  ): Promise<ScheduleOverride> {
    const row = await tx.scheduleOverride.upsert({
      where: { routineId_date: { routineId, date } },
      update: change,
      create: { userId, routineId, date, ...change },
      select: OVERRIDE_SELECT,
    });
    return toScheduleOverride(row);
  }
}
