import { Prisma } from '@prisma/client';
import {
  higherRenaissanceRank,
  isRenaissanceRankId,
  RankReachedEventPayload,
  rankReachedEventKey,
  renaissanceRankProgress,
  renaissanceRanksThrough,
  RenaissanceRankId,
  RenaissanceRankInputs,
  RenaissanceRankProgress,
} from '@sunsteel/contracts';

/**
 * The Renaissance rank's evidence and its ledger. A rank is measured from the
 * analytics projection -- sessions with at least one completed work set
 * (`countedSessions`), the Monday-to-Sunday weeks holding one, and completed
 * work sets -- and every rank reached is written once as a `RANK_REACHED`
 * event with no session, so the rank shown never drops when a replay of the
 * history counts less (a removed past workout, another time zone).
 */
type Db = Pick<Prisma.TransactionClient, 'workoutRollup' | 'trainingEvent'>;

interface RankProjection {
  id: string;
  countedSessions: number;
  completedSets: number;
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Weeks holding at least one counted session in this projection. */
export function countRankWeeks(db: Db, projectionId: string): Promise<number> {
  return db.workoutRollup.count({
    where: { projectionId, period: 'WEEK', countedSessions: { gt: 0 } },
  });
}

export async function readRankInputs(
  db: Db,
  projection: RankProjection,
): Promise<RenaissanceRankInputs> {
  return {
    completedSessions: projection.countedSessions,
    activeWeeks: await countRankWeeks(db, projection.id),
    completedSets: projection.completedSets,
  };
}

/** The highest rank the account has reached, or null when none is recorded. */
export async function readReachedRank(
  db: Db,
  userId: string,
): Promise<RenaissanceRankId | null> {
  const events = await db.trainingEvent.findMany({
    where: { userId, type: 'RANK_REACHED' },
    select: { payload: true },
  });
  let reached: RenaissanceRankId | null = null;
  for (const event of events) {
    const rankId = (event.payload as { rankId?: unknown } | null)?.rankId;
    if (isRenaissanceRankId(rankId)) {
      reached = higherRenaissanceRank(reached, rankId);
    }
  }
  return reached;
}

/** Read-only: the rank from the projection and the ledger, nothing written. */
export async function readRankProgress(
  db: Db,
  userId: string,
  projection: RankProjection,
): Promise<RenaissanceRankProgress> {
  const [inputs, reached] = await Promise.all([
    readRankInputs(db, projection),
    readReachedRank(db, userId),
  ]);
  return renaissanceRankProgress(inputs, reached);
}

/**
 * Records every rank these totals meet that the ledger does not hold yet.
 * Event keys make a retry, a replay and a second generation harmless. Only
 * ranks the totals meet are written -- never one a recorded rank implies --
 * so the ledger is evidence, not inference.
 */
export async function recordReachedRanks(
  tx: Db,
  input: {
    userId: string;
    inputs: RenaissanceRankInputs;
    occurredAt: Date;
    backfilled: boolean;
  },
): Promise<void> {
  // Initiate is every account's from its first day and is never recorded.
  const met = renaissanceRanksThrough(
    renaissanceRankProgress(input.inputs).currentRank.id,
  ).slice(1);
  if (met.length === 0) return;
  const data: Prisma.TrainingEventCreateManyInput[] = met.map(rank => {
    const payload: RankReachedEventPayload = {
      schemaVersion: 1,
      rankId: rank.id,
      backfilled: input.backfilled,
    };
    return {
      eventKey: rankReachedEventKey(input.userId, rank.id),
      userId: input.userId,
      sessionId: null,
      type: 'RANK_REACHED',
      occurredAt: input.occurredAt,
      payload: json(payload),
    };
  });
  await tx.trainingEvent.createMany({ data, skipDuplicates: true });
}
