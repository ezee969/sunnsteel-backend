import type { UpdateSessionNotesRequest } from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// LIVE-16. Types only; the lengths are enforced, and stated, in session-notes.ts.
class SessionExerciseNoteDto {
  @IsString()
  @IsNotEmpty()
  routineExerciseId!: string;

  @IsOptional()
  @IsString()
  note!: string | null;
}

export class UpdateSessionNotesDto implements UpdateSessionNotesRequest {
  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SessionExerciseNoteDto)
  exerciseNotes?: SessionExerciseNoteDto[];
}
