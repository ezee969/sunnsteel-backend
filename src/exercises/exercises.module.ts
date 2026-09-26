import { Module } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ExerciseStarsService } from './exercise-stars.service';
import { ExercisesController } from './exercises.controller';
import { CustomExercisesService } from './custom-exercises.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ExercisesController],
  providers: [ExercisesService, ExerciseStarsService, CustomExercisesService],
  exports: [ExercisesService, CustomExercisesService],
})
export class ExercisesModule {}
