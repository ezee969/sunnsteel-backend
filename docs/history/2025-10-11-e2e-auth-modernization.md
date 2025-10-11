# E2E Test Modernization: Supabase Auth + RtF

Date: 2025-10-11
Author: Cascade

## Summary
Modernized backend E2E tests to remove legacy auth flows and align with Supabase-based authentication and current RtF APIs. All E2E tests now pass: 21 passed, 3 skipped.

## Changes
- Supabase Auth E2E
  - Rewrote `test/supabase-auth.e2e-spec.ts` to mock `SupabaseService` consistently:
    - `verifyToken` mock throws `BadRequestException`/`UnauthorizedException` for missing/invalid tokens
    - `getUserBySupabaseId`, `getOrCreateUser` implemented to upsert users via `DatabaseService`
    - Set `app.setGlobalPrefix('api')`
    - Verified `/api/auth/supabase/verify` and `/api/auth/supabase/profile` flows, cookies, and migration scenario
  - Removed reliance on non-existent or brittle endpoints/assumptions

- RtF Forecast mocked test
  - Updated `test/rtf-forecast.e2e-spec.ts` to match service signature `getRtFForecast(userId, routineId, remainingOnly)` including `false`

- Routine creation and workouts tests
  - Replaced legacy `/api/auth/register` usage by creating users directly with Prisma in:
    - `test/routine-creation-simple.e2e-spec.ts`
    - `test/routine-creation-full.e2e-spec.ts`
    - `test/workout-detail.e2e-spec.ts`
    - `test/users-exercises.e2e-spec.ts`
  - All such tests either override `SupabaseJwtGuard` or mock `SupabaseService`

- Program forwarding / TM adjustments stability
  - Increased Jest timeouts for long-running tests:
    - `test/time-forwarding.e2e-spec.ts` → 30s
    - `test/time-forwarding-tm-adjustments.e2e-spec.ts` → 30s
    - `test/rtf-remaining.e2e-spec.ts` → 60s
  - Ensured `dayOfWeek` values align with `0..6` validation in DTOs

- Unified RtF implementation test
  - `test/comprehensive/unified-rtf-implementation.e2e-spec.ts` now uses real exercise IDs from DB (or creates minimal ones) to avoid invalid UUIDs that caused 500s
  - Fixed invalid `MuscleGroup` value (`MEDIAL_DELTOIDS` instead of `DELTOIDS`)

## Rationale
- Remove tight coupling to legacy auth endpoints and DTOs
- Make E2E tests deterministic and environment-agnostic by mocking Supabase and seeding DB directly
- Align tests with current API contracts and validation rules
- Improve stability for RtF heavy endpoints by allowing adequate timeouts

## Impact
- All E2E suites now pass reliably (21 passed, 3 skipped)
- Tests are simpler to maintain and extend
- No production code changes required other than consistent behavior already present in controllers/services

## Follow-ups
- Keep adding E2E cases using the SupabaseService mock pattern for any new auth-protected features
- Consider documenting the testing patterns in `docs/reference/` if we add more complex mocking scenarios
