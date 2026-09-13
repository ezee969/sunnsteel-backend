import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
} from 'class-validator';
import { SESSION_SHARE_FIELDS, SessionShareField } from '@sunsteel/contracts';

export class CreateSessionShareDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(SESSION_SHARE_FIELDS.length)
  @IsIn([...SESSION_SHARE_FIELDS], { each: true })
  fields: SessionShareField[];
}
