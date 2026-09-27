import type { Prisma } from '@prisma/client';
import { columnDate } from './body-measurement-rules';

/** The delegates PROG-12's current-weight rule needs, so a transaction can pass itself. */
export type BodyWeightDb = Pick<Prisma.TransactionClient, 'bodyMeasurement' | 'user'>;

/**
 * PROG-12: `User.weight` is the weight of the member's latest-dated entry that
 * records one, so the profile, Settings and the PROG-08 body-weight goal keep
 * reading a single value. With no weighted entry it is left as it is.
 * Answers the current weight after the sync, or null when nothing changed it.
 */
export async function syncCurrentWeight(
  db: BodyWeightDb,
  userId: string,
): Promise<number | null> {
  const latest = await db.bodyMeasurement.findFirst({
    where: { userId, weightKg: { not: null } },
    orderBy: { date: 'desc' },
    select: { weightKg: true },
  });
  if (latest?.weightKg == null) return null;
  const user = await db.user.update({
    where: { id: userId },
    data: { weight: latest.weightKg },
    select: { weight: true },
  });
  return user.weight;
}

/** A weight saved in Settings becomes that date's entry, other values kept. */
export async function recordProfileWeight(
  db: BodyWeightDb,
  userId: string,
  date: string,
  weightKg: number,
): Promise<number | null> {
  await db.bodyMeasurement.upsert({
    where: { userId_date: { userId, date: columnDate(date) } },
    create: { userId, date: columnDate(date), weightKg },
    update: { weightKg },
  });
  return syncCurrentWeight(db, userId);
}
