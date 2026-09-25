import type { Prisma } from '@prisma/client';
import {
  defaultWarmUpEquipment,
  followWorkingLoad,
  isBarLoaded,
  type PlatePairInventory,
} from '@sunsteel/contracts';

type Tx = Prisma.TransactionClient;

const readPlates = (value: unknown): PlatePairInventory[] =>
  Array.isArray(value)
    ? value.filter(
        (pair): pair is PlatePairInventory =>
          typeof pair?.weightKg === 'number' &&
          typeof pair?.pairCount === 'number' &&
          pair.pairCount > 0,
      )
    : [];

/**
 * LIVE-20: recalculate the warm-ups of every given routine exercise that
 * follows its working load, after something moved that load (finish
 * progression, a LIVE-17 correction). Loads come from the member's default
 * gym, else the first; with no gym or no plates saved, a standard bar and
 * plate set in their unit -- the builder asks instead, the server cannot.
 * Only warm-ups with a share change; everything else is left as it is.
 */
export async function syncFollowingWarmUps(
  tx: Tx,
  userId: string,
  routineExerciseIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(routineExerciseIds)];
  if (ids.length === 0) return 0;
  const exercises = await tx.routineExercise.findMany({
    where: { id: { in: ids }, warmUpsFollowLoad: true },
    select: {
      id: true,
      minWeightIncrement: true,
      exercise: { select: { equipmentRequired: true } },
      sets: {
        select: {
          id: true,
          setNumber: true,
          weight: true,
          kind: true,
          warmUpShare: true,
        },
        orderBy: { setNumber: 'asc' },
      },
    },
  });
  if (exercises.length === 0) return 0;

  const [location, user] = await Promise.all([
    tx.trainingLocationPreference.findFirst({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { barWeightKg: true, availablePlatePairs: true },
    }),
    tx.user.findUnique({ where: { id: userId }, select: { weightUnit: true } }),
  ]);
  const fallback = defaultWarmUpEquipment(user?.weightUnit ?? 'KG');
  const saved = readPlates(location?.availablePlatePairs);
  const barWeightKg = location?.barWeightKg ?? fallback.barWeightKg;
  const platePairs = saved.length > 0 ? saved : fallback.platePairs;

  let changed = 0;
  for (const exercise of exercises) {
    const next = followWorkingLoad(exercise.sets, {
      barLoaded: isBarLoaded(exercise.exercise.equipmentRequired),
      barWeightKg,
      platePairs,
      incrementKg: exercise.minWeightIncrement,
    });
    for (const [index, set] of next.entries()) {
      if (set.weight === exercise.sets[index].weight) continue;
      await tx.routineExerciseSet.update({
        where: { id: set.id },
        data: { weight: set.weight },
        select: { id: true },
      });
      changed += 1;
    }
  }
  return changed;
}
