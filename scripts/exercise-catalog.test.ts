import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  EXERCISE_EQUIPMENT,
  EXERCISE_MECHANICS,
  MOVEMENT_PATTERNS,
} from '@sunsteel/contracts';

import {
  buildExerciseMetadataSql,
  EXERCISE_CATALOG,
} from '../prisma/exercise-catalog';
import { DatabaseService } from '../src/database/database.service';
import { ExercisesService, mapExercise } from '../src/exercises/exercises.service';

const migrationsDir = join(__dirname, '..', 'prisma', 'migrations');
const backfill = readdirSync(migrationsDir)
  .filter((dir) => dir.endsWith('_exercise_metadata'))
  .map((dir) => readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'))
  .join('\n');

describe('exercise catalog metadata (EXER-09)', () => {
  it('has unique names and complete, valid metadata for every exercise', () => {
    const names = EXERCISE_CATALOG.map((exercise) => exercise.name);
    assert.equal(new Set(names).size, names.length);
    for (const exercise of EXERCISE_CATALOG) {
      assert.ok(
        (MOVEMENT_PATTERNS as readonly string[]).includes(exercise.movementPattern),
        `${exercise.name}: pattern`,
      );
      assert.ok(
        (EXERCISE_MECHANICS as readonly string[]).includes(exercise.mechanic),
        `${exercise.name}: mechanic`,
      );
      assert.ok(exercise.equipmentRequired.length > 0, `${exercise.name}: equipment`);
      for (const item of exercise.equipmentRequired) {
        assert.ok(
          (EXERCISE_EQUIPMENT as readonly string[]).includes(item),
          `${exercise.name}: ${item}`,
        );
      }
      assert.match(exercise.substitutionGroup, /^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('keeps each substitution group within one movement pattern', () => {
    const patternsByGroup = new Map<string, Set<string>>();
    for (const exercise of EXERCISE_CATALOG) {
      const patterns = patternsByGroup.get(exercise.substitutionGroup) ?? new Set();
      patterns.add(exercise.movementPattern);
      patternsByGroup.set(exercise.substitutionGroup, patterns);
    }
    for (const [group, patterns] of patternsByGroup) {
      assert.equal(patterns.size, 1, `${group} mixes ${[...patterns].join(', ')}`);
    }
  });

  it('ships a backfill migration that matches the catalog exactly', () => {
    assert.ok(backfill.length > 0, 'backfill migration not found');
    for (const statement of buildExerciseMetadataSql()) {
      assert.ok(backfill.includes(statement), `missing: ${statement.slice(0, 120)}`);
    }
  });

  it('escapes quotes in generated SQL', () => {
    const [statement] = buildExerciseMetadataSql([
      { ...EXERCISE_CATALOG[0], name: "Farmer's Walk" },
    ]);
    assert.ok(statement.endsWith(`WHERE "name" = 'Farmer''s Walk';`));
  });
});

describe('ExercisesService', () => {
  const row = {
    id: 'exercise-1',
    name: 'Bench Press',
    primaryMuscles: ['PECTORAL'],
    secondaryMuscles: ['TRICEPS'],
    equipment: 'barbell',
    movementPattern: 'HORIZONTAL_PUSH',
    mechanic: 'COMPOUND',
    equipmentRequired: ['barbell', 'bench', 'hovercraft'],
    substitutionGroup: 'horizontal-press',
    instructions: [],
    mediaUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  it('serializes dates and drops equipment outside the vocabulary', () => {
    const exercise = mapExercise(row as Parameters<typeof mapExercise>[0]);
    assert.deepEqual(exercise.equipmentRequired, ['barbell', 'bench']);
    assert.equal(exercise.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(exercise.movementPattern, 'HORIZONTAL_PUSH');
    assert.equal(exercise.substitutionGroup, 'horizontal-press');
  });

  it('returns the catalog sorted by name with metadata selected', async () => {
    let select: Record<string, boolean> | undefined;
    const db = {
      exercise: {
        findMany: async (args: { select: Record<string, boolean> }) => {
          select = args.select;
          return [
            { ...row, id: 'b', name: 'Squat' },
            { ...row, id: 'a', name: 'bench press' },
          ];
        },
      },
    } as unknown as DatabaseService;
    const result = await new ExercisesService(db).findAll();
    assert.deepEqual(
      result.map((exercise) => exercise.name),
      ['bench press', 'Squat'],
    );
    for (const field of ['movementPattern', 'mechanic', 'equipmentRequired', 'substitutionGroup']) {
      assert.equal(select?.[field], true, field);
    }
  });
});
