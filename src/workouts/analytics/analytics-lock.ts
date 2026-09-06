import { Prisma } from '@prisma/client';

/** All session/routine writers and backfill share this per-account lock. */
export async function lockTrainingAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}
