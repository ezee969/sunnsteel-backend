import * as assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { DatabaseService } from "../src/database/database.service";
import { RoutineTrainingBlocksService } from "../src/routines/routine-training-blocks.service";
import {
  assertNoTrainingBlockOverlap,
  assertTrainingBlockRange,
  normalizeTrainingBlockName,
  trainingBlockState,
} from "../src/routines/routine-training-blocks";

test("training-block dates are real, ordered and inclusive for overlap", () => {
  assert.doesNotThrow(() =>
    assertTrainingBlockRange("2026-09-01", "2026-09-01"),
  );
  assert.throws(
    () => assertTrainingBlockRange("2026-02-30", "2026-03-01"),
    BadRequestException,
  );
  assert.throws(
    () => assertTrainingBlockRange("2026-09-02", "2026-09-01"),
    BadRequestException,
  );
  assert.throws(
    () =>
      assertNoTrainingBlockOverlap("2026-09-10", "2026-09-20", [
        { startDate: "2026-09-01", endDate: "2026-09-10" },
      ]),
    ConflictException,
  );
  assert.doesNotThrow(() =>
    assertNoTrainingBlockOverlap("2026-09-11", "2026-09-20", [
      { startDate: "2026-09-01", endDate: "2026-09-10" },
    ]),
  );
});

test("training-block state uses both inclusive boundaries", () => {
  assert.equal(
    trainingBlockState("2026-09-10", "2026-09-20", "2026-09-09"),
    "FUTURE",
  );
  assert.equal(
    trainingBlockState("2026-09-10", "2026-09-20", "2026-09-10"),
    "ACTIVE",
  );
  assert.equal(
    trainingBlockState("2026-09-10", "2026-09-20", "2026-09-20"),
    "ACTIVE",
  );
  assert.equal(
    trainingBlockState("2026-09-10", "2026-09-20", "2026-09-21"),
    "COMPLETE",
  );
  assert.equal(normalizeTrainingBlockName("  Accumulation  "), "Accumulation");
  assert.throws(() => normalizeTrainingBlockName("   "), BadRequestException);
});

type BlockRow = {
  id: string;
  routineId: string;
  seriesId: string;
  revision: number;
  name: string;
  startDate: string;
  endDate: string;
  setup: unknown;
  sourceKind: "CURRENT_ROUTINE" | "SAVED_VERSION";
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  sourceVersionName: string | null;
  supersededAt: Date | null;
  createdAt: Date;
};

function fakeDb() {
  const blocks: BlockRow[] = [];
  const versions = [
    {
      id: "version-1",
      routineId: "routine-1",
      number: 4,
      name: "Hypertrophy base",
      setup: {
        name: "Saved setup",
        description: null,
        scheduleMode: "WEEKLY",
        restDays: [],
        rotationWeekdays: [],
        days: [
          {
            dayOfWeek: 1,
            name: "Heavy",
            order: 0,
            exercises: [
              {
                exercise: { id: "exercise-squat", name: "Back Squat" },
                order: 0,
                restSeconds: 180,
                note: null,
                progressionScheme: "DOUBLE_PROGRESSION",
                minWeightIncrement: 2.5,
                sets: [
                  {
                    setNumber: 1,
                    repType: "FIXED",
                    reps: 5,
                    minReps: null,
                    maxReps: null,
                    weight: 140,
                    rir: 2,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
  let liveSessionSeriesId: string | null = null;
  const routine = {
    id: "routine-1",
    userId: "user-1",
    user: { timeZone: "UTC" },
    name: "Editable baseline",
    description: null,
    isPeriodized: false,
    isFavorite: false,
    isCompleted: false,
    scheduleMode: "WEEKLY",
    restDays: [],
    rotationWeekdays: [],
    visibility: "PRIVATE",
    moderationHiddenAt: null,
    goal: null,
    experienceLevel: null,
    clonedAt: null,
    clonedFromRoutineId: null,
    clonedFromRoutine: null,
    clonedFromUser: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [],
  };
  const matches = (row: BlockRow, where: any) => {
    if (where.id && row.id !== where.id) return false;
    if (where.routineId && row.routineId !== where.routineId) return false;
    if (where.seriesId?.not && row.seriesId === where.seriesId.not)
      return false;
    if (typeof where.seriesId === "string" && row.seriesId !== where.seriesId)
      return false;
    if (where.supersededAt === null && row.supersededAt !== null) return false;
    return true;
  };
  const tx = {
    $queryRaw: async () => [],
    routineTemporaryOverride: {
      findMany: async () => [],
    },
    workoutSession: {
      findFirst: async ({ where }: any) =>
        where.status === "IN_PROGRESS" &&
        where.trainingBlockSeriesId === liveSessionSeriesId
          ? { id: "session-1" }
          : null,
    },
    routine: {
      findFirst: async ({ where }: any) =>
        where.id === routine.id && where.userId === routine.userId
          ? routine
          : null,
    },
    // EXER-06: every exercise a saved version names is still usable here.
    exercise: {
      findMany: async ({ where }: any) =>
        where.id.in.map((id: string) => ({ id })),
    },
    routineVersion: {
      findFirst: async ({ where }: any) =>
        versions.find(
          (version) =>
            version.id === where.id && version.routineId === where.routineId,
        ) ?? null,
    },
    routineTrainingBlock: {
      findMany: async ({ where, orderBy }: any) => {
        const rows = blocks.filter((row) => matches(row, where));
        if (orderBy?.revision === "desc") {
          return rows.sort((left, right) => right.revision - left.revision);
        }
        return rows;
      },
      findFirst: async ({ where }: any) =>
        blocks.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: any) => {
        const row: BlockRow = {
          id: `block-${blocks.length + 1}`,
          supersededAt: null,
          createdAt: new Date(),
          ...data,
        };
        blocks.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = blocks.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const kept = blocks.filter((row) => !matches(row, where));
        const count = blocks.length - kept.length;
        blocks.splice(0, blocks.length, ...kept);
        return { count };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (run: (client: typeof tx) => unknown) => run(tx),
  } as unknown as DatabaseService;
  return {
    service: new RoutineTrainingBlocksService(db),
    blocks,
    versions,
    trainLive: (seriesId: string) => {
      liveSessionSeriesId = seriesId;
    },
  };
}

test("each revision gets its own working copy of its setup (ROUT-15)", async () => {
  const { service, blocks } = fakeDb();
  await service.create("user-1", "routine-1", {
    name: "Strength",
    startDate: "2099-05-01",
    endDate: "2099-05-31",
    sourceVersionId: "version-1",
  });
  const days = (blocks[0] as unknown as { days: { create: any[] } }).days
    .create;
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].routine, { connect: { id: "routine-1" } });
  assert.equal(days[0].dayOfWeek, 1);
  assert.equal(days[0].name, "Heavy");
  const exercise = days[0].exercises.create[0];
  assert.deepEqual(exercise.exercise, { connect: { id: "exercise-squat" } });
  assert.equal(exercise.progressionScheme, "DOUBLE_PROGRESSION");
  assert.deepEqual(exercise.sets.create[0], {
    setNumber: 1,
    repType: "FIXED",
    reps: 5,
    minReps: null,
    maxReps: null,
    weight: 140,
    rir: 2,
    // LIVE-12: a setup captured before set kinds writes working sets.
    kind: "WORKING",
  });
});

test("a block with a live session cannot be revised (ROUT-15)", async () => {
  const { service, trainLive } = fakeDb();
  const block = await service.create("user-1", "routine-1", {
    name: "Strength",
    startDate: "2099-06-01",
    endDate: "2099-06-30",
  });
  trainLive(block.seriesId);
  await assert.rejects(
    service.update("user-1", "routine-1", block.id, {
      name: "Strength v2",
      startDate: "2099-06-01",
      endDate: "2099-06-30",
    }),
    ConflictException,
  );
});

test("updates append an immutable revision and preserve saved-version provenance", async () => {
  const { service, blocks, versions } = fakeDb();
  const first = await service.create("user-1", "routine-1", {
    name: " Base block ",
    startDate: "2099-01-01",
    endDate: "2099-01-31",
    sourceVersionId: "version-1",
  });
  assert.equal(first.revision, 1);
  assert.equal(first.source.versionNumber, 4);
  assert.equal(first.setup.name, "Saved setup");

  versions.splice(0, versions.length);
  const second = await service.update("user-1", "routine-1", first.id, {
    name: "Strength block",
    startDate: "2099-02-01",
    endDate: "2099-02-28",
  });
  assert.equal(second.revision, 2);
  assert.equal(second.source.kind, "CURRENT_ROUTINE");
  assert.equal(blocks[0].supersededAt instanceof Date, true);
  assert.equal(blocks[0].sourceVersionNumber, 4);
  assert.equal((blocks[0].setup as { name: string }).name, "Saved setup");

  const history = await service.revisions("user-1", "routine-1", second.id);
  assert.deepEqual(
    history.revisions.map((revision) => revision.revision),
    [2, 1],
  );
  assert.equal(history.revisions[1].source.versionName, "Hypertrophy base");
});

test("overlap is refused and only a future block can be deleted", async () => {
  const { service, blocks } = fakeDb();
  const future = await service.create("user-1", "routine-1", {
    name: "Future",
    startDate: "2099-03-01",
    endDate: "2099-03-31",
  });
  await assert.rejects(
    service.create("user-1", "routine-1", {
      name: "Overlap",
      startDate: "2099-03-31",
      endDate: "2099-04-10",
    }),
    ConflictException,
  );
  await service.remove("user-1", "routine-1", future.id);
  assert.equal(blocks.length, 0);

  const complete = await service.create("user-1", "routine-1", {
    name: "Past",
    startDate: "2000-01-01",
    endDate: "2000-01-31",
  });
  await assert.rejects(
    service.remove("user-1", "routine-1", complete.id),
    ConflictException,
  );
});
