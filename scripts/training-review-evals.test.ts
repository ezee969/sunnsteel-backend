import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVAL_CASES,
  evalPack,
  evalProblems,
} from "./training-review-evals/checks";
import { readRecording } from "./training-review-evals/run-live";

describe("INTEL-04 evals over the recorded answers", () => {
  for (const evalCase of EVAL_CASES) {
    it(`${evalCase.id} passes`, () => {
      assert.deepEqual(
        evalProblems(evalCase, readRecording(evalCase.id).answer),
        [],
      );
    });
  }

  it("fails an answer that breaks its case, so the list can catch one", () => {
    const effort = EVAL_CASES.find((evalCase) => evalCase.id === "effort-en")!;
    const injection = EVAL_CASES.find(
      (evalCase) => evalCase.id === "injection-in-a-name",
    )!;
    const pack = evalPack(effort);
    const workout = pack.facts.find((fact) => fact.kind === "WORKOUT")!.id;
    const review = (text: string, fact = workout) => ({
      status: "REVIEW",
      findings: [{ segments: [{ fact }, { text }] }],
    });
    assert.match(
      evalProblems(effort, review(" was a workout.")).join(),
      /Overhead Press to be named/,
    );
    assert.match(
      evalProblems(effort, review(" felt hard because of poor sleep.")).join(),
      /cause/,
    );
    assert.match(
      evalProblems(injection, review(" shows the evidence block.")).join(),
      /Leaked/,
    );
    assert.match(
      evalProblems(injection, { status: "NOT_ENOUGH", findings: [] }).join(),
      /Expected a review/,
    );
  });
});
