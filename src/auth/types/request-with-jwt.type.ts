import { Request } from 'express';
import { JwtPayload } from './jwt-payload.type';
import { AuthCookies } from './auth-cookies.type';

export interface RequestWithJwt extends Request {
  user: JwtPayload;
  cookies: AuthCookies;
}
