import { IsBoolean } from 'class-validator';

export class UpdateFavoriteDto {
  @IsBoolean()
  isFavorite!: boolean;
}
