import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicRoutineDraftModel,
  DEFAULT_DRAFT_MODEL,
} from '../../src/routine-drafts/routine-draft-model';
import { draftPrompt, repairPrompt } from '../../src/routine-drafts/routine-draft-prompt';
import { checkDraftAnswer } from '../../src/routine-drafts/routine-draft-rules';
import { costMicros } from '../../src/ai/ai-usage';
import { EVAL_CASES, EVAL_CATALOG, evalProblems } from './checks';

/**
 * INTEL-03: the eval set against the real model, by hand and weekly
 * (`.github/workflows/routine-draft-evals.yml`). It costs money, about one
 * draft per case. `--record` rewrites `recorded/` with the answers, which is
 * what every pull request then checks.
 *
 *   ANTHROPIC_API_KEY=... npm run evals:routine-drafts -- [--record]
 */
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('ANTHROPIC_API_KEY is not set, so nothing was asked.');
    return;
  }
  const record = process.argv.includes('--record');
  const modelId = process.env.ROUTINE_DRAFT_MODEL || DEFAULT_DRAFT_MODEL;
  const model = new AnthropicRoutineDraftModel(modelId, new Anthropic({ apiKey }));

  let failures = 0;
  let spentMicros = 0;
  for (const evalCase of EVAL_CASES) {
    const prompt = draftPrompt(evalCase.request, evalCase.locale, EVAL_CATALOG);
    let call = await model.draft(prompt);
    spentMicros += costMicros(call.model, call.usage);
    const check = checkDraftAnswer(call.answer, EVAL_CATALOG);
    if (check.kind === 'INVALID' && !call.refused) {
      call = await model.draft(repairPrompt(prompt, call.answer, check.problems));
      spentMicros += costMicros(call.model, call.usage);
    }
    const problems = evalProblems(evalCase, call.answer);
    console.log(`${problems.length ? 'FAIL' : 'pass'} ${evalCase.id}`);
    for (const problem of problems) console.log(`  ${problem}`);
    if (problems.length) failures += 1;
    if (record) {
      const path = join(__dirname, 'recorded', `${evalCase.id}.json`);
      const recording = { source: 'live', model: call.model, answer: call.answer };
      writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
    }
  }
  console.log(
    `${EVAL_CASES.length - failures}/${EVAL_CASES.length} passed, $${(spentMicros / 1_000_000).toFixed(2)} on ${modelId}`,
  );
  if (failures) process.exitCode = 1;
}

export function readRecording(id: string): { source: string; answer: unknown } {
  return JSON.parse(readFileSync(join(__dirname, 'recorded', `${id}.json`), 'utf8')) as {
    source: string;
    answer: unknown;
  };
}

if (require.main === module) void main();
