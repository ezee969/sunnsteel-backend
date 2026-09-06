import { IsBoolean, IsOptional, IsTimeZone } from 'class-validator';
import { SetAccountTimeZoneRequest } from '@sunsteel/contracts';

export class SetAccountTimeZoneDto implements SetAccountTimeZoneRequest {
  @IsTimeZone()
  timeZone!: string;

  @IsOptional()
  @IsBoolean()
  onlyIfUnset?: boolean;
}
