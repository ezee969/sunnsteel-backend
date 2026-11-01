import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { costMicros, isPricedModel, type TokenUsage } from '../ai/ai-usage';
import {
  DRAFT_ANSWER_SCHEMA,
  type DraftPrompt,
} from './routine-draft-prompt';
import type { DraftCatalogExercise } from './routine-draft-rules';

/**
 * INTEL-03: where a draft's words come from. Tests, local development and the
 * end-to-end run use `FakeRoutineDraftModel`; production uses Anthropic, and
 * with neither configured drafting is unavailable. The owner chose Claude Opus
 * 5.5 at claim; `ROUTINE_DRAFT_MODEL` changes it without a release.
 */

export const DEFAULT_DRAFT_MODEL = 'claude-opus-5-5';

/** Thinking counts as output, so this bounds a draft and its reasoning. */
export const DRAFT_MAX_OUTPUT_TOKENS = 8000;
const DRAFT_TIMEOUT_MS = 60_000;

/** Prompt and catalog, generously. */
const DRAFT_MAX_INPUT_TOKENS = 6000;

export interface DraftCallResult {
  /** The parsed answer, or null when none arrived whole. */
  answer: unknown;
  /** The model that answered, which a declined request may change. */
  model: string;
  usage: TokenUsage;
  /** The model declined; asking again would not help. */
  refused: boolean;
}

export interface RoutineDraftModel {
  /** The model named, or null when drafting is not configured. */
  readonly modelId: string | null;
  draft(
    prompt: DraftPrompt,
    catalog: readonly DraftCatalogExercise[],
  ): Promise<DraftCallResult>;
}

export const ROUTINE_DRAFT_MODEL = Symbol('ROUTINE_DRAFT_MODEL');

/** The most two attempts can cost, held against the ceiling while one runs. */
export function reserveFor(model: string): number {
  return (
    2 *
    costMicros(model, {
      inputTokens: DRAFT_MAX_INPUT_TOKENS,
      outputTokens: DRAFT_MAX_OUTPUT_TOKENS,
    })
  );
}

function parseAnswer(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The Messages API, through the SDK. A safety decline falls back server-side
 * (`fallbacks: "default"`), so `stop_reason` is checked before `content` is
 * read, and a stop for length is an answer that never arrived whole.
 */
export class AnthropicRoutineDraftModel implements RoutineDraftModel {
  constructor(
    readonly modelId: string,
    private readonly client: Pick<Anthropic, 'beta'>,
  ) {}

  async draft(prompt: DraftPrompt): Promise<DraftCallResult> {
    const response = await this.client.beta.messages.create(
      {
        model: this.modelId,
        max_tokens: DRAFT_MAX_OUTPUT_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: DRAFT_ANSWER_SCHEMA },
        },
      },
      { timeout: DRAFT_TIMEOUT_MS },
    );
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    const model = isPricedModel(response.model) ? response.model : this.modelId;
    if (response.stop_reason === 'refusal') {
      return { answer: null, model, usage, refused: true };
    }
    const text = response.content.find((block) => block.type === 'text');
    return {
      answer: response.stop_reason === 'end_turn' ? parseAnswer(text?.text) : null,
      model,
      usage,
      refused: false,
    };
  }
}

/**
 * A complete three-day plan from whatever the catalog holds, so the whole path
 * runs with no key and no spend. `ROUTINE_DRAFTS_FAKE=true` turns it on outside
 * production. The words "not about training" in a request answer NOT_TRAINING.
 */
export class FakeRoutineDraftModel implements RoutineDraftModel {
  readonly modelId = 'fake';

  draft(
    prompt: DraftPrompt,
    catalog: readonly DraftCatalogExercise[],
  ): Promise<DraftCallResult> {
    const usage = { inputTokens: 0, outputTokens: 0 };
    if (prompt.user.includes('not about training')) {
      return Promise.resolve({
        answer: { status: 'NOT_TRAINING', draft: null },
        model: this.modelId,
        usage,
        refused: false,
      });
    }
    const days = [1, 3, 5].map((weekday, day) => ({
      weekday,
      name: `Day ${day + 1}`,
      exercises: catalog.slice(day * 4, day * 4 + 4).map((exercise) => ({
        exercise: exercise.name,
        sets: 3,
        minReps: 8,
        maxReps: 12,
        restSeconds: 90,
      })),
    }));
    return Promise.resolve({
      answer: {
        status: 'DRAFT',
        draft: {
          name: 'Fake draft',
          description: 'A fixed plan from the fake model.',
          scheduleMode: 'WEEKLY',
          days,
        },
      },
      model: this.modelId,
      usage,
      refused: false,
    });
  }
}

class UnconfiguredRoutineDraftModel implements RoutineDraftModel {
  readonly modelId = null;

  draft(): Promise<DraftCallResult> {
    return Promise.reject(new Error('No routine draft model is configured'));
  }
}

const logger = new Logger('RoutineDraftModel');

/** The fake never answers in production, and a model without a price never runs. */
export function routineDraftModelFrom(config: ConfigService): RoutineDraftModel {
  const apiKey = config.get<string>('ANTHROPIC_API_KEY');
  const model = config.get<string>('ROUTINE_DRAFT_MODEL') || DEFAULT_DRAFT_MODEL;
  if (apiKey) {
    if (!isPricedModel(model)) {
      logger.error(`${model} has no price, so the cost ceiling cannot hold it`);
      return new UnconfiguredRoutineDraftModel();
    }
    return new AnthropicRoutineDraftModel(model, new Anthropic({ apiKey, maxRetries: 1 }));
  }
  const production = config.get<string>('NODE_ENV') === 'production';
  if (!production && config.get<string>('ROUTINE_DRAFTS_FAKE') === 'true') {
    return new FakeRoutineDraftModel();
  }
  return new UnconfiguredRoutineDraftModel();
}
