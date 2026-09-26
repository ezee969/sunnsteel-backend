import { BadRequestException } from '@nestjs/common';
import {
  EXERCISE_GROUP_MAX,
  hasOversizedGroup,
  normalizeExerciseLinks,
} from '@sunsteel/contracts';

type LinkedExercise = { order?: number; linkedToNext?: boolean };

/** A day's exercises in the order they are trained: by `order`, then as sent. */
function trainingOrder(exercises: readonly LinkedExercise[]): number[] {
  return exercises
    .map((exercise, index) => ({ order: exercise.order ?? index, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ index }) => index);
}

/**
 * ROUT-12: each exercise's stored link, by its position in the input. Links
 * are read in training order and the day's last exercise never links.
 */
export function dayExerciseLinks(exercises: readonly LinkedExercise[]): boolean[] {
  const order = trainingOrder(exercises);
  const normalized = normalizeExerciseLinks(order.map((i) => exercises[i]));
  const links = new Array<boolean>(exercises.length).fill(false);
  order.forEach((original, position) => {
    links[original] = Boolean(normalized[position].linkedToNext);
  });
  return links;
}

/** 400 when a day links more than `EXERCISE_GROUP_MAX` exercises into one group. */
export function assertExerciseLinks(
  days: ReadonlyArray<{ exercises: readonly LinkedExercise[] }>,
): void {
  for (const day of days) {
    const ordered = trainingOrder(day.exercises).map((i) => day.exercises[i]);
    if (hasOversizedGroup(ordered)) {
      throw new BadRequestException(
        `A superset or circuit has at most ${EXERCISE_GROUP_MAX} exercises`,
      );
    }
  }
}
