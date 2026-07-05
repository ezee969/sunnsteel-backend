import { Request } from 'express';

/**
 * Express request augmented with the authenticated user, as attached by
 * `SupabaseJwtGuard`/`SupabaseJwtStrategy`. Shared across controllers so the
 * shape is declared once.
 */
export type RequestWithUser = Request & {
  user: { id: string; email: string };
};
