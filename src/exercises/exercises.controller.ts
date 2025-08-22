import { Controller, Get, UseGuards } from '@nestjs/common';
import { Exercise } from '@prisma/client';
import { ExercisesService } from './exercises.service';
import { JwtAuthGuard } from '../auth/guards/passport-jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  async findAll(): Promise<Exercise[]> {
    return await this.exercisesService.findAll();
  }
}
