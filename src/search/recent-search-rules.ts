import { RECENT_SEARCHES_MAX, type RecentSearchKind } from '@sunsteel/contracts';

/**
 * NAV-03's pure rules: which stored rows survive a new one, and the order a
 * resolved list keeps. Kept apart from the service so they are tested.
 */

export interface RecentSearchRow {
  kind: RecentSearchKind;
  targetId: string;
  openedAt: Date;
}

export const recentSearchKey = (row: { kind: string; targetId: string }) =>
  `${row.kind}:${row.targetId}`;

/**
 * The rows beyond the newest `max`, which a new entry pushes out. Ties on
 * the instant keep the order the rows were read in, so the same rows are
 * dropped however often this runs.
 */
export function rowsToDrop<T extends RecentSearchRow>(
  rows: readonly T[],
  max = RECENT_SEARCHES_MAX,
): T[] {
  return [...rows]
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
    .slice(max);
}

/**
 * The rows in the order a reader sees them, newest first, split into those
 * that resolved and those that did not -- the second are deleted, because a
 * target that is gone, blocked or hidden should leave no trace in the list.
 */
export function splitResolved<T extends RecentSearchRow, R>(
  rows: readonly T[],
  resolved: ReadonlyMap<string, R>,
): { kept: Array<{ row: T; item: R }>; dropped: T[] } {
  const kept: Array<{ row: T; item: R }> = [];
  const dropped: T[] = [];
  for (const row of [...rows].sort(
    (a, b) => b.openedAt.getTime() - a.openedAt.getTime(),
  )) {
    const item = resolved.get(recentSearchKey(row));
    if (item === undefined) dropped.push(row);
    else kept.push({ row, item });
  }
  return { kept, dropped };
}
