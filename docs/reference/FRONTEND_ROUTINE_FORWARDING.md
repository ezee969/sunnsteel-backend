# Frontend Integration Guide — Routine Forwarding (programStartWeek)

This guide explains how the frontend should integrate with the backend "routine forwarding" feature for Programmed RtF (Reps-to-Failure) routines.

## Overview

- **What it is**: Start a calendar-driven RtF program from a later canonical week using `programStartWeek` (1..21 with deloads, 1..18 without).
- **Who it affects**: Only exercises with `progressionScheme: 'PROGRAMMED_RTF'`. Other schemes are unaffected.
- **Runtime mapping**: Backend maps calendar time → global program week using the offset from `programStartWeek`.

## Core Data Model

Routine-level fields used for RtF:
- `programWithDeloads: boolean`
- `programStartDate: yyyy-mm-dd` (must match weekday of the first training day)
- `programTimezone: IANA TZ`
- `programStartWeek?: number` (optional; default 1)
- `programDurationWeeks`: derived (21 with deloads, 18 without)

Exercise-level for RtF:
- `progressionScheme: 'PROGRAMMED_RTF'`
- `programStyle: 'STANDARD' | 'HYPERTROPHY'`
- `programTMKg`, `programRoundingKg` (optional, used for working weights)

## Primary Endpoints

### 1) Create Routine (with forwarding)
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
        }
      ]
    }
  ]
}
```

Validation (client-side hints):
- Require program fields only if any exercise uses `PROGRAMMED_RTF`.
- Ensure first training day weekday matches `programStartDate`.
- Clamp `programStartWeek` to valid range.

### 2) Update Routine (change forwarding)
PATCH `/api/routines/:id`

Behavior:
- If base inputs (`programStartDate`, `programWithDeloads`) unchanged and `programStartWeek` omitted: existing forwarding and end date preserved.
- If base inputs change and `programStartWeek` omitted: forwarding resets to 1.
- If `programStartWeek` provided: backend clamps and recalculates `programEndDate` from remaining weeks.

Example body:
```json
{
  "programWithDeloads": true,
  "programStartDate": "2025-10-06",
  "programTimezone": "America/New_York",
  "programStartWeek": 10,
  "days": [ /* full replacement */ ]
}
```

### 3) Start Session (uses mapping)
POST `/api/workouts/sessions/start`

- Body: `{ "routineId": "...", "routineDayId": "..." }`
- Response includes `program` block:
```json
{
  "program": {
    "currentWeek": 7,
    "durationWeeks": 21,
    "withDeloads": true,
    "isDeloadWeek": true,
    "startDate": "2025-10-06T00:00:00.000Z",
    "endDate": "2026-...",
    "timeZone": "America/New_York"
  },
  "rtfPlans": [ /* day plan for RtF exercises */ ]
}
```

Client should:
- Display `currentWeek` and label `isDeloadWeek` clearly.
- Enforce weekday: if backend returns 400 due to weekday mismatch, prompt user.

### 4) Week Goals (per week)
GET `/api/workouts/routines/:routineId/rtf-week-goals?week=<n>`

- Without `week`, backend resolves "current" week using offset mapping.
- With `week`, value is a global program week (1..18|21).
- Response includes working weights (rounded), deload info, and AMRAP set number.

Caching/ETag:
- ETag is enabled for these endpoints. Send `If-None-Match` on subsequent requests to reduce payloads.

### 5) Upsert AMRAP Log and Finish Session (TM adjustments)
- Upsert log: `PUT /api/workouts/sessions/:id/set-logs`
```json
{
  "routineExerciseId": "...",
  "exerciseId": "...",
  "setNumber": 5,
  "reps": 12,
  "isCompleted": true
}
```
- Finish: `PATCH /api/workouts/sessions/:id/finish` with `{ "status": "COMPLETED" }`

Rules:
- TM adjustment is applied only on non-deload weeks.
- AMRAP set index: `5` for `STANDARD`, `4` for `HYPERTROPHY`.
- One adjustment per exercise per week (`programLastAdjustedWeek` guard).

## UI/UX Recommendations

- **Week display**: show `currentWeek / durationWeeks`, and clearly flag deload weeks.
- **Forwarding control**: allow user to set `programStartWeek` on create/edit. Disable invalid values.
- **Start constraints**: only enable "Start" on scheduled weekdays and within start/end date window; handle 400s with user-friendly messages.
- **AMRAP guidance**: show AMRAP target on the scheduled set; on deload weeks, hide/disable TM-adjust expectations.
- **Updating forwarding**: when changing `programStartWeek`, reflect new end date in UI.

## Error States to Handle

- 400: `programStartDate` weekday mismatch with first training day
- 400: Missing program fields when RtF is present
- 400: Week out of range on week-goals
- 404: Routine or routine day not found

## Quick Sequence Examples

1) Create → Start → Render Goals
- Create routine with `programStartWeek`.
- Start session and read `program.currentWeek`.
- GET week goals for that week to show intensities and AMRAP target.

2) Forward Later in Program
- PATCH routine with `programStartWeek: 10` (same base inputs) → end date shifts.
- Start session shows `currentWeek=10`; week-goals reflect week 10 program.

## Timeline/Forecast: Remaining-Only Usage

Use the optional `remaining=1` (or `remaining=true`) query parameter on timeline
and forecast endpoints to return only the remaining portion of a forwarded
program starting at `programStartWeek`.

- Timeline (remaining only):
  - `GET /api/workouts/routines/:routineId/rtf-timeline?remaining=1`
- Forecast (remaining only):
  - `GET /api/workouts/routines/:routineId/rtf-forecast?remaining=1`

Response will include a `fromWeek` field indicating the first global week in the
returned slice. Without `remaining`, endpoints return the canonical full range
(`1..N`).

### Example (fetch)

```ts
// All weeks (canonical): fromWeek is 1
const tlAll = await fetch(`/api/workouts/routines/${id}/rtf-timeline`, {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// Remaining only: fromWeek equals routine.programStartWeek
const tlRem = await fetch(`/api/workouts/routines/${id}/rtf-timeline?remaining=1`, {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// Forecast remaining only
const fcRem = await fetch(`/api/workouts/routines/${id}/rtf-forecast?remaining=1`, {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// UI
// - Display tlRem.fromWeek as the starting week label
// - Render tlRem.timeline items from week=fromWeek to durationWeeks
// - Same for fcRem.forecast, using fcRem.fromWeek
```

## Related Docs
- `docs/api/ROUTINES.md` — API details and server behavior
- `docs/reference/WORKOUT_SESSIONS.md` — Session lifecycle
