# Time-Based Forwarding for RtF Programs

Date: 2025-10-11
Owner: Backend Team

## Summary
- Implemented time-based routine forwarding using `programStartWeek`.
- Applied across create, update, and runtime (sessions and RtF week-goals).
- Added E2E tests to validate deload mapping and update flow.

## Changes
- Service updates:
  - `src/routines/routines.service.ts`
    - Persist `programStartWeek` on update.
    - Recompute `programEndDate` based on remaining weeks.
    - Preserve/reset `programStartWeek` depending on base inputs.
  - `src/workouts/workouts.service.ts`
    - Honor `programStartWeek` when computing current week for:
      - `startSession()`
      - `finishSession()`
      - `getRtFWeekGoals()`
    - Deload detection uses global week after offset mapping.
- Documentation:
  - `docs/api/ROUTINES.md` – Added forwarding behavior and request fields.
- Tests:
  - `test/time-forwarding.e2e-spec.ts` – Validates week 7 deload after forwarding; validates update flow.

## Rationale
- Users require the ability to begin programs at later weeks (e.g., resuming or skipping early phases).
- Forwarding must only affect time-driven exercises (PROGRAMMED_RTF), not other progression types.

## Impact
- API remains backward compatible:
  - `programStartWeek` is optional and defaults to `1`.
  - `durationWeeks` in responses reflects canonical program length; `currentWeek` reflects the global index after forwarding.

## Follow-ups
- Extend tests to cover TM adjustments on deload vs non-deload weeks. (DONE)
- Consider adding a small note to `docs/features/PROGRESSION_SCHEMES.md` referencing `programStartWeek`.

## Update (same day)

- Added E2E tests for TM adjustments on forwarded weeks:
  - `test/time-forwarding-tm-adjustments.e2e-spec.ts`
  - Validates no TM change on deload week even with high AMRAP.
  - Validates TM increases on non-deload week when AMRAP ≥ target.
  - Both tests passed locally.
