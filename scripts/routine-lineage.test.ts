import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveRoutineLineage,
  type LineageSource,
  type LineageViewer,
} from '../src/routines/routine-lineage';

const clonedAt = new Date('2026-09-18T10:00:00.000Z');
const author = {
  id: 'author',
  username: 'author',
  name: 'Author',
  lastName: null,
  avatarUrl: null,
};

const source = (overrides: Partial<LineageSource> = {}): LineageSource => ({
  routineId: 'source-routine',
  clonedAt,
  author,
  sourceVisibility: 'PUBLIC',
  authorRoutinesRule: 'PUBLIC',
  ...overrides,
});

const viewer = (overrides: Partial<LineageViewer> = {}): LineageViewer => ({
  isOwner: false,
  isFollower: false,
  isBlocked: false,
  ...overrides,
});

describe('ROUT-06 lineage', () => {
  it('is absent on a routine that was never cloned', () => {
    assert.equal(
      resolveRoutineLineage(source({ clonedAt: null }), viewer()),
      null,
    );
  });

  it('names the source and its author when the viewer could read it anyway', () => {
    assert.deepEqual(resolveRoutineLineage(source(), viewer()), {
      sourceRoutineId: 'source-routine',
      author: {
        username: 'author',
        name: 'Author',
        lastName: null,
        avatarUrl: null,
      },
      isSourceHidden: false,
      clonedAt: '2026-09-18T10:00:00.000Z',
    });
  });

  it('never widens what a viewer can learn about a routine', () => {
    // A public clone must not become a way to discover that a private routine
    // exists, and who wrote it. Both ROUT-04 rules apply, narrower first.
    const hidden = { sourceRoutineId: null, author: null, isSourceHidden: true, clonedAt: '2026-09-18T10:00:00.000Z' };

    assert.deepEqual(
      resolveRoutineLineage(source({ sourceVisibility: 'PRIVATE' }), viewer()),
      hidden,
      'a private source says nothing',
    );
    assert.deepEqual(
      resolveRoutineLineage(source({ sourceVisibility: 'FOLLOWERS' }), viewer()),
      hidden,
      'a followers-only source says nothing to a stranger',
    );
    assert.equal(
      resolveRoutineLineage(
        source({ sourceVisibility: 'FOLLOWERS' }),
        viewer({ isFollower: true }),
      )?.isSourceHidden,
      false,
      'but does to a follower',
    );
    assert.deepEqual(
      resolveRoutineLineage(
        source({ authorRoutinesRule: 'FOLLOWERS' }),
        viewer(),
      ),
      hidden,
      'the account rule caps the routine here too',
    );
  });

  it('says nothing about a source across a block', () => {
    assert.equal(
      resolveRoutineLineage(source(), viewer({ isBlocked: true }))
        ?.isSourceHidden,
      true,
    );
  });

  it('still says it is a clone when the source or its author is gone', () => {
    // Deleting a source must not delete somebody else's copy, and the copy
    // should not start claiming to be original work.
    assert.deepEqual(
      resolveRoutineLineage(source({ routineId: null, sourceVisibility: null }), viewer()),
      {
        sourceRoutineId: null,
        author: null,
        isSourceHidden: true,
        clonedAt: '2026-09-18T10:00:00.000Z',
      },
    );
    assert.equal(
      resolveRoutineLineage(
        source({ author: null, authorRoutinesRule: null }),
        viewer(),
      )?.isSourceHidden,
      true,
    );
  });

  it('shows the owner their own source whatever its visibility says', () => {
    assert.equal(
      resolveRoutineLineage(
        source({ sourceVisibility: 'PRIVATE', authorRoutinesRule: 'PRIVATE' }),
        viewer({ isOwner: true }),
      )?.sourceRoutineId,
      'source-routine',
    );
  });
});
