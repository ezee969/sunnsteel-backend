import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ROUTINE_VERSIONS_MAX,
  RestoreRoutineVersionResponse,
  RoutineVersion,
  RoutineVersionsResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { ROUTINE_WITH_DAYS_SELECT } from './routine.selects';
import {
  captureRoutineSetup,
  normalizeVersionName,
  readRoutineSetup,
  setupExerciseIds,
  setupToRoutineUpdate,
} from './routine-versions';
import { RoutinesService } from './routines.service';

const VERSION_SELECT = {
  id: true,
  routineId: true,
  number: true,
  name: true,
  kind: true,
  restoredVersionNumber: true,
  setup: true,
  createdAt: true,
} as const;

type VersionEntity = Prisma.RoutineVersionGetPayload<{
  select: typeof VERSION_SELECT;
}>;

function toRoutineVersion(row: VersionEntity): RoutineVersion {
  return {
    id: row.id,
    routineId: row.routineId,
    number: row.number,
    name: row.name,
    kind: row.kind,
    restoredVersionNumber: row.restoredVersionNumber,
    createdAt: row.createdAt.toISOString(),
    setup: readRoutineSetup(row.setup),
  };
}

const FULL_MESSAGE = `A routine keeps at most ${ROUTINE_VERSIONS_MAX} versions; delete one first`;

/**
 * ROUT-08: intentional, immutable copies of a routine's setup. Saving copies
 * the routine as it is now; restoring first saves the current setup as a
 * BEFORE_RESTORE version (so it can be undone) and then applies the version
 * through the ordinary routine update, with the same history guards.
 */
@Injectable()
export class RoutineVersionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly routines: RoutinesService,
  ) {}

  async list(
    userId: string,
    routineId: string,
  ): Promise<RoutineVersionsResponse> {
    await this.assertOwned(this.db, userId, routineId);
    const rows = await this.db.routineVersion.findMany({
      where: { routineId },
      select: VERSION_SELECT,
      orderBy: { number: 'desc' },
      take: ROUTINE_VERSIONS_MAX,
    });
    return { versions: rows.map(toRoutineVersion), max: ROUTINE_VERSIONS_MAX };
  }

  create(
    userId: string,
    routineId: string,
    name?: string | null,
  ): Promise<RoutineVersion> {
    const versionName = normalizeVersionName(name);
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      return this.saveCurrent(tx, userId, routineId, {
        name: versionName,
        kind: 'SAVED',
        restoredVersionNumber: null,
      });
    });
  }

  restore(
    userId: string,
    routineId: string,
    versionId: string,
  ): Promise<RestoreRoutineVersionResponse> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      await this.assertOwned(tx, userId, routineId);
      const version = await tx.routineVersion.findFirst({
        where: { id: versionId, routineId },
        select: VERSION_SELECT,
      });
      if (!version) throw new NotFoundException('Version not found');
      const setup = readRoutineSetup(version.setup);

      const ids = setupExerciseIds(setup);
      const known = await tx.exercise.count({ where: { id: { in: ids } } });
      if (known !== ids.length) {
        throw new ConflictException(
          'An exercise in this version is no longer in the catalog',
        );
      }

      const savedVersion = await this.saveCurrent(tx, userId, routineId, {
        name: null,
        kind: 'BEFORE_RESTORE',
        restoredVersionNumber: version.number,
      });
      // Stored setups were valid routines; the update checks them again.
      const routine = await this.routines.updateInTransaction(
        tx,
        userId,
        routineId,
        setupToRoutineUpdate(setup) as unknown as UpdateRoutineDto,
      );
      return { routine, savedVersion };
    });
  }

  async remove(userId: string, routineId: string, versionId: string) {
    await this.assertOwned(this.db, userId, routineId);
    const { count } = await this.db.routineVersion.deleteMany({
      where: { id: versionId, routineId },
    });
    if (count === 0) throw new NotFoundException('Version not found');
  }

  private async saveCurrent(
    tx: Prisma.TransactionClient,
    userId: string,
    routineId: string,
    data: Pick<
      Prisma.RoutineVersionUncheckedCreateInput,
      'name' | 'kind' | 'restoredVersionNumber'
    >,
  ): Promise<RoutineVersion> {
    const routine = await tx.routine.findFirst({
      where: { id: routineId, userId },
      select: ROUTINE_WITH_DAYS_SELECT,
    });
    if (!routine) throw new NotFoundException('Routine not found');

    const count = await tx.routineVersion.count({ where: { routineId } });
    if (count >= ROUTINE_VERSIONS_MAX) throw new ConflictException(FULL_MESSAGE);
    // A per-routine counter, so a deleted version's number is never reused.
    const { lastVersionNumber } = await tx.routine.update({
      where: { id: routineId },
      data: { lastVersionNumber: { increment: 1 } },
      select: { lastVersionNumber: true },
    });

    const row = await tx.routineVersion.create({
      data: {
        ...data,
        routineId,
        number: lastVersionNumber,
        setup: captureRoutineSetup(routine) as unknown as Prisma.InputJsonValue,
      },
      select: VERSION_SELECT,
    });
    return toRoutineVersion(row);
  }

  private async assertOwned(
    db: Pick<Prisma.TransactionClient, 'routine'>,
    userId: string,
    routineId: string,
  ) {
    const routine = await db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });
    if (!routine) throw new NotFoundException('Routine not found');
  }
}
