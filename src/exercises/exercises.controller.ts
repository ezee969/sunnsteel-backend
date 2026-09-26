import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  CustomExerciseInput,
  Exercise,
  StarredExercisesResponse,
} from '@sunsteel/contracts';
import { ExercisesService } from './exercises.service';
import { ExerciseStarsService } from './exercise-stars.service';
import { CustomExercisesService } from './custom-exercises.service';
import {
  CreateCustomExerciseDto,
  UpdateCustomExerciseDto,
} from './dto/custom-exercise.dto';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';

@UseGuards(SupabaseJwtGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly exerciseStarsService: ExerciseStarsService,
    private readonly customExercises: CustomExercisesService,
  ) {}

  @Get()
  async findAll(@Req() req: RequestWithUser): Promise<Exercise[]> {
    return await this.exercisesService.findAll(req.user.id);
  }

  // EXER-06: the caller's own exercises.
  @Post('custom')
  createCustom(
    @Req() req: RequestWithUser,
    @Body() dto: CreateCustomExerciseDto,
  ): Promise<Exercise> {
    return this.customExercises.create(req.user.id, {
      name: dto.name ?? '',
      primaryMuscles: dto.primaryMuscles ?? [],
      secondaryMuscles: dto.secondaryMuscles ?? [],
      equipmentRequired: dto.equipmentRequired ?? [],
      movementPattern: dto.movementPattern ?? null,
      mechanic: dto.mechanic ?? null,
      note: dto.note ?? null,
    } satisfies CustomExerciseInput);
  }

  @Patch('custom/:id')
  updateCustom(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomExerciseDto,
  ): Promise<Exercise> {
    return this.customExercises.update(req.user.id, id, dto);
  }

  @Post('custom/:id/archive')
  @HttpCode(200)
  archiveCustom(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Exercise> {
    return this.customExercises.setArchived(req.user.id, id, true);
  }

  @Post('custom/:id/restore')
  @HttpCode(200)
  restoreCustom(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Exercise> {
    return this.customExercises.setArchived(req.user.id, id, false);
  }

  @Delete('custom/:id')
  @HttpCode(204)
  async removeCustom(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.customExercises.remove(req.user.id, id);
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
