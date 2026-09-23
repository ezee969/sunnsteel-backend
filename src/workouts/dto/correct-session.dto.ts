import type {
  CorrectSessionRequest,
  CorrectSessionSetRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';

// LIVE-17. Types only here; the bounds live in session-correction-rules.ts,
// which also applies them, so the two cannot disagree.
class CorrectSessionSetDto implements CorrectSessionSetRequest {
  @IsString()
  @IsNotEmpty()
  setLogId!: string;

  @IsOptional()
  @IsNumber()
  weight!: number | null;

  @IsOptional()
  @IsNumber()
  reps!: number | null;

  @IsOptional()
  @IsNumber()
  rpe!: number | null;

  @IsBoolean()
  isCompleted!: boolean;
}

export class CorrectSessionDto implements CorrectSessionRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CorrectSessionSetDto)
  sets!: CorrectSessionSetDto[];
}
