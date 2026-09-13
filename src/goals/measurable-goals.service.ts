import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  MeasurableGoal,
  MeasurableGoalDirection,
  MeasurableGoalInput,
  MeasurableGoalType,
} from "@sunsteel/contracts";
import { MEASURABLE_GOALS_MAX } from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";

export const measurableGoalSelect = {
  id: true,
  type: true,
  targetValue: true,
  direction: true,
  exerciseId: true,
  exercise: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MeasurableGoalSelect;

export type SelectedMeasurableGoal = Prisma.MeasurableGoalGetPayload<{
  select: typeof measurableGoalSelect;
}>;

interface NormalizedGoalInput {
  id?: string;
  type: MeasurableGoalType;
  targetValue: number;
  direction: MeasurableGoalDirection;
  exerciseId: string | null;
}

const TARGET_LIMITS: Record<
  MeasurableGoalType,
  { minimum: number; maximum: number; integer?: boolean }
> = {
  WEEKLY_SESSIONS: { minimum: 1, maximum: 14, integer: true },
  WEEKLY_VOLUME: { minimum: 1, maximum: 1_000_000_000 },
  STREAK_DAYS: { minimum: 1, maximum: 3650, integer: true },
  EXERCISE_ESTIMATED_1RM: { minimum: 0.1, maximum: 2000 },
  BODY_WEIGHT: { minimum: 20, maximum: 1000 },
};

export function normalizeMeasurableGoalInputs(
  inputs: MeasurableGoalInput[],
): NormalizedGoalInput[] {
  if (inputs.length > MEASURABLE_GOALS_MAX) {
    throw new BadRequestException(
      `No more than ${MEASURABLE_GOALS_MAX} measurable goals are allowed`,
    );
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  return inputs.map((input) => {
    const limits = TARGET_LIMITS[input.type];
    if (
      !Number.isFinite(input.targetValue) ||
      input.targetValue < limits.minimum ||
      input.targetValue > limits.maximum ||
      (limits.integer && !Number.isInteger(input.targetValue))
    ) {
      throw new BadRequestException(`Invalid target for ${input.type}`);
    }
    if (input.id && ids.has(input.id)) {
      throw new BadRequestException("Goal ids must be unique");
    }
    if (input.id) ids.add(input.id);

    const needsExercise = input.type === "EXERCISE_ESTIMATED_1RM";
    if (needsExercise !== Boolean(input.exerciseId)) {
      throw new BadRequestException(
        needsExercise
          ? "Strength goals require an exercise"
          : "Only strength goals may reference an exercise",
      );
    }
    const direction = input.direction ?? "AT_LEAST";
    if (input.type !== "BODY_WEIGHT" && direction !== "AT_LEAST") {
      throw new BadRequestException(
        "Only body-weight goals may use an at-most direction",
      );
    }
    const key = `${input.type}:${input.exerciseId ?? ""}`;
    if (keys.has(key)) {
      throw new BadRequestException("Duplicate measurable goal");
    }
    keys.add(key);
    return {
      id: input.id,
      type: input.type,
      targetValue: input.targetValue,
      direction,
      exerciseId: input.exerciseId ?? null,
    };
  });
}

export function mapMeasurableGoal(
  goal: SelectedMeasurableGoal,
): MeasurableGoal {
  return {
    id: goal.id,
    type: goal.type,
    targetValue: goal.targetValue,
    direction: goal.direction,
    exercise: goal.exercise,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

@Injectable()
export class MeasurableGoalsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string): Promise<MeasurableGoal[]> {
    const goals = await this.db.measurableGoal.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: measurableGoalSelect,
    });
    return goals.map(mapMeasurableGoal);
  }

  async replace(
    userId: string,
    inputs: MeasurableGoalInput[],
  ): Promise<MeasurableGoal[]> {
    const goals = normalizeMeasurableGoalInputs(inputs);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.measurableGoal.findMany({
        where: { userId },
        select: { id: true },
      });
      const ownedIds = new Set(existing.map((goal) => goal.id));
      if (goals.some((goal) => goal.id && !ownedIds.has(goal.id))) {
        throw new BadRequestException("Invalid measurable goal id");
      }

      const exerciseIds = goals.flatMap((goal) =>
        goal.exerciseId ? [goal.exerciseId] : [],
      );
      if (exerciseIds.length) {
        const exerciseCount = await tx.exercise.count({
          where: { id: { in: exerciseIds } },
        });
        if (exerciseCount !== exerciseIds.length) {
          throw new BadRequestException("Unknown strength-goal exercise");
        }
      }

      const retainedIds = goals.flatMap((goal) => (goal.id ? [goal.id] : []));
      await tx.measurableGoal.deleteMany({
        where: {
          userId,
          ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
        },
      });

      for (const goal of goals) {
        const data = {
          type: goal.type,
          targetValue: goal.targetValue,
          direction: goal.direction,
          exerciseId: goal.exerciseId,
        };
        if (goal.id) {
          await tx.measurableGoal.update({ where: { id: goal.id }, data });
        } else {
          await tx.measurableGoal.create({ data: { userId, ...data } });
        }
      }

      const saved = await tx.measurableGoal.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: measurableGoalSelect,
      });
      return saved.map(mapMeasurableGoal);
    });
  }
}
