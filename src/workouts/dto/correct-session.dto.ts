import type {
  CorrectSessionRequest,
  CorrectSessionSetRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
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
  // LIVE-24: empty when only the end time is corrected; a request that
  // changes nothing is still refused by planSetCorrections.
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CorrectSessionSetDto)
  sets!: CorrectSessionSetDto[];

  @IsOptional()
  @IsISO8601({ strict: true })
  endedAt?: string;
}
