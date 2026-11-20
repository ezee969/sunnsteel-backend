import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { costMicros } from "../../src/ai/ai-usage";
import {
  AnthropicTrainingReviewModel,
  DEFAULT_REVIEW_MODEL,
} from "../../src/training-review/training-review-model";
import {
  repairPrompt,
  reviewPrompt,
} from "../../src/training-review/training-review-prompt";
import { checkReviewAnswer } from "../../src/training-review/training-review-rules";
import { EVAL_CASES, evalPack, evalProblems } from "./checks";

/**
 * INTEL-04: the eval set against the real model, **by hand only** (the owner's
 * decision at claim: nothing costs money unless a member or the owner asks).
 * About one review per case, a few cents on Sonnet. `--record` rewrites
 * `recorded/` with the answers, which every pull request then checks;
 * `TRAINING_REVIEW_MODEL` tries another model, Haiku for one.
 *
 *   ANTHROPIC_API_KEY=... npm run evals:training-review -- [--record]
 */
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("ANTHROPIC_API_KEY is not set, so nothing was asked.");
    return;
  }
  const record = process.argv.includes("--record");
  const modelId = process.env.TRAINING_REVIEW_MODEL || DEFAULT_REVIEW_MODEL;
  const model = new AnthropicTrainingReviewModel(
    modelId,
    new Anthropic({ apiKey }),
  );

  let failures = 0;
  let spentMicros = 0;
  for (const evalCase of EVAL_CASES) {
    const pack = evalPack(evalCase);
    const prompt = reviewPrompt(pack, evalCase.locale);
    let call = await model.review(prompt);
    spentMicros += costMicros(call.model, call.usage);
    const check = checkReviewAnswer(call.answer, pack);
    if (check.kind === "INVALID" && !call.refused) {
      call = await model.review(
        repairPrompt(prompt, call.answer, check.problems),
      );
      spentMicros += costMicros(call.model, call.usage);
    }
    const problems = evalProblems(evalCase, call.answer);
    console.log(`${problems.length ? "FAIL" : "pass"} ${evalCase.id}`);
    for (const problem of problems) console.log(`  ${problem}`);
    if (problems.length) failures += 1;
    if (record) {
      const path = join(__dirname, "recorded", `${evalCase.id}.json`);
      const recording = {
        source: "live",
        model: call.model,
        answer: call.answer,
      };
      writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
    }
  }
  console.log(
    `${EVAL_CASES.length - failures}/${EVAL_CASES.length} passed, $${(spentMicros / 1_000_000).toFixed(2)} on ${modelId}`,
  );
  if (failures) process.exitCode = 1;
}

export function readRecording(id: string): { source: string; answer: unknown } {
  return JSON.parse(
    readFileSync(join(__dirname, "recorded", `${id}.json`), "utf8"),
  ) as {
    source: string;
    answer: unknown;
  };
}

if (require.main === module) void main();
