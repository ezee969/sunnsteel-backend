/**
 * A member's text taken literally inside SQL `LIKE`/`ILIKE`. Prisma's
 * `contains` puts its value between two `%` without escaping it, so a search
 * for "50%" or "a_b" would otherwise match far more than it says (NAV-01
 * found it: `_a` listed every member). Backslash is PostgreSQL's default
 * `LIKE` escape, so the escaped value works in `contains` as it is, and a raw
 * statement that writes `ESCAPE '\'` means the same.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
