# 2026-01-18 — TM Adjustment DTO typed constants fix

## Summary

- Replaced direct destructuring of `TM_ADJUSTMENT_CONSTANTS` with a typed helper to satisfy ESLint's "unsafe assignment of an error typed value" rule.
- Ensured the `@Min` validator for `weekNumber` references a correctly named guard (min versus max) to avoid confusion.

## Rationale

- ESLint flagged destructuring the contracts constant because the imported value was treated as "error typed" in this context, which then propagated into `no-unsafe-assignment` and `no-unsafe-argument` warnings (especially inside decorators).
- Introducing an explicit `TmAdjustmentLimits` shape and casting `TM_ADJUSTMENT_CONSTANTS` from `unknown` to that shape produces plain `number` values for the validator decorators, eliminating the lint error without changing runtime behavior.

## Testing

- ESLint warning cleared locally via type-only change; no runtime impact expected.

---

## 2026-01-18 17:39 UTC+01 follow-up

- The DTO now derives its guard values from an explicit `TmAdjustmentLimits` shape
  and casts `TM_ADJUSTMENT_CONSTANTS` from `unknown` to that shape so both the
  intermediate constant and each destructured field avoid typescript-eslint's
  `no-unsafe-assignment` rule.
- This keeps decorator helpers (e.g., `@Min(minWeekGuard)`) strictly typed while
  preventing future regressions if `TM_ADJUSTMENT_CONSTANTS` evolves.

## 2026-01-18 20:44 UTC+01 contracts follow-up

- Published `@sunsteel/contracts@0.2.1` and updated backend/frontend dependencies.
- Added `PROGRAMMED_RTF_HYPERTROPHY` to shared `PROGRESSION_SCHEMES` / `ProgressionScheme`
  to match the backend Prisma schema and frontend usage.
- Confirmed:
  - Backend `npm run build` succeeds
  - Frontend `npm run build` succeeds (type mismatch resolved)
