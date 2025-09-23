# Backend Improvement & Programmed RtF Roadmap

This document complements the frontend `IMPROVEMENTS.md`, focusing on server
(domain, persistence, API, and observability) concerns for Programmed RtF and
related platform hardening.

---
## 1. Current State Summary
- `programStyle` field added to `Routine` (nullable) with enum `ProgramStyle`.
- Create routine endpoint persists `programStyle` when progressionScheme is
  `PROGRAMMED_RTF`.
- No update endpoint support yet for modifying `programStyle`.
- No persistence of TM adjustment / progression analytics (client-only parsing).
- Migration pending until `DATABASE_URL` is available (Prisma error P1012 encountered).

---
## 2. Immediate Post-Migration Tasks
- [ ] Configure `DATABASE_URL` locally (Neon / Postgres / Supabase).
- [ ] Run migration: `npx prisma migrate dev --name add_program_style`.
- [ ] Run `npx prisma generate` to ensure types align.
- [ ] Smoke test create routine request including `programStyle`.
- [ ] Add `programStyle` to routine list/detail serializers (if any custom mappers).
- [ ] Confirm null styles deserialize as STANDARD at service layer (implicit fallback).

---
## 3. Update & Validation Enhancements
- [ ] Extend UpdateRoutine DTO to allow optional `programStyle` change.
- [ ] Service: only apply `programStyle` when `progressionScheme === PROGRAMMED_RTF`.
- [ ] Add guard: if scheme changes away from PROGRAMMED_RTF → set `programStyle = null`.
- [ ] Add unit tests for transitions: (a) STANDARD->HYPERTROPHY, (b) HYPO→STANDARD, (c) scheme removal.
- [ ] Prisma-level constraint (manual): none required (business rule enforced in service).

---
## 4. TM Adjustment Persistence (New Feature)
Purpose: enable longitudinal analytics & UI sparklines.

### 4.1 Schema Draft
```prisma
model TmAdjustment {
  id          String   @id @default(cuid())
  routineId   String
  exerciseId  String
  weekNumber  Int
  deltaKg     Decimal  @db.Numeric(6,2)
  preTmKg     Decimal  @db.Numeric(6,2)
  postTmKg    Decimal  @db.Numeric(6,2)
  reason      String?  @db.VarChar(160)
  style       ProgramStyle? // snapshot for historical context
  createdAt   DateTime @default(now())

  routine     Routine  @relation(fields: [routineId], references: [id])

  @@index([routineId, exerciseId, createdAt])
  @@index([routineId, weekNumber])
}
```

### 4.2 API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/routines/:id/tm-events` | Create single adjustment |
| GET | `/routines/:id/tm-events` | List adjustments (filter by exercise, week range) |
| GET | `/routines/:id/tm-events/summary` | Aggregate stats (net delta, avg per week, last change) |

### 4.3 DTOs
```ts
export class CreateTmEventDto {
  @IsString() @IsNotEmpty() exerciseId: string
  @IsInt() @Min(1) weekNumber: number
  @IsNumber() deltaKg: number
  @IsNumber() preTmKg: number
  @IsNumber() postTmKg: number
  @IsOptional() @IsString() @MaxLength(160) reason?: string
}
```
Add validation pipe + transformation (numeric).

### 4.4 Service Logic
- Validate routine ownership (same auth guard as routine update).
- Confirm `progressionScheme === PROGRAMMED_RTF` before accepting events.
- Optional integrity check: `preTmKg + deltaKg === postTmKg` within epsilon.

### 4.5 Aggregation Query Sketch
```
SELECT
  exercise_id,
  COUNT(*) AS events,
  SUM(delta_kg) AS net_delta,
  AVG(delta_kg) AS avg_change,
  MAX(created_at) AS last_event_at
FROM tm_adjustment
WHERE routine_id = $1
GROUP BY exercise_id;
```
Wrap in Prisma using `groupBy` (fallback raw SQL if precision needed).

---
## 5. Security & Access Control
- [ ] Reuse existing auth guard (Supabase JWT validation) on new endpoints.
- [ ] Ownership check: routine.userId === requestUserId.
- [ ] Rate limit POST events (e.g., simple in-memory token bucket or Redis when available).
- [ ] Sanitize `reason` (strip control characters) before persistence.

---
## 6. Observability
- [ ] Structured log when TM event created `{ routineId, exerciseId, deltaKg, week }`.
- [ ] Warning log if absolute delta > configured threshold (e.g., 10% TM).
- [ ] Health endpoint addition: counts of routines by style & total TM events.
- [ ] Optional metrics export (Prometheus) if infra available.

---
## 7. Error Handling Patterns
- Use consistent error shape: `{ statusCode, message, error }`.
- Map Prisma errors (FK violation, not found) to 404 / 400.
- Custom exceptions: `RoutineOwnershipException`, `InvalidProgramStyleException`.

---
## 8. Testing Strategy
| Layer | Focus |
|-------|-------|
| Unit | Service style transitions; TM event validation logic |
| Integration | Create + fetch adjustments cycle |
| E2E | Routine creation (both styles), TM event posting, summary endpoint |
| Regression | Null style routines unaffected by new logic |

Add factories / builders for routine + adjustment seeds.

---
## 9. Performance Considerations
- Indexes in schema (see model) to keep per-routine queries sub-millisecond at scale O(1k events).
- Batch insertion endpoint (future) if clients submit multiple events offline.
- Avoid N+1: fetch adjustments aggregated by exercise in one query.

---
## 10. Configuration & Flags
| Env Var | Purpose | Default |
|---------|---------|---------|
| ENABLE_TM_EVENTS | Toggle TM event endpoints | false |
| MAX_TM_EVENT_DELTA_KG | Alert threshold for deltaKg | 15 |

Document in `ENVIRONMENT_VARIABLES.md` when introduced.

---
## 11. Rollout Plan
1. Ship migration + update endpoint support (read/write style only).
2. Add TM event schema + guarded POST endpoint behind feature flag.
3. Add GET + summary endpoints.
4. Integrate frontend sparkline; monitor usage.
5. Enable feature flag by default after validation.

---
## 12. Rollback Strategy
- Disable TM events via `ENABLE_TM_EVENTS=false` (endpoints return 404/disabled message).
- Leave schema/table (harmless, additive).
- Remove summary aggregation calls from controller.

---
## 13. Open Questions
- Should TM adjustments be idempotent per (exerciseId, weekNumber)? (If yes: upsert instead of insert.)
- Enforce monotonic week progression or allow retroactive edits?
- Need soft delete of events? (Probably not initially.)

---
## 14. Acceptance Criteria Snapshot
| Area | Criteria |
|------|----------|
| Migration | `programStyle` persisted; null treated as STANDARD |
| Update API | Can modify style safely; scheme change clears style |
| TM Events | POST validates + persists; GET returns structured list |
| Security | Ownership enforced; invalid style rejected |
| Observability | Logs & health counts available |
| Tests | Coverage over transitions & event lifecycle |

---
## 15. Future Extensions (Beyond Scope)
- Mixed per-exercise style overrides.
- Auto TM suggestion engine service (background recompute).
- Adaptive deload scheduling (data-driven fatigue model).
- Export routine + TM trend as PDF / CSV.
- Webhook events for TM changes (3rd party integrations).

---
## 16. Action Checklist (Condensed)
- [ ] Run migration & test create
- [ ] Add update DTO + service changes
- [ ] Add TM event schema + flag
- [ ] Implement POST / GET / summary
- [ ] Add guards + rate limiting
- [ ] Write unit + integration tests
- [ ] Document env vars & endpoints
- [ ] Enable feature after verification

---
_Last updated: pending migration execution._
