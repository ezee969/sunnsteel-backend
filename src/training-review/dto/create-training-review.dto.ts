import { ArrayMaxSize, IsArray, IsIn, IsUUID } from "class-validator";
import {
  SUPPORTED_LOCALES,
  TRAINING_REVIEW_QUESTIONS,
  type AppLocale,
  type CreateTrainingReviewRequest,
  type TrainingReviewQuestion,
} from "@sunsteel/contracts";

/**
 * The size of the selection is the service's to refuse, with its code; here
 * only a list far past any review is cut off before it is read.
 */
export class CreateTrainingReviewDto implements CreateTrainingReviewRequest {
  @IsIn(TRAINING_REVIEW_QUESTIONS)
  question: TrainingReviewQuestion;

  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID("all", { each: true })
  sessionIds: string[];

  @IsIn(SUPPORTED_LOCALES)
  locale: AppLocale;
}
