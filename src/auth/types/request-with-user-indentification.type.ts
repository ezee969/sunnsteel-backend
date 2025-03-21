import { Request } from 'express';
import { UserIdentification } from './user-identification.type';

export interface RequestWithUserIdentification extends Request {
  user: UserIdentification;
}
