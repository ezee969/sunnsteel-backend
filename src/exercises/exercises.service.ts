import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Exercise } from '@prisma/client';

@Injectable()
export class ExercisesService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Exercise[]> {
    // Fetch then sort with a deterministic, locale-aware comparator to avoid
    // environment-dependent DB collation differences (CI vs local).
    const exercises = await this.db.exercise.findMany();
    const collator = new Intl.Collator('en', {
      sensitivity: 'base',
      ignorePunctuation: true,
    });
    return exercises.sort((a, b) => collator.compare(a.name, b.name));
  }
}
