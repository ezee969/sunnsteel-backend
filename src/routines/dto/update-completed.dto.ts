import { IsBoolean } from 'class-validator';

export class UpdateCompletedDto {
  @IsBoolean()
  isCompleted: boolean;
}
