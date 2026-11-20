import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { costMicros, isPricedModel, type TokenUsage } from "../ai/ai-usage";
import {
  REVIEW_ANSWER_SCHEMA,
  type ReviewPrompt,
} from "./training-review-prompt";

/**
 * INTEL-04: where a review's words come from. Production uses Anthropic --
 * Claude Sonnet 5.5, the owner's choice at claim, which `TRAINING_REVIEW_MODEL`
 * changes without a release -- tests and local development use
 * `FakeTrainingReviewModel`, and with neither reviews are unavailable.
 */

export const DEFAULT_REVIEW_MODEL = "claude-sonnet-5-5";

/** Thinking counts as output, so this bounds an answer and its reasoning. */
export const REVIEW_MAX_OUTPUT_TOKENS = 6000;
const REVIEW_TIMEOUT_MS = 60_000;

/** Instructions and six workouts' facts, generously. */
const REVIEW_MAX_INPUT_TOKENS = 14_000;

export interface ReviewCallResult {
  /** The parsed answer, or null when none arrived whole. */
  answer: unknown;
  /** The model that answered, which a declined request may change. */
  model: string;
  usage: TokenUsage;
  /** The model declined; asking again would not help. */
  refused: boolean;
}

export interface TrainingReviewModel {
  /** The model named, or null when reviews are not configured. */
  readonly modelId: string | null;
  review(prompt: ReviewPrompt): Promise<ReviewCallResult>;
}

export const TRAINING_REVIEW_MODEL = Symbol("TRAINING_REVIEW_MODEL");

/** The most two attempts can cost, held against the ceiling while one runs. */
export function reviewReserveFor(model: string): number {
  return (
    2 *
    costMicros(model, {
      inputTokens: REVIEW_MAX_INPUT_TOKENS,
      outputTokens: REVIEW_MAX_OUTPUT_TOKENS,
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
 * The Messages API through the SDK, as `INTEL-03` asks it: structured output,
 * a safety decline falling back server-side (`fallbacks: "default"`), and
 * `stop_reason` read before `content`, a stop for length being an answer that
 * never arrived whole.
 */
export class AnthropicTrainingReviewModel implements TrainingReviewModel {
  constructor(
    readonly modelId: string,
    private readonly client: Pick<Anthropic, "beta">,
  ) {}

  async review(prompt: ReviewPrompt): Promise<ReviewCallResult> {
    const response = await this.client.beta.messages.create(
      {
        model: this.modelId,
        max_tokens: REVIEW_MAX_OUTPUT_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: REVIEW_ANSWER_SCHEMA },
        },
      },
      { timeout: REVIEW_TIMEOUT_MS },
    );
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    const model = isPricedModel(response.model) ? response.model : this.modelId;
    if (response.stop_reason === "refusal") {
      return { answer: null, model, usage, refused: true };
    }
    const text = response.content.find((block) => block.type === "text");
    return {
      answer:
        response.stop_reason === "end_turn" ? parseAnswer(text?.text) : null,
      model,
      usage,
      refused: false,
    };
  }
}

/**
 * One finding from the evidence it is given, so the whole path runs with no
 * key and no spend: the first exercise and its first two values. Without an
 * exercise it answers NOT_ENOUGH. `TRAINING_REVIEWS_FAKE=true` turns it on
 * outside production.
 */
export class FakeTrainingReviewModel implements TrainingReviewModel {
  readonly modelId = "fake";

  review(prompt: ReviewPrompt): Promise<ReviewCallResult> {
    const usage = { inputTokens: 0, outputTokens: 0 };
    const facts = [
      ...prompt.user.matchAll(/^(F\d+) \| (W\d+|-) \| ([^|]*) \| (.*)$/gm),
    ];
    const exercise = facts.find((line) => line[4] === "the exercise");
    const values = exercise
      ? facts.filter(
          (line) =>
            line[3] === exercise[3] &&
            line[2] !== "-" &&
            line[4] !== "the exercise",
        )
      : [];
    if (!exercise || values.length < 2) {
      return Promise.resolve({
        answer: { status: "NOT_ENOUGH", findings: [] },
        model: this.modelId,
        usage,
        refused: false,
      });
    }
    const spanish = prompt.system.includes("Spanish");
    return Promise.resolve({
      answer: {
        status: "REVIEW",
        findings: [
          {
            segments: [
              { fact: exercise[1] },
              { text: spanish ? " pasó de " : " went from " },
              { fact: values[0][1] },
              { text: spanish ? " a " : " to " },
              { fact: values[1][1] },
              { text: "." },
            ],
          },
        ],
      },
      model: this.modelId,
      usage,
      refused: false,
    });
  }
}

class UnconfiguredTrainingReviewModel implements TrainingReviewModel {
  readonly modelId = null;

  review(): Promise<ReviewCallResult> {
    return Promise.reject(new Error("No training review model is configured"));
  }
}

const logger = new Logger("TrainingReviewModel");

/** The fake never answers in production, and a model without a price never runs. */
export function trainingReviewModelFrom(
  config: ConfigService,
): TrainingReviewModel {
  const apiKey = config.get<string>("ANTHROPIC_API_KEY");
  const model =
    config.get<string>("TRAINING_REVIEW_MODEL") || DEFAULT_REVIEW_MODEL;
  if (apiKey) {
    if (!isPricedModel(model)) {
      logger.error(`${model} has no price, so the cost ceiling cannot hold it`);
      return new UnconfiguredTrainingReviewModel();
    }
    return new AnthropicTrainingReviewModel(
      model,
      new Anthropic({ apiKey, maxRetries: 1 }),
    );
  }
  const production = config.get<string>("NODE_ENV") === "production";
  if (!production && config.get<string>("TRAINING_REVIEWS_FAKE") === "true") {
    return new FakeTrainingReviewModel();
  }
  return new UnconfiguredTrainingReviewModel();
}
