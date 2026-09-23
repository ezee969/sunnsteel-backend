import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UpdateSessionNotesResponse } from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { readSnapshot } from '../analytics/session-snapshot';
import { UpdateSessionNotesDto } from '../dto/update-session-notes.dto';
import {
  mergeExerciseNotes,
  normalizeSessionNote,
  readExerciseNotes,
} from '../session-notes';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * LIVE-16. Saves the owner's notes about one workout, during it or after it.
 * Notes feed nothing derived, so unlike a correction there is no window; a
 * discarded workout is refused because it is no longer part of the record.
 */
@Injectable()
export class WorkoutSessionNotesService {
  constructor(private readonly db: DatabaseService) {}

  async updateNotes(
    userId: string,
    sessionId: string,
    dto: UpdateSessionNotesDto,
  ): Promise<UpdateSessionNotesResponse> {
    return this.db.$transaction(async (tx) => {
      // Row lock, so two notes saved at once merge instead of racing.
      await tx.$queryRaw`SELECT "id" FROM "WorkoutSession" WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
      const session = await tx.workoutSession.findFirst({
        where: { id: sessionId, userId },
        select: {
          status: true,
          notes: true,
          exerciseNotes: true,
          snapshot: { select: { payload: true } },
          routineDay: { select: { exercises: { select: { id: true }, orderBy: { order: 'asc' } } } },
        },
      });
      if (!session) throw new NotFoundException('Workout session not found');
      if (session.status === 'ABORTED')
        throw new ConflictException('A discarded workout cannot take notes');

      const data: Prisma.WorkoutSessionUpdateInput = {};
      if (dto.notes !== undefined) data.notes = normalizeSessionNote(dto.notes);
      if (dto.exerciseNotes !== undefined) {
        // The snapshot is the day this workout trained; the live routine day
        // stands in only for a session that never had one.
        const slots = session.snapshot
          ? readSnapshot(session.snapshot.payload).routineDay.exercises.map(
              (exercise) => exercise.id,
            )
          : (session.routineDay?.exercises ?? []).map((exercise) => exercise.id);
        data.exerciseNotes = json(
          mergeExerciseNotes(
            readExerciseNotes(session.exerciseNotes),
            dto.exerciseNotes,
            slots,
          ),
        );
      }
      if (session.status === 'IN_PROGRESS') data.lastActivityAt = new Date();

      const saved = await tx.workoutSession.update({
        where: { id: sessionId },
        data,
        select: { notes: true, exerciseNotes: true },
      });
      return {
        notes: saved.notes,
        exerciseNotes: readExerciseNotes(saved.exerciseNotes),
      };
    });
  }
}
