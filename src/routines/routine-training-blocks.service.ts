import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ROUTINE_TRAINING_BLOCK_REVISIONS_MAX,
  ROUTINE_TRAINING_BLOCKS_MAX,
  type RoutineVersionSetup,
  type RoutineTrainingBlock,
  type RoutineTrainingBlockRevision,
  type RoutineTrainingBlockRevisionsResponse,
  type RoutineTrainingBlocksResponse,
  type UpsertRoutineTrainingBlockRequest,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localClock } from "../notifications/push/local-time";
import { lockTrainingAccount } from "../workouts/analytics/analytics-lock";
import { ROUTINE_WITH_DAYS_SELECT } from "./routine.selects";
import { workingCopyDays } from "./routine-working-copy";
import { assertBlockLeavesDeloads } from "./routine-deloads";
import { captureRoutineSetup, readRoutineSetup } from "./routine-versions";
import {
  assertNoTrainingBlockOverlap,
  assertTrainingBlockRange,
  normalizeTrainingBlockName,
  trainingBlockState,
} from "./routine-training-blocks";

const BLOCK_SELECT = {
  id: true,
  routineId: true,
  seriesId: true,
  revision: true,
  name: true,
  startDate: true,
  endDate: true,
  setup: true,
  sourceKind: true,
  sourceVersionId: true,
  sourceVersionNumber: true,
  sourceVersionName: true,
  supersededAt: true,
  createdAt: true,
} as const;

const ROUTINE_FOR_BLOCK_SELECT = {
  ...ROUTINE_WITH_DAYS_SELECT,
  user: { select: { timeZone: true } },
} as const;

type BlockEntity = Prisma.RoutineTrainingBlockGetPayload<{
  select: typeof BLOCK_SELECT;
}>;
type RoutineForBlock = Prisma.RoutineGetPayload<{
  select: typeof ROUTINE_FOR_BLOCK_SELECT;
}>;

function toRevision(row: BlockEntity): RoutineTrainingBlockRevision {
  return {
    id: row.id,
    routineId: row.routineId,
    seriesId: row.seriesId,
    revision: row.revision,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    setup: readRoutineSetup(row.setup),
    source: {
      kind: row.sourceKind,
      versionId: row.sourceVersionId,
      versionNumber: row.sourceVersionNumber,
      versionName: row.sourceVersionName,
    },
    createdAt: row.createdAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

function toCurrent(row: BlockEntity, today: string): RoutineTrainingBlock {
  const { supersededAt: _supersededAt, ...revision } = toRevision(row);
  void _supersededAt;
  return {
    ...revision,
    state: trainingBlockState(row.startDate, row.endDate, today),
    revisionCount: row.revision,
  };
}

const BLOCKS_FULL_MESSAGE =
  `A routine keeps at most ${ROUTINE_TRAINING_BLOCKS_MAX} training blocks; ` +
  "delete a future block first";
const REVISIONS_FULL_MESSAGE = `A training block keeps at most ${ROUTINE_TRAINING_BLOCK_REVISIONS_MAX} revisions`;

/**
 * ROUT-09: authored date ranges whose setup is copied at write time. ROUT-15
 * executes them: `resolveRoutinePlan` decides which one a date trains, and a
 * session of one of its days trains its working copy.
 */
@Injectable()
export class RoutineTrainingBlocksService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    userId: string,
    routineId: string,
  ): Promise<RoutineTrainingBlocksResponse> {
    const routine = await this.ownedRoutine(this.db, userId, routineId);
    const today = localClock(new Date(), routine.user.timeZone ?? "UTC").date;
    const rows = await this.db.routineTrainingBlock.findMany({
      where: { routineId, supersededAt: null },
      select: BLOCK_SELECT,
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      take: ROUTINE_TRAINING_BLOCKS_MAX,
    });
    return {
      blocks: rows.map((row) => toCurrent(row, today)),
      max: ROUTINE_TRAINING_BLOCKS_MAX,
      revisionMax: ROUTINE_TRAINING_BLOCK_REVISIONS_MAX,
      today,
    };
  }

  create(
    userId: string,
    routineId: string,
    input: UpsertRoutineTrainingBlockRequest,
  ): Promise<RoutineTrainingBlock> {
    const normalized = this.normalize(input);
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await this.ownedRoutine(tx, userId, routineId);
      const today = localClock(new Date(), routine.user.timeZone ?? "UTC").date;
      const current = await tx.routineTrainingBlock.findMany({
        where: { routineId, supersededAt: null },
        select: { startDate: true, endDate: true },
      });
      if (current.length >= ROUTINE_TRAINING_BLOCKS_MAX) {
        throw new ConflictException(BLOCKS_FULL_MESSAGE);
      }
      assertNoTrainingBlockOverlap(
        normalized.startDate,
        normalized.endDate,
        current,
      );
      assertBlockLeavesDeloads({
        seriesId: null,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        today,
        deloads: await this.deloads(tx, routineId),
      });
      const source = await this.resolveSource(
        tx,
        routine,
        normalized.sourceVersionId,
      );
      const row = await tx.routineTrainingBlock.create({
        data: {
          routineId,
          seriesId: randomUUID(),
          revision: 1,
          name: normalized.name,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          ...source,
          days: workingCopyDays(
            routineId,
            source.setup as unknown as RoutineVersionSetup,
          ),
        },
        select: BLOCK_SELECT,
      });
      return toCurrent(row, today);
    });
  }

  update(
    userId: string,
    routineId: string,
    blockId: string,
    input: UpsertRoutineTrainingBlockRequest,
  ): Promise<RoutineTrainingBlock> {
    const normalized = this.normalize(input);
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await this.ownedRoutine(tx, userId, routineId);
      const today = localClock(new Date(), routine.user.timeZone ?? "UTC").date;
      const block = await tx.routineTrainingBlock.findFirst({
        where: { id: blockId, routineId, supersededAt: null },
        select: BLOCK_SELECT,
      });
      if (!block) throw new NotFoundException("Training block not found");

      const state = trainingBlockState(block.startDate, block.endDate, today);
      if (state === "COMPLETE") {
        throw new ConflictException("A completed training block cannot change");
      }
      if (block.revision >= ROUTINE_TRAINING_BLOCK_REVISIONS_MAX) {
        throw new ConflictException(REVISIONS_FULL_MESSAGE);
      }
      if (state === "ACTIVE" && normalized.startDate !== block.startDate) {
        throw new BadRequestException(
          "The start date of an active training block cannot change",
        );
      }
      if (state === "ACTIVE" && normalized.endDate < today) {
        throw new BadRequestException(
          "An active training block cannot end before today",
        );
      }

      // ROUT-15: a live session of this block trains the current revision's
      // working copy; replacing it mid-workout would leave that session
      // finishing onto rows no plan reads any more.
      if (
        await tx.workoutSession.findFirst({
          where: {
            userId,
            status: "IN_PROGRESS",
            trainingBlockSeriesId: block.seriesId,
          },
          select: { id: true },
        })
      ) {
        throw new ConflictException(
          "Finish the active session of this training block before revising it",
        );
      }

      const others = await tx.routineTrainingBlock.findMany({
        where: {
          routineId,
          supersededAt: null,
          seriesId: { not: block.seriesId },
        },
        select: { startDate: true, endDate: true },
      });
      assertNoTrainingBlockOverlap(
        normalized.startDate,
        normalized.endDate,
        others,
      );
      assertBlockLeavesDeloads({
        seriesId: block.seriesId,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        today,
        deloads: await this.deloads(tx, routineId),
      });
      const source = await this.resolveSource(
        tx,
        routine,
        normalized.sourceVersionId,
      );
      const supersededAt = new Date();
      await tx.routineTrainingBlock.update({
        where: { id: block.id },
        data: { supersededAt },
      });
      const row = await tx.routineTrainingBlock.create({
        data: {
          routineId,
          seriesId: block.seriesId,
          revision: block.revision + 1,
          name: normalized.name,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          ...source,
          days: workingCopyDays(
            routineId,
            source.setup as unknown as RoutineVersionSetup,
          ),
        },
        select: BLOCK_SELECT,
      });
      return toCurrent(row, today);
    });
  }

  async revisions(
    userId: string,
    routineId: string,
    blockId: string,
  ): Promise<RoutineTrainingBlockRevisionsResponse> {
    await this.ownedRoutine(this.db, userId, routineId);
    const block = await this.db.routineTrainingBlock.findFirst({
      where: { id: blockId, routineId },
      select: { seriesId: true },
    });
    if (!block) throw new NotFoundException("Training block not found");
    const rows = await this.db.routineTrainingBlock.findMany({
      where: { routineId, seriesId: block.seriesId },
      select: BLOCK_SELECT,
      orderBy: { revision: "desc" },
      take: ROUTINE_TRAINING_BLOCK_REVISIONS_MAX,
    });
    return {
      seriesId: block.seriesId,
      revisions: rows.map(toRevision),
      max: ROUTINE_TRAINING_BLOCK_REVISIONS_MAX,
    };
  }

  async remove(userId: string, routineId: string, blockId: string) {
    await this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const routine = await this.ownedRoutine(tx, userId, routineId);
      const today = localClock(new Date(), routine.user.timeZone ?? "UTC").date;
      const block = await tx.routineTrainingBlock.findFirst({
        where: { id: blockId, routineId, supersededAt: null },
        select: { seriesId: true, startDate: true, endDate: true },
      });
      if (!block) throw new NotFoundException("Training block not found");
      if (
        trainingBlockState(block.startDate, block.endDate, today) !== "FUTURE"
      ) {
        throw new ConflictException(
          "Only a future training block can be deleted",
        );
      }
      // ROUT-16: a planned deload lightens this block; it goes first.
      if (
        (await this.deloads(tx, routineId)).some(
          (deload) =>
            deload.sourceTrainingBlockSeriesId === block.seriesId &&
            deload.endDate >= deload.startDate,
        )
      ) {
        throw new ConflictException(
          "A deload lightens this training block; cancel it first",
        );
      }
      await tx.routineTrainingBlock.deleteMany({
        where: { routineId, seriesId: block.seriesId },
      });
    });
  }

  private deloads(tx: Prisma.TransactionClient, routineId: string) {
    return tx.routineTemporaryOverride.findMany({
      where: { routineId },
      select: {
        startDate: true,
        endDate: true,
        sourceTrainingBlockSeriesId: true,
      },
    });
  }

  private normalize(input: UpsertRoutineTrainingBlockRequest) {
    assertTrainingBlockRange(input.startDate, input.endDate);
    return {
      name: normalizeTrainingBlockName(input.name),
      startDate: input.startDate,
      endDate: input.endDate,
      sourceVersionId: input.sourceVersionId?.trim() || null,
    };
  }

  private async resolveSource(
    tx: Prisma.TransactionClient,
    routine: RoutineForBlock,
    versionId: string | null,
  ) {
    if (!versionId) {
      return {
        sourceKind: "CURRENT_ROUTINE" as const,
        sourceVersionId: null,
        sourceVersionNumber: null,
        sourceVersionName: null,
        setup: captureRoutineSetup(routine) as unknown as Prisma.InputJsonValue,
      };
    }
    const version = await tx.routineVersion.findFirst({
      where: { id: versionId, routineId: routine.id },
      select: { id: true, number: true, name: true, setup: true },
    });
    if (!version) throw new NotFoundException("Routine version not found");
    return {
      sourceKind: "SAVED_VERSION" as const,
      sourceVersionId: version.id,
      sourceVersionNumber: version.number,
      sourceVersionName: version.name,
      setup: readRoutineSetup(
        version.setup,
      ) as unknown as Prisma.InputJsonValue,
    };
  }

  private async ownedRoutine(
    db: Pick<Prisma.TransactionClient, "routine">,
    userId: string,
    routineId: string,
  ): Promise<RoutineForBlock> {
    const routine = await db.routine.findFirst({
      where: { id: routineId, userId },
      select: ROUTINE_FOR_BLOCK_SELECT,
    });
    if (!routine) throw new NotFoundException("Routine not found");
    return routine;
  }
}
