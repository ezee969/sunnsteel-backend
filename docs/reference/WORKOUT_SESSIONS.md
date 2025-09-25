# Workout Sessions Lifecycle & Invariants

## Single Active Session Invariant
At most one `IN_PROGRESS` workout session per user is allowed. Enforced by a **partial unique index** on `(userId)` where `status='IN_PROGRESS'` plus idempotent start logic.

## Start Semantics
`POST /api/workouts/sessions/start`
- Creates a new session when none active.
- If an active session exists, returns it with `reused: true` (HTTP 201 maintained for consistency).
- Response shape (subset):
```json
{
  "id": "sess-uuid",
  "status": "IN_PROGRESS",
  "reused": false,
  "program": { "currentWeek": 3, "withDeloads": true, ... },
  "rtfPlans": [ ... ]
}
```
When reused:
```json
{ "id": "sess-uuid", "status": "IN_PROGRESS", "reused": true }
```

## Auto-Expiration
Stale in-progress sessions are auto-marked `ABORTED` when their `startedAt` is older than `WORKOUT_SESSION_TIMEOUT_HOURS` (default 48h). A maintenance sweep runs every `WORKOUT_SESSION_SWEEP_INTERVAL_MIN` minutes (default 30) using `WorkoutMaintenanceService`.

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| WORKOUT_SESSION_TIMEOUT_HOURS | 48 | Hours after which an in-progress session is considered stale and auto-aborted |
| WORKOUT_SESSION_SWEEP_INTERVAL_MIN | 30 | Minutes between maintenance evaluation cycles |

## Frontend Behavior
- Start button becomes Resume if an active session belongs to that routine.
- Client call is idempotent: multiple rapid clicks or tab races resolve to the same session.
- A toast notification informs user when an existing session was resumed.

## Error Modes
| Scenario | Outcome |
|----------|---------|
| Duplicate start race | Existing session returned (`reused: true`) |
| Routine day mismatch with scheduled weekday | 400 Bad Request |
| Program not yet started / ended | 400 Bad Request |
| Nonexistent routine day | 404 Not Found |

## Future Considerations
- Add last activity tracking to tighten stale detection.
- Expose an admin endpoint to force-close sessions.
- Include expiration timestamp in response for UX hints.
