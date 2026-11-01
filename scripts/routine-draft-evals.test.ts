import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVAL_CASES, evalProblems } from './routine-draft-evals/checks';
import { readRecording } from './routine-draft-evals/run-live';

describe('INTEL-03 evals over the recorded answers', () => {
  for (const evalCase of EVAL_CASES) {
    it(`${evalCase.id} passes`, () => {
      assert.deepEqual(evalProblems(evalCase, readRecording(evalCase.id).answer), []);
    });
  }

  it('fails an answer that breaks its case, so the list can catch one', () => {
    const knee = EVAL_CASES.find((evalCase) => evalCase.id === 'knee-pain')!;
    const dumbbells = EVAL_CASES.find((evalCase) => evalCase.id === 'dumbbells-only')!;
    const plan = (exercise: string, description = 'A plan.') => ({
      status: 'DRAFT',
      draft: {
        name: 'Plan',
        description,
        scheduleMode: 'WEEKLY',
        days: [1, 4].map((weekday, day) => ({
          weekday,
          name: `Day ${day}`,
          exercises: [
            { exercise, sets: 3, minReps: 8, maxReps: 12, restSeconds: 90 },
          ],
        })),
      },
    });
    assert.match(evalProblems(knee, plan('Squat')).join(), /to be avoided/);
    assert.match(evalProblems(dumbbells, plan('Bench Press')).join(), /needs/);
    assert.match(evalProblems(knee, plan('Plank', 'This will heal your knee.')).join(), /medical/);
  });
});
