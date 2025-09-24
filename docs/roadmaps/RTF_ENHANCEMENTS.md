# RTF Enhancements Roadmap

Authoritative tracker for Reps-to-Failure (RtF) backend enhancements.

## Legend
Status: Done | In Progress | Planned | Deferred

## Summary Table
Task | Area | Status | Notes
-----|------|--------|------
RTF-B01 | Caching week goals | Done | In-memory TTL map (env: RTF_WEEK_GOAL_TTL_SEC)
RTF-B02 | Routine include=rtfGoals | Done | `GET /routines/:id?include=rtfGoals`
RTF-B03 | Timeline endpoint | Done | `/workouts/routines/:id/rtf-timeline`
RTF-B04 | External cache abstraction | Done | In-memory + Redis driver (+ async adapter) implemented
RTF-B05 | Week goal shape versioning | Done | version=1 field live (week, timeline, forecast)
RTF-B06 | Forecast endpoint | Done | `/workouts/routines/:id/rtf-forecast` cached + stampede protection
RTF-B07 | Telemetry hooks | Done | Prometheus exporter, hit rates, TM adjustment metrics, /metrics endpoint with IP allowlist
RTF-B08 | Anomaly guardrails | Done | TM adjustment delta %, absolute cap & reason length guardrails
RTF-B09 | Snapshotting week goals | Done | Stored JSON snapshot at routine create/update (`programRtfSnapshot`)
RTF-B10 | Cache layering | Done | L1 memory (short TTL) + L2 Redis (configurable)
RTF-B11 | Expanded tests | In Progress | Added variant, timeline, cache invalidation, deterministic forecast tests (additional 304 tests pending)
RTF-B12 | ETag / Conditional GET | Done | Strong ETag on week goals, timeline, forecast (excludes _cache)
RTF-B13 | Forecast tests | In Progress | Deterministic projection tests added; add conditional 304 & snapshot parity diff remaining

## Completed Detail
### RTF-B01 Caching
- Simple Map with expiry per key `weekGoals:routineId:week`
- Cache result annotated `_cache: HIT|MISS`
- Sets TTL default 600s (configurable)

### RTF-B02 Routine Enrichment
- Added optional inclusion param `include=rtfGoals&week=#`
- Injects `rtfGoals` object into routine payload when requested
- Reuses `WorkoutsService.getRtFWeekGoals`

## In Progress
### RTF-B07 Telemetry Hooks
- Implemented metrics counters (hits, misses, sets, deletes, invalidations, uptime, layered breakdown)
- Exposed via `/internal/cache-metrics` endpoint
- TODO: Prometheus format exporter, variant usage counters, forecast cache stats aggregation

### RTF-B11 Expanded Tests
- Added e2e specs: variant week goals, timeline aggregation, cache invalidation, mixed variant routine creation, hypertrophy TM adjustment, layered sets mock
- TODO: Forecast deterministic tests, 304 conditional GET verification, deload week hypertrophy vs standard assertions inside forecast

## Design Notes
- Variant differentiation (STANDARD vs HYPERTROPHY) already present.
- Deload weeks preserved; potential variant-specific future adjustments
  should bump a `version` field (B05).
- Forecasting (B06) to use recent TM adjustments + AMRAP performance.

## Risk & Mitigation
Risk | Mitigation
-----|-----------
Cache staleness after TM adjustment | Invalidate routine’s week keys on TM event creation (future)
Forecast misprediction credibility | Include confidence band & explicit assumptions
Stampede on timeline | Batch synthesize after B05; add in-flight promise map

## Test Strategy Additions (B11)
- Timeline endpoint correctness (weeks count, deload flags)
- Cache hit ratio behaviour on consecutive timeline calls
- Mixed variant routine outputs stable across calls

## Telemetry (B07) Fields (Planned)
Field | Description
------|------------
rtf.weekGoals.cache.hit | Increment per HIT
rtf.weekGoals.cache.miss | Increment per MISS
rtf.variant.standard.count | Exercises standard variant observed
rtf.variant.hypertrophy.count | Exercises hypertrophy variant observed

## Changelog
Date | Change
-----|-------
2025-09-23 | Initial roadmap extracted; B01-B02 marked done; B03 started
2025-09-23 | B03 completed; B04 Phase 1 (in-memory abstraction) started
2025-09-23 | B04 invalidation added; B05 version=1 live & tested
2025-09-24 | B04 singleton CacheModule added; invalidation e2e passing
2025-09-24 | B06 forecast endpoint added with caching & stampede protection
2025-09-24 | B08 guardrails (TM adjustment bounds) implemented
2025-09-24 | B10 layered cache (L1+L2) implemented + metrics
2025-09-24 | B12 ETag interceptor implemented (week goals, timeline, forecast)
2025-09-24 | Added multiple RtF e2e tests (variants, timeline, cache invalidation)
2025-09-24 | Telemetry metrics endpoint + Prometheus exporter (B07 incremental)
2025-09-24 | B09 snapshot integrated; forecast now snapshot-aware
2025-09-24 | Deterministic forecast tests added (B13 phase 1)

