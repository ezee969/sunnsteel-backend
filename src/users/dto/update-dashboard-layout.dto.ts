import {
  DASHBOARD_SECTION_IDS,
  type DashboardLayoutEntry,
  type DashboardSectionId,
  type UpdateDashboardLayoutRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';

class DashboardLayoutEntryDto implements DashboardLayoutEntry {
  @IsIn(DASHBOARD_SECTION_IDS)
  id!: DashboardSectionId;

  @IsBoolean()
  hidden!: boolean;
}

/** DASH-05. Repeats and missing sections are resolved by the normalizer. */
export class UpdateDashboardLayoutDto implements UpdateDashboardLayoutRequest {
  @IsArray()
  @ArrayMaxSize(DASHBOARD_SECTION_IDS.length)
  @ValidateNested({ each: true })
  @Type(() => DashboardLayoutEntryDto)
  sections!: DashboardLayoutEntryDto[];
}
