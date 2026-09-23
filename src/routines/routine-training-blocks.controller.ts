import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import type { RequestWithUser } from "../common/types/request-with-user";
import { UpsertRoutineTrainingBlockDto } from "./dto/upsert-routine-training-block.dto";
import { RoutineTrainingBlocksService } from "./routine-training-blocks.service";

/** ROUT-09: author and inspect the immutable dated setups of one routine. */
@UseGuards(SupabaseJwtGuard)
@Controller("routines/:id/training-blocks")
export class RoutineTrainingBlocksController {
  constructor(private readonly blocks: RoutineTrainingBlocksService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Param("id") routineId: string) {
    return this.blocks.list(req.user.id, routineId);
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Param("id") routineId: string,
    @Body() dto: UpsertRoutineTrainingBlockDto,
  ) {
    return this.blocks.create(req.user.id, routineId, dto);
  }

  @Put(":blockId")
  update(
    @Req() req: RequestWithUser,
    @Param("id") routineId: string,
    @Param("blockId") blockId: string,
    @Body() dto: UpsertRoutineTrainingBlockDto,
  ) {
    return this.blocks.update(req.user.id, routineId, blockId, dto);
  }

  @Get(":blockId/revisions")
  revisions(
    @Req() req: RequestWithUser,
    @Param("id") routineId: string,
    @Param("blockId") blockId: string,
  ) {
    return this.blocks.revisions(req.user.id, routineId, blockId);
  }

  @Delete(":blockId")
  @HttpCode(204)
  async remove(
    @Req() req: RequestWithUser,
    @Param("id") routineId: string,
    @Param("blockId") blockId: string,
  ) {
    await this.blocks.remove(req.user.id, routineId, blockId);
  }
}
