import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type {
  TrainingReviewResult,
  TrainingReviewUsage,
} from "@sunsteel/contracts";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import { RequiresEntitlement } from "../billing/requires-entitlement";
import type { RequestWithUser } from "../common/types/request-with-user";
import { CreateTrainingReviewDto } from "./dto/create-training-review.dto";
import { TrainingReviewService } from "./training-review.service";

/**
 * INTEL-04: a Pro member's monthly reviews and the writing of one. As for
 * routine drafts, the entitlement goes on each route so it runs after the
 * sign-in.
 */
@UseGuards(SupabaseJwtGuard)
@Controller("training-reviews")
export class TrainingReviewController {
  constructor(private readonly reviews: TrainingReviewService) {}

  @Get("usage")
  @RequiresEntitlement("TRAINING_REVIEW")
  usage(@Request() req: RequestWithUser): Promise<TrainingReviewUsage> {
    return this.reviews.usageOf(req.user.id);
  }

  /** Stores nothing: the review is handed back and kept by no one. */
  @Post()
  @HttpCode(200)
  @RequiresEntitlement("TRAINING_REVIEW")
  @Throttle({ long: { limit: 6, ttl: 60_000 } })
  create(
    @Request() req: RequestWithUser,
    @Body() body: CreateTrainingReviewDto,
  ): Promise<TrainingReviewResult> {
    return this.reviews.create(req.user.id, body);
  }
}
