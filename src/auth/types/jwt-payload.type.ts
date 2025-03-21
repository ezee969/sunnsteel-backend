export type JwtPayload = {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
};
