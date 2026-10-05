import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  apiError,
  continueLinearPeriodization,
  type Routine,
} from "@sunsteel/contracts";

import { DatabaseService } from "../database/database.service";
import { lockTrainingAccount } from "../workouts/analytics/analytics-lock";
import { writeLinearSlot } from "../workouts/linear-block-advance";
import { ContinueLinearBlockDto } from "./dto/continue-linear-block.dto";
import { readLinearState } from "./linear-periodization";
import { RoutinesService } from "./routines.service";
import { syncFollowingWarmUps } from "./warm-up-follow";

/**
 * ROUT-19: a finished 8-week block waits for its member's choice -- the
 * optional recovery step, and the reference the next block starts from --
 * and nothing applies one without them. The slot may be the routine's own
 * exercise or a training block's or deload's working copy of it.
 */
@Injectable()
export class LinearBlocksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly routines: RoutinesService,
  ) {}

  async continueBlock(
    userId: string,
    routineId: string,
    routineExerciseId: string,
    dto: ContinueLinearBlockDto,
  ): Promise<Routine> {
    await this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      const slot = await tx.routineExercise.findFirst({
        where: {
          id: routineExerciseId,
          routineDay: { routineId, routine: { userId } },
        },
        select: {
          progressionScheme: true,
          minWeightIncrement: true,
          linearPeriodization: true,
          sets: { select: { setNumber: true, kind: true } },
        },
      });
      if (!slot) {
        throw new NotFoundException(apiError("ROUTINE_EXERCISE_NOT_FOUND"));
      }
      const state =
        slot.progressionScheme === "LINEAR_PERIODIZATION"
          ? readLinearState(slot.linearPeriodization)
          : null;
      if (!state) {
        throw new ConflictException(apiError("LINEAR_BLOCK_NOT_LINEAR"));
      }
      const next = continueLinearPeriodization(state, {
        referenceMaxKg: dto.referenceMaxKg,
        recovery: dto.recovery,
      });
      if (!next) {
        throw new ConflictException(apiError("LINEAR_BLOCK_NOT_FINISHED"));
      }
      await writeLinearSlot(tx, routineExerciseId, slot, next);
      await syncFollowingWarmUps(tx, userId, [routineExerciseId]);
    });
    return this.routines.findOne(userId, routineId);
  }
}
