import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  apiError,
  trainingReviewSelectionFits,
  TRAINING_REVIEW_WORKOUTS_MAX,
  TRAINING_REVIEW_WORKOUTS_MIN,
  type CreateTrainingReviewRequest,
  type TrainingReviewFinding,
  type TrainingReviewResult,
  type TrainingReviewState,
  type TrainingReviewUsage,
} from "@sunsteel/contracts";
import {
  AiUsageService,
  costMicros,
  isPricedModel,
  monthRange,
  type ReservationRefusal,
  type TokenUsage,
} from "../ai/ai-usage";
import { limitOf } from "../billing/plan-of";
import { DatabaseService } from "../database/database.service";
import {
  buildEvidencePack,
  readReviewEvidence,
  type EvidencePack,
} from "./training-review-evidence";
import {
  reviewReserveFor,
  TRAINING_REVIEW_MODEL,
  type ReviewCallResult,
  type TrainingReviewModel,
} from "./training-review-model";
import { repairPrompt, reviewPrompt } from "./training-review-prompt";
import {
  checkReviewAnswer,
  citedFacts,
  type ReviewCheck,
} from "./training-review-rules";

/** The ledger's feature key; the same word as the entitlement. */
export const TRAINING_REVIEW_FEATURE = "TRAINING_REVIEW";

type Outcome =
  | { status: "DELIVERED"; findings: TrainingReviewFinding[] }
  | { status: "NOT_ENOUGH" }
  | { status: "FAILED" };

function stateFrom(refusal: ReservationRefusal | null): TrainingReviewState {
  if (refusal === "QUOTA_REACHED") return "QUOTA_REACHED";
  return refusal === "PAUSED" ? "PAUSED" : "READY";
}

/**
 * INTEL-04: a review of the workouts a Pro member picks. Nothing is stored
 * but the ledger row: the evidence is read for the request, the answer
 * checked and handed back.
 */
@Injectable()
export class TrainingReviewService {
  private readonly logger = new Logger(TrainingReviewService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly usage: AiUsageService,
    @Inject(TRAINING_REVIEW_MODEL) private readonly model: TrainingReviewModel,
  ) {}

  private configured(): { model: string; reserveMicros: number } | null {
    const model = this.model.modelId;
    if (!model) return null;
    return {
      model,
      reserveMicros: isPricedModel(model) ? reviewReserveFor(model) : 0,
    };
  }

  private async usageFor(
    userId: string,
    limit: number,
  ): Promise<TrainingReviewUsage> {
    const now = new Date();
    const configured = this.configured();
    const { used, refusal } = await this.usage.read({
      userId,
      feature: TRAINING_REVIEW_FEATURE,
      reserveMicros: configured?.reserveMicros ?? 0,
      limit,
      now,
    });
    return {
      state: configured ? stateFrom(refusal) : "UNAVAILABLE",
      used,
      limit,
      resetsAt: monthRange(now).to.toISOString(),
    };
  }

  private async monthlyLimit(userId: string): Promise<number> {
    return (await limitOf(this.db, userId, "TRAINING_REVIEWS_PER_MONTH")) ?? 0;
  }

  async usageOf(userId: string): Promise<TrainingReviewUsage> {
    return this.usageFor(userId, await this.monthlyLimit(userId));
  }

  /** One call, plus one repair when the answer fails the check. */
  private async write(
    pack: EvidencePack,
    body: CreateTrainingReviewRequest,
    calls: ReviewCallResult[],
  ): Promise<Outcome> {
    const prompt = reviewPrompt(pack, body.locale);
    const call = async (next: typeof prompt): Promise<ReviewCheck | null> => {
      const result = await this.model.review(next);
      calls.push(result);
      return result.refused ? null : checkReviewAnswer(result.answer, pack);
    };

    let check = await call(prompt);
    if (check?.kind === "INVALID") {
      check = await call(repairPrompt(prompt, calls[0].answer, check.problems));
    }
    if (check?.kind === "REVIEW")
      return { status: "DELIVERED", findings: check.findings };
    if (check?.kind === "NOT_ENOUGH") return { status: "NOT_ENOUGH" };
    return { status: "FAILED" };
  }

  /** Every call's tokens, priced by the model that really answered. */
  private spendOf(calls: readonly ReviewCallResult[]) {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let cost = 0;
    for (const call of calls) {
      usage.inputTokens += call.usage.inputTokens;
      usage.outputTokens += call.usage.outputTokens;
      if (isPricedModel(call.model)) cost += costMicros(call.model, call.usage);
    }
    return { usage, cost };
  }

  async create(
    userId: string,
    body: CreateTrainingReviewRequest,
  ): Promise<TrainingReviewResult> {
    const configured = this.configured();
    if (!configured) {
      throw new ServiceUnavailableException(
        apiError("TRAINING_REVIEWS_UNAVAILABLE"),
      );
    }
    const sessionIds = [...new Set(body.sessionIds)];
    if (!trainingReviewSelectionFits(sessionIds.length)) {
      throw new BadRequestException(
        apiError("TRAINING_REVIEW_WORKOUTS", {
          min: TRAINING_REVIEW_WORKOUTS_MIN,
          max: TRAINING_REVIEW_WORKOUTS_MAX,
        }),
      );
    }

    // The evidence is decided before anything is reserved, so a question
    // these workouts cannot answer costs nothing and counts for nothing.
    const evidence = await readReviewEvidence(this.db, userId, sessionIds);
    if (!evidence)
      throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
    const pack = buildEvidencePack({ question: body.question, ...evidence });
    if (pack.precheck === "NO_SHARED_EXERCISE") {
      throw new UnprocessableEntityException(
        apiError("TRAINING_REVIEW_NO_SHARED_EXERCISE"),
      );
    }
    if (pack.precheck === "NO_EFFORT_DATA") {
      throw new UnprocessableEntityException(
        apiError("TRAINING_REVIEW_NO_EFFORT_DATA"),
      );
    }

    const limit = await this.monthlyLimit(userId);
    const reservation = await this.usage.reserve({
      userId,
      feature: TRAINING_REVIEW_FEATURE,
      model: configured.model,
      reserveMicros: configured.reserveMicros,
      limit,
    });
    if (reservation.refusal !== null) {
      if (reservation.refusal === "QUOTA_REACHED") {
        throw new ForbiddenException(
          apiError("TRAINING_REVIEW_QUOTA_REACHED", { max: limit }),
        );
      }
      throw new ServiceUnavailableException(
        apiError("TRAINING_REVIEWS_PAUSED"),
      );
    }

    const calls: ReviewCallResult[] = [];
    let outcome: Outcome = { status: "FAILED" };
    try {
      outcome = await this.write(pack, body, calls);
    } catch (error) {
      // Never the member's training: only what went wrong with the call.
      this.logger.error(
        `Training review call failed: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
    const { usage, cost } = this.spendOf(calls);
    await this.usage.settle(reservation.id, {
      status: outcome.status,
      model: calls.at(-1)?.model ?? configured.model,
      usage,
      costMicros: cost,
    });

    if (outcome.status === "NOT_ENOUGH") {
      throw new UnprocessableEntityException(
        apiError("TRAINING_REVIEW_NOT_ENOUGH"),
      );
    }
    if (outcome.status === "FAILED") {
      throw new UnprocessableEntityException(
        apiError("TRAINING_REVIEW_FAILED"),
      );
    }
    return {
      review: {
        question: body.question,
        workouts: pack.workouts,
        findings: outcome.findings,
        facts: citedFacts(outcome.findings, pack),
      },
      usage: await this.usageFor(userId, limit),
    };
  }
}
