import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  apiError,
  type CreateRoutineDraftRequest,
  type RoutineDraft,
  type RoutineDraftResult,
  type RoutineDraftState,
  type RoutineDraftUsage,
} from '@sunsteel/contracts';
import {
  AiUsageService,
  costMicros,
  isPricedModel,
  monthRange,
  type ReservationRefusal,
  type TokenUsage,
} from '../ai/ai-usage';
import { limitOf } from '../billing/plan-of';
import { DatabaseService } from '../database/database.service';
import {
  ROUTINE_DRAFT_MODEL,
  reserveFor,
  type DraftCallResult,
  type RoutineDraftModel,
} from './routine-draft-model';
import { draftPrompt, repairPrompt } from './routine-draft-prompt';
import {
  checkDraftAnswer,
  type DraftCatalogExercise,
  type DraftCheck,
} from './routine-draft-rules';

/** The ledger's feature key; the same word as the entitlement. */
export const ROUTINE_DRAFTS_FEATURE = 'ROUTINE_DRAFTS';

type Outcome =
  | { status: 'DELIVERED'; draft: RoutineDraft }
  | { status: 'NOT_TRAINING' }
  | { status: 'FAILED' };

function stateFrom(refusal: ReservationRefusal | null): RoutineDraftState {
  if (refusal === 'QUOTA_REACHED') return 'QUOTA_REACHED';
  return refusal === 'PAUSED' ? 'PAUSED' : 'READY';
}

/**
 * INTEL-03: a member's words to a routine draft. Nothing here writes a
 * routine: the draft is handed back for the wizard and stored only when the
 * member presses Create, through the ordinary routine write.
 */
@Injectable()
export class RoutineDraftsService {
  private readonly logger = new Logger(RoutineDraftsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly usage: AiUsageService,
    @Inject(ROUTINE_DRAFT_MODEL) private readonly model: RoutineDraftModel,
  ) {}

  /** What the ledger needs to hear of the configured model, or null without one. */
  private configured(): { model: string; reserveMicros: number } | null {
    const model = this.model.modelId;
    if (!model) return null;
    return { model, reserveMicros: isPricedModel(model) ? reserveFor(model) : 0 };
  }

  private async usageFor(userId: string, limit: number): Promise<RoutineDraftUsage> {
    const now = new Date();
    const configured = this.configured();
    const { used, refusal } = await this.usage.read({
      userId,
      feature: ROUTINE_DRAFTS_FEATURE,
      reserveMicros: configured?.reserveMicros ?? 0,
      limit,
      now,
    });
    return {
      state: configured ? stateFrom(refusal) : 'UNAVAILABLE',
      used,
      limit,
      resetsAt: monthRange(now).to.toISOString(),
    };
  }

  private async monthlyLimit(userId: string): Promise<number> {
    return (await limitOf(this.db, userId, 'ROUTINE_DRAFTS_PER_MONTH')) ?? 0;
  }

  async usageOf(userId: string): Promise<RoutineDraftUsage> {
    return this.usageFor(userId, await this.monthlyLimit(userId));
  }

  /** The shared catalog, in a stable order; never a member's own exercises. */
  private async catalog(): Promise<DraftCatalogExercise[]> {
    return this.db.exercise.findMany({
      where: { ownerId: null, archivedAt: null },
      select: {
        id: true,
        name: true,
        primaryMuscles: true,
        equipment: true,
        equipmentRequired: true,
        movementPattern: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  /** One call, plus one repair when the answer fails the check. */
  private async write(
    body: CreateRoutineDraftRequest,
    calls: DraftCallResult[],
  ): Promise<Outcome> {
    const catalog = await this.catalog();
    const prompt = draftPrompt(body.request, body.locale, catalog);

    const call = async (next: typeof prompt): Promise<DraftCheck | null> => {
      const result = await this.model.draft(next, catalog);
      calls.push(result);
      return result.refused ? null : checkDraftAnswer(result.answer, catalog);
    };

    let check = await call(prompt);
    if (check?.kind === 'INVALID') {
      check = await call(repairPrompt(prompt, calls[0].answer, check.problems));
    }
    if (check?.kind === 'DRAFT') return { status: 'DELIVERED', draft: check.draft };
    if (check?.kind === 'NOT_TRAINING') return { status: 'NOT_TRAINING' };
    return { status: 'FAILED' };
  }

  /** Every call's tokens, priced by the model that really answered. */
  private spendOf(calls: readonly DraftCallResult[]) {
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
    body: CreateRoutineDraftRequest,
  ): Promise<RoutineDraftResult> {
    const configured = this.configured();
    if (!configured) {
      throw new ServiceUnavailableException(apiError('ROUTINE_DRAFTS_UNAVAILABLE'));
    }
    const limit = await this.monthlyLimit(userId);
    const reservation = await this.usage.reserve({
      userId,
      feature: ROUTINE_DRAFTS_FEATURE,
      model: configured.model,
      reserveMicros: configured.reserveMicros,
      limit,
    });
    if (reservation.refusal !== null) {
      if (reservation.refusal === 'QUOTA_REACHED') {
        throw new ForbiddenException(
          apiError('ROUTINE_DRAFT_QUOTA_REACHED', { max: limit }),
        );
      }
      throw new ServiceUnavailableException(apiError('ROUTINE_DRAFTS_PAUSED'));
    }

    const calls: DraftCallResult[] = [];
    let outcome: Outcome = { status: 'FAILED' };
    try {
      outcome = await this.write(body, calls);
    } catch (error) {
      // Never the member's text: only what went wrong with the call.
      this.logger.error(
        `Routine draft call failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
    const { usage, cost } = this.spendOf(calls);
    await this.usage.settle(reservation.id, {
      status: outcome.status,
      model: calls.at(-1)?.model ?? configured.model,
      usage,
      costMicros: cost,
    });

    if (outcome.status === 'NOT_TRAINING') {
      throw new UnprocessableEntityException(apiError('ROUTINE_DRAFT_NOT_TRAINING'));
    }
    if (outcome.status === 'FAILED') {
      throw new UnprocessableEntityException(apiError('ROUTINE_DRAFT_FAILED'));
    }
    return { draft: outcome.draft, usage: await this.usageFor(userId, limit) };
  }
}
