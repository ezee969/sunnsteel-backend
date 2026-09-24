import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import type { RequestWithUser } from "../common/types/request-with-user";
import { WorkoutBlockComparisonService } from "./workout-block-comparison.service";

/**
 * PROG-11 lives with the workouts it reads, but its route sits under the
 * routine it belongs to, beside the routine's own training-block routes.
 */
@UseGuards(SupabaseJwtGuard)
@Controller("routines")
export class TrainingBlockComparisonController {
  constructor(private readonly comparisons: WorkoutBlockComparisonService) {}

  @Get(":id/training-blocks/:seriesId/comparison")
  async compare(
    @Req() req: RequestWithUser,
    @Param("id") routineId: string,
    @Param("seriesId") seriesId: string,
  ) {
    return this.comparisons.compare(req.user.id, routineId, seriesId);
  }
}
