import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiUsageService } from "../ai/ai-usage";
import { BillingModule } from "../billing/billing.module";
import { DatabaseService } from "../database/database.service";
import {
  TRAINING_REVIEW_MODEL,
  trainingReviewModelFrom,
} from "./training-review-model";
import { TrainingReviewController } from "./training-review.controller";
import { TrainingReviewService } from "./training-review.service";

/** INTEL-04: the training review assistant. */
@Module({
  imports: [BillingModule],
  providers: [
    DatabaseService,
    AiUsageService,
    TrainingReviewService,
    {
      provide: TRAINING_REVIEW_MODEL,
      inject: [ConfigService],
      useFactory: trainingReviewModelFrom,
    },
  ],
  controllers: [TrainingReviewController],
})
export class TrainingReviewModule {}
