import {
  RENAISSANCE_RANK_DEFINITIONS,
  RenaissanceRankProgress,
} from '@sunsteel/contracts';

/** Derives the highest fully reached rank from monotonic attendance totals. */
export function renaissanceRankProgress(
  completedSessions: number,
  activeWeeks: number,
): RenaissanceRankProgress {
  let currentIndex = 0;
  for (let index = 1; index < RENAISSANCE_RANK_DEFINITIONS.length; index += 1) {
    const candidate = RENAISSANCE_RANK_DEFINITIONS[index];
    if (
      completedSessions < candidate.minimumSessions ||
      activeWeeks < candidate.minimumActiveWeeks
    ) {
      break;
    }
    currentIndex = index;
  }

  const currentRank = RENAISSANCE_RANK_DEFINITIONS[currentIndex];
  const nextRank = RENAISSANCE_RANK_DEFINITIONS[currentIndex + 1] ?? null;

  return {
    currentRank,
    nextRank,
    completedSessions,
    activeWeeks,
    sessionsRemaining: nextRank
      ? Math.max(0, nextRank.minimumSessions - completedSessions)
      : 0,
    activeWeeksRemaining: nextRank
      ? Math.max(0, nextRank.minimumActiveWeeks - activeWeeks)
      : 0,
  };
}
