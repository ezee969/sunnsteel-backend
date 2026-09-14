import { Module } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ExerciseStarsService } from './exercise-stars.service';
import { ExercisesController } from './exercises.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ExercisesController],
  providers: [ExercisesService, ExerciseStarsService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
