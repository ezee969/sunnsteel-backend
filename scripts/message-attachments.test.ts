import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_BODY_MAX,
  SHARED_ROUTINE_SOURCES,
  type SharedRoutineSummary,
  messageNote,
} from '@sunsteel/contracts';

import { SendMessageDto, StartConversationDto } from '../src/messages/dto/messages.dto';
import {
  captureMessages,
  messageFor,
  reportRefusal,
  type StoredMessage,
} from '../src/messages/message-moderation';
import {
  attachmentFor,
  sharedWorkoutExercises,
  toWorkoutSummary,
} from '../src/messages/message-attachments';
import { readCloneSource } from '../src/routines/routine-cloning';
import { personalRecordParts } from '../src/workouts/workout-progress-timeline.service';

const MIGRATION = readFileSync(
  'prisma/migrations/20261007100000_message_attachments/migration.sql',
  'utf8',
);
const SENDER = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const ROUTINE = '33333333-3333-4333-8333-333333333333';

const summary: SharedRoutineSummary = {
  routineId: ROUTINE,
  name: 'Upper / Lower',
  description: null,
  scheduleMode: 'WEEKLY',
  dayCount: 4,
  exerciseCount: 22,
  updatedAt: '2026-10-07T08:00:00.000Z',
};
const objects = {
  routines: new Map([[ROUTINE, summary]]),
  workouts: new Map(),
  records: new Map(),
};

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'm1',
    senderId: SENDER,
    body: null,
    deletedAt: null,
    moderationHiddenAt: null,
    attachmentKind: 'ROUTINE',
    attachmentId: ROUTINE,
    createdAt: new Date(Date.UTC(2026, 9, 7, 8, 0)),
    ...overrides,
  };
}

describe('MSG-07 a routine in a message', () => {
  it('reads as the routine is now, for both participants', () => {
    for (const viewer of [SENDER, READER]) {
      assert.deepEqual(messageFor(message(), viewer, objects).attachment, {
        kind: 'ROUTINE',
        routine: summary,
      });
    }
  });

  it('says it is no longer available once the routine is gone or hidden', () => {
    assert.deepEqual(messageFor(message(), READER).attachment, {
      kind: 'ROUTINE',
      routine: null,
    });
  });

  it('carries nothing when it carries nothing', () => {
    const plain = message({ body: 'hi', attachmentKind: null, attachmentId: null });
    assert.equal(messageFor(plain, READER, objects).attachment, null);
  });

  it('goes with the text: never once deleted, and not to the other member while hidden', () => {
    const deleted = message({ deletedAt: new Date() });
    for (const viewer of [SENDER, READER]) {
      assert.equal(attachmentFor(deleted, viewer, objects), null);
    }
    const hidden = message({ moderationHiddenAt: new Date() });
    assert.equal(attachmentFor(hidden, READER, objects), null);
    assert.deepEqual(attachmentFor(hidden, SENDER, objects), {
      kind: 'ROUTINE',
      routine: summary,
    });
  });

  it('may travel without a note, which is no text rather than a deleted one', () => {
    const seen = messageFor(message(), READER, objects);
    assert.equal(seen.body, null);
    assert.equal(seen.deleted, false);
  });

  it('can be reported even without a note, but never by its sender', () => {
    assert.equal(reportRefusal(message(), READER), null);
    assert.equal(reportRefusal(message(), SENDER), 'OWN');
    assert.equal(reportRefusal(message({ deletedAt: new Date() }), READER), 'UNREADABLE');
  });

  it('is captured by the name the reporter saw and nothing more of it', () => {
    const [captured] = captureMessages([message()], 'm1', READER, objects);
    assert.equal(captured.routineName, 'Upper / Lower');
    assert.equal(captured.body, null);
    const [gone] = captureMessages([message()], 'm1', READER);
    assert.equal(gone.routineName, '');
    const [plain] = captureMessages(
      [message({ body: 'hi', attachmentKind: null, attachmentId: null })],
      'm1',
      READER,
      objects,
    );
    assert.equal(plain.routineName, null);
  });
});

describe('MSG-07 what a send may carry', () => {
  it('leaves the note empty only beside a routine', () => {
    assert.equal(messageNote(undefined, true), null);
    assert.equal(messageNote('   ', true), null);
    assert.equal(messageNote('  try this  ', true), 'try this');
    assert.equal(messageNote(undefined, false), undefined);
    assert.equal(messageNote('  ', false), undefined);
    assert.equal(messageNote('x'.repeat(MESSAGE_BODY_MAX + 1), true), undefined);
  });

  it('takes a routine id and an optional body in both writes', async () => {
    const send = plainToInstance(SendMessageDto, { routineId: ROUTINE });
    assert.deepEqual(await validate(send), []);
    const start = plainToInstance(StartConversationDto, {
      recipient: 'ana',
      routineId: ROUTINE,
      body: 'try this',
    });
    assert.deepEqual(await validate(start), []);
    const bad = plainToInstance(SendMessageDto, { routineId: 'not-an-id' });
    assert.equal((await validate(bad)).length, 1);
  });

  it('is a kind of its own, and reading it is a source of its own', () => {
    assert.deepEqual([...MESSAGE_ATTACHMENT_KINDS], ['ROUTINE', 'WORKOUT', 'RECORD']);
    assert.ok((SHARED_ROUTINE_SOURCES as readonly string[]).includes('MESSAGE'));
  });
});

describe('MSG-07 cloning from a message', () => {
  it('names exactly one source', () => {
    assert.deepEqual(readCloneSource({ messageId: ' m1 ' }), {
      kind: 'MESSAGE',
      messageId: 'm1',
    });
    assert.deepEqual(readCloneSource({ routineId: ROUTINE }), {
      kind: 'VISIBILITY',
      routineId: ROUTINE,
    });
    for (const request of [
      {},
      { messageId: 'm1', routineId: ROUTINE },
      { messageId: 'm1', token: 'x'.repeat(24) },
      { messageId: '  ' },
    ]) {
      assert.throws(() => readCloneSource(request), /SOURCE_REQUIRED/);
    }
  });
});

describe('MSG-07 migration', () => {
  it('stores a typed reference, never a foreign key', () => {
    assert.match(MIGRATION, /"attachmentKind" "MessageAttachmentKind"/);
    assert.match(MIGRATION, /"attachmentId" TEXT/);
    assert.doesNotMatch(MIGRATION, /REFERENCES|FOREIGN KEY/);
  });

  it('is safe to run twice', () => {
    assert.match(MIGRATION, /WHEN duplicate_object THEN NULL/);
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
  });
});

const SESSION = '44444444-4444-4444-8444-444444444444';
const WORKOUT_MIGRATION = readFileSync(
  'prisma/migrations/20261007140000_message_workouts/migration.sql',
  'utf8',
);

describe('MSG-10 a finished workout in a message', () => {
  const ended = new Date(Date.UTC(2026, 9, 7, 9, 0));
  const card = toWorkoutSummary({
    id: SESSION,
    startedAt: new Date(Date.UTC(2026, 9, 7, 8, 0)),
    endedAt: ended,
    durationSec: null,
    totalVolumeKg: 6250,
    completedSets: 18,
    snapshot: null,
    routine: { name: 'Upper / Lower' },
    routineDay: { dayOfWeek: 1, name: 'Upper A', order: 0 },
  });
  const workouts = {
    routines: new Map(),
    workouts: new Map([[SESSION, card]]),
    records: new Map(),
  };
  const shared = message({ attachmentKind: 'WORKOUT', attachmentId: SESSION });

  it('reads as a card of what was trained and its totals', () => {
    assert.deepEqual(card, {
      sessionId: SESSION,
      routineName: 'Upper / Lower',
      dayName: 'Upper A',
      endedAt: ended.toISOString(),
      durationSec: 3600,
      totalVolumeKg: 6250,
      completedSets: 18,
    });
    assert.deepEqual(messageFor(shared, READER, workouts).attachment, {
      kind: 'WORKOUT',
      workout: card,
    });
  });

  it('says it is no longer available once the workout is gone', () => {
    assert.deepEqual(messageFor(shared, READER).attachment, {
      kind: 'WORKOUT',
      workout: null,
    });
  });

  it('goes with the text, like a routine', () => {
    assert.equal(attachmentFor({ ...shared, deletedAt: new Date() }, SENDER, workouts), null);
    const hidden = { ...shared, moderationHiddenAt: new Date() };
    assert.equal(attachmentFor(hidden, READER, workouts), null);
    assert.ok(attachmentFor(hidden, SENDER, workouts));
  });

  it('is captured by the routine and day the reporter saw', () => {
    const [captured] = captureMessages([shared], 'm1', READER, workouts);
    assert.equal(captured.workoutName, 'Upper / Lower · Upper A');
    assert.equal(captured.routineName, null);
    const [gone] = captureMessages([shared], 'm1', READER);
    assert.equal(gone.workoutName, '');
  });

  it('opens to each exercise in the order the day trained it, sets by number, never RPE', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 8, minute));
    const log = (
      routineExerciseId: string | null,
      setNumber: number,
      minute: number,
      overrides: Record<string, unknown> = {},
    ) => ({
      exerciseId: `ex-${routineExerciseId}`,
      routineExerciseId,
      setNumber,
      kind: 'WORKING' as const,
      weight: 100,
      reps: 5,
      completedAt: at(minute),
      exerciseName: `Exercise ${routineExerciseId}`,
      ...overrides,
    });
    const exercises = sharedWorkoutExercises(
      [
        log('b', 2, 30),
        log('a', 1, 10, { kind: 'WARMUP', weight: 60 }),
        log('b', 1, 25),
        log('a', 2, 12),
        log(null, 1, 5, { exerciseId: 'ex-extra', exerciseName: 'Extra' }),
      ],
      ['a', 'b'],
    );
    assert.deepEqual(
      exercises.map((exercise) => exercise.name),
      ['Exercise a', 'Exercise b', 'Extra'],
    );
    assert.deepEqual(exercises[0].sets, [
      { setNumber: 1, kind: 'WARMUP', weightKg: 60, reps: 5 },
      { setNumber: 2, kind: 'WORKING', weightKg: 100, reps: 5 },
    ]);
    assert.deepEqual(exercises[1].sets.map((set) => set.setNumber), [1, 2]);
    assert.ok(!('rpe' in exercises[0].sets[0]));
  });

  it('takes a session id in both writes', async () => {
    const send = plainToInstance(SendMessageDto, { sessionId: SESSION });
    assert.deepEqual(await validate(send), []);
    const start = plainToInstance(StartConversationDto, { recipient: 'ana', sessionId: SESSION });
    assert.deepEqual(await validate(start), []);
    assert.ok((MESSAGE_ATTACHMENT_KINDS as readonly string[]).includes('WORKOUT'));
  });

  it('adds its kind safely, twice', () => {
    assert.match(WORKOUT_MIGRATION, /ADD VALUE IF NOT EXISTS 'WORKOUT'/);
  });
});

const RECORD_EVENT = '55555555-5555-4555-8555-555555555555';
const RECORD_MIGRATION = readFileSync(
  'prisma/migrations/20261007180000_message_records/migration.sql',
  'utf8',
);

describe('MSG-11 a personal record in a message', () => {
  const record = {
    eventId: RECORD_EVENT,
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
    occurredAt: '2026-10-07T09:00:00.000Z',
    current: { weightKg: 100, reps: 5, estimated1rmKg: 116.7 },
    previous: { weightKg: 95, reps: 5, estimated1rmKg: 110.8 },
    reason: 'HEAVIER_LOAD' as const,
  };
  const records = {
    routines: new Map(),
    workouts: new Map(),
    records: new Map([[RECORD_EVENT, record]]),
  };
  const shared = message({ attachmentKind: 'RECORD', attachmentId: RECORD_EVENT });

  it('reads as that record as set, with the best it beat', () => {
    assert.deepEqual(messageFor(shared, READER, records).attachment, {
      kind: 'RECORD',
      record,
    });
  });

  it('says it is no longer available once a correction removed it', () => {
    assert.deepEqual(messageFor(shared, READER).attachment, {
      kind: 'RECORD',
      record: null,
    });
  });

  it('goes with the text, like the other kinds', () => {
    assert.equal(attachmentFor({ ...shared, deletedAt: new Date() }, SENDER, records), null);
    assert.equal(attachmentFor({ ...shared, moderationHiddenAt: new Date() }, READER, records), null);
  });

  it('is captured by its lift, and nothing more of it', () => {
    const [captured] = captureMessages([shared], 'm1', READER, records);
    assert.equal(captured.recordName, 'Bench Press');
    assert.equal(captured.workoutName, null);
    const [gone] = captureMessages([shared], 'm1', READER);
    assert.equal(gone.recordName, '');
  });

  it('is worded as the timeline words it, and a stale record is no record', () => {
    const row = (weight: number, reps: number, previous: unknown) => ({
      id: 'e',
      payload: { exerciseId: 'bench', exerciseName: 'Bench Press', weight, reps, estimated1rm: weight * (1 + reps / 30) },
      previousPayload: previous,
    });
    const best = { exerciseId: 'bench', exerciseName: 'Bench Press', weight: 95, reps: 5, estimated1rm: 110.8 };
    assert.equal(personalRecordParts(row(100, 5, null))?.reason, 'FIRST_RECORDED_BEST');
    assert.equal(personalRecordParts(row(100, 5, best))?.reason, 'HEAVIER_LOAD');
    assert.equal(personalRecordParts(row(95, 6, best))?.reason, 'MORE_REPS_AT_SAME_LOAD');
    assert.equal(personalRecordParts(row(90, 8, best)), null);
  });

  it('takes a record event id in both writes', async () => {
    const send = plainToInstance(SendMessageDto, { recordEventId: RECORD_EVENT });
    assert.deepEqual(await validate(send), []);
    assert.ok((MESSAGE_ATTACHMENT_KINDS as readonly string[]).includes('RECORD'));
  });

  it('adds its kind safely, twice', () => {
    assert.match(RECORD_MIGRATION, /ADD VALUE IF NOT EXISTS 'RECORD'/);
  });
});
