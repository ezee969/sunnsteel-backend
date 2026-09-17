import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProfileVisibility, RoutineVisibility } from '@sunsteel/contracts';
import {
  canViewRoutine,
  effectiveRoutineVisibility,
  isCappedByAccountRule,
} from '../src/routines/routine-visibility';

const viewer = { isOwner: false, isFollower: false };
const follower = { isOwner: false, isFollower: true };
const owner = { isOwner: true, isFollower: false };

const can = (
  account: ProfileVisibility,
  routine: RoutineVisibility,
  context = viewer,
) => canViewRoutine(account, routine, context);

test('the owner always reads their own routine, whatever both rules say', () => {
  assert.equal(can('PRIVATE', 'PRIVATE', owner), true);
});

test('a private routine is private however open the account is', () => {
  assert.equal(can('PUBLIC', 'PRIVATE'), false);
  assert.equal(can('PUBLIC', 'PRIVATE', follower), false);
});

test('a public routine in a public account is readable by anyone', () => {
  assert.equal(can('PUBLIC', 'PUBLIC'), true);
});

test('the account rule caps the routine, never the other way round', () => {
  // The whole point: a per-routine switch must not widen a privacy setting
  // the owner made elsewhere.
  assert.equal(can('FOLLOWERS', 'PUBLIC'), false, 'a stranger is refused');
  assert.equal(can('FOLLOWERS', 'PUBLIC', follower), true, 'a follower is not');
  assert.equal(can('PRIVATE', 'PUBLIC'), false);
  assert.equal(can('PRIVATE', 'PUBLIC', follower), false);
});

test('a followers-only routine is refused to a stranger in a public account', () => {
  assert.equal(can('PUBLIC', 'FOLLOWERS'), false);
  assert.equal(can('PUBLIC', 'FOLLOWERS', follower), true);
});

test('the effective visibility is the narrower of the two rules', () => {
  assert.equal(effectiveRoutineVisibility('PUBLIC', 'PUBLIC'), 'PUBLIC');
  assert.equal(effectiveRoutineVisibility('FOLLOWERS', 'PUBLIC'), 'FOLLOWERS');
  assert.equal(effectiveRoutineVisibility('PRIVATE', 'PUBLIC'), 'PRIVATE');
  assert.equal(effectiveRoutineVisibility('PUBLIC', 'FOLLOWERS'), 'FOLLOWERS');
  assert.equal(effectiveRoutineVisibility('PUBLIC', 'PRIVATE'), 'PRIVATE');
});

test('capping is reported so the owner can be told why', () => {
  assert.equal(isCappedByAccountRule('FOLLOWERS', 'PUBLIC'), true);
  assert.equal(isCappedByAccountRule('PRIVATE', 'FOLLOWERS'), true);
  assert.equal(isCappedByAccountRule('PUBLIC', 'PUBLIC'), false);
  // A routine the owner made private is not "capped"; it is their choice.
  assert.equal(isCappedByAccountRule('PRIVATE', 'PRIVATE'), false);
});

test('every combination agrees with the effective visibility it reports', () => {
  const accounts: ProfileVisibility[] = ['PRIVATE', 'FOLLOWERS', 'PUBLIC'];
  const routines: RoutineVisibility[] = ['PRIVATE', 'FOLLOWERS', 'PUBLIC'];
  for (const account of accounts) {
    for (const routine of routines) {
      const effective = effectiveRoutineVisibility(account, routine);
      assert.equal(
        can(account, routine),
        effective === 'PUBLIC',
        `stranger, account ${account}, routine ${routine}`,
      );
      assert.equal(
        can(account, routine, follower),
        effective !== 'PRIVATE',
        `follower, account ${account}, routine ${routine}`,
      );
    }
  }
});
