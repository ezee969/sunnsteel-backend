import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Exercise } from '@prisma/client';

@Injectable()
export class ExercisesService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Exercise[]> {
    const exercises = await this.db.exercise.findMany({
      orderBy: { name: 'asc' },
    });
    return exercises;
  }
}
