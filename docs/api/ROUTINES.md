# Routines API

Comprehensive reference for routine creation, update, and time-based programmed RtF scheduling.

## Overview

- A routine has multiple `days`, and each `day` has multiple `exercises`.
- Progression is configured per exercise via `progressionScheme`.
- A routine is considered time-driven when at least one exercise uses `PROGRAMMED_RTF` and routine-level program fields are provided.
- Time-driven routines support forwarding to a later program week using `programStartWeek`.

## Time-Based Forwarding (programStartWeek)

- Field: `programStartWeek` (integer)
- Range: `1..21` when `programWithDeloads = true`, otherwise `1..18`.
- Server behavior:
  - Value is clamped to valid range.
  - Setting to `k` forwards the program such that the first active calendar week is week `k` of the canonical schedule.
  - `programEndDate` is calculated as the last day of the remaining window: `(weeks - (k - 1)) * 7 - 1` days from `programStartDate`.
  - Mixed progression types are supported; only PROGRAMMED_RTF exercises are affected by RtF scheduling.

## Create Routine

POST `/api/routines`

Body (excerpt):
```json
{
  "name": "My RtF Routine",
  "isPeriodized": false,
  "programWithDeloads": true,
  "programStartDate": "2025-10-06",
  "programTimezone": "America/New_York",
  "programStartWeek": 7,
  "days": [
    {
      "dayOfWeek": 1,
      "exercises": [
        {
          "exerciseId": "...",
          "progressionScheme": "PROGRAMMED_RTF",
          "programStyle": "STANDARD",
          "programTMKg": 100,
          "programRoundingKg": 2.5,
          "sets": [ { "setNumber": 1, "repType": "FIXED", "reps": 5 } ]
        },
        {
          "exerciseId": "...",
          "progressionScheme": "DYNAMIC_DOUBLE_PROGRESSION",
          "sets": [ { "setNumber": 1, "repType": "FIXED", "reps": 8 } ]
        }
      ]
    }
  ]
}
```

Validation rules:
- If any exercise is `PROGRAMMED_RTF`, the following are required: `programWithDeloads`, `programStartDate` (yyyy-mm-dd), `programTimezone` (IANA), first training day weekday must match `programStartDate`.
- `programStyle` is required per PROGRAMMED_RTF exercise.
- `programStartWeek` is optional; when omitted defaults to `1`.

Persistence (service):
- See `src/routines/routines.service.ts:create()` for validation and persistence.
- Program snapshot is recorded in `programRtfSnapshot`.

## Update Routine

PATCH `/api/routines/:id`

Behavior:
- When `days` is provided and at least one exercise is `PROGRAMMED_RTF`, program fields must be present and validated.
- If `programStartWeek` is provided, it is clamped and saved; `programEndDate` is recomputed from remaining weeks.
- If base inputs (`programStartDate`, `programWithDeloads`) remain unchanged and `programStartWeek` is omitted, existing `programStartWeek` and `programEndDate` are preserved.
- If base inputs change and `programStartWeek` is omitted, `programStartWeek` resets to `1` and `programEndDate` spans the full program.
- If `days` are removed or routine is no longer RtF, program fields are cleared.

Implementation details: `src/routines/routines.service.ts:update()`.

## Mixed Progression Support

- Only PROGRAMMED_RTF exercises use time-driven scheduling.
- Other schemes (`DYNAMIC_DOUBLE_PROGRESSION`, etc.) are unaffected by `programStartWeek`.

## Week Goals and Sessions

- `GET /api/workouts/routines/:id/rtf-week-goals?week=` uses global program week (1..18|21). When omitted, current week is derived against the forwarded schedule and then mapped back with the offset.
- `POST /api/workouts/sessions/start` attaches `program.currentWeek` as the global week index and respects `programStartWeek` for deload detection and goal selection.
- `PATCH /api/workouts/sessions/:id/finish` uses the offset-adjusted week for AMRAP-based TM adjustments.

Relevant code:
- `src/workouts/workouts.service.ts` (startSession, finishSession, getRtFWeekGoals)
- `src/workouts/rtf-schedules.ts` (canonical RtF schedules and snapshot builder)

## Error Responses

- 400 when `programStartDate` weekday does not match first training day.
- 400 when required program fields are missing for RtF routines.
- 400 when `week` is out of range on week goals endpoint.
- 404 when routine or routine day is not found.

## Notes

- `durationWeeks` in session response reflects the full canonical program length; `currentWeek` reflects the global program week considering any forwarding.
- Deload weeks are recognized based on the global week number.
