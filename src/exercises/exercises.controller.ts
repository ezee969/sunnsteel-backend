import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Exercise, StarredExercisesResponse } from '@sunsteel/contracts';
import { ExercisesService } from './exercises.service';
import { ExerciseStarsService } from './exercise-stars.service';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';

@UseGuards(SupabaseJwtGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly exerciseStarsService: ExerciseStarsService,
  ) {}

  @Get()
  async findAll(): Promise<Exercise[]> {
    return await this.exercisesService.findAll();
  }

  @Get('starred')
  starred(@Req() req: RequestWithUser): Promise<StarredExercisesResponse> {
    return this.exerciseStarsService.list(req.user.id);
  }

  @Put(':id/star')
  star(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StarredExercisesResponse> {
    return this.exerciseStarsService.star(req.user.id, id);
  }

  @Delete(':id/star')
  unstar(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StarredExercisesResponse> {
    return this.exerciseStarsService.unstar(req.user.id, id);
  }
}
