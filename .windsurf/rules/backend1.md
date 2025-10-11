---
trigger: always_on
---

# Sunnsteel Backend - Part 1 - Fitness API

This is the backend project for Sunnsteel, a comprehensive fitness and training API with advanced workout management, progression tracking, and Training Max (TM) adjustments.

## Mandatory Post-Task Documentation
All relevant code changes must be documented immediately after each task is completed. Update the `docs/` hierarchy (features, API, services, schema, environment, reference, roadmaps/history) to reflect behavior, interfaces, and rationale. Do not mark a task complete until the documentation updates are added.

## Technology Stack

- **Framework**: NestJS v10.4.15 (Node.js/TypeScript)
- **Database**: PostgreSQL with Prisma ORM v6.4.0
- **Authentication**: Dual authentication system:
  - Supabase Auth integration (primary)
- **Validation**: class-validator v0.14.1 and class-transformer v0.5.1
- **Security**: bcrypt v5.1.1, throttling with @nestjs/throttler v6.4.0
- **Caching**: Redis v4.6.13 with layered cache architecture
- **Monitoring**: Prometheus metrics with prom-client v15.1.3
- **Development port**: 4000 (configurable via PORT env var)

## Project Structure

### Core Modules

- **AuthModule**: Dual authentication system (JWT + Supabase)
- **UsersModule**: User and profile management
- **TokenModule**: JWT and refresh token services
- **DatabaseModule**: Prisma configuration and PostgreSQL connection
- **ExercisesModule**: Exercise catalog with deterministic sorting
- **RoutinesModule**: Advanced routine management with RtF programs
- **WorkoutsModule**: Training sessions with progression tracking
- **WorkoutMaintenanceService**: Background service for session auto-expiration and cleanup
- **CacheModule**: Redis-based caching for RtF week goals
- **MetricsModule**: Prometheus metrics collection

### Available Endpoints

#### Authentication

- **POST /api/auth/logout**: User logout with token blacklisting
- **POST /api/auth/refresh**: Token refresh
- **POST /api/auth/google**: Google Sign-In via ID token
- **POST /api/auth/supabase/verify**: Supabase token verification (primary)

#### Users

- **GET /api/users/profile**: Get user profile (protected by SupabaseJwtGuard)

#### Exercises

- **GET /api/exercises**: List available exercises (protected by SupabaseJwtGuard)
  - Returns deterministic, locale-aware sorted exercise catalog

#### Routines

- **GET /api/routines**: List user routines with advanced filtering
  - Query params: `isFavorite=true|false`, `isCompleted=true|false`
- **GET /api/routines/favorites**: List favorite routines
- **GET /api/routines/completed**: List completed routines
- **GET /api/routines/:id**: Get routine by id with full details
- **POST /api/routines**: Create routine (supports RtF programs)
- **PATCH /api/routines/:id**: Update routine (complete replacement)
- **PATCH /api/routines/:id/favorite**: Toggle favorite status
- **PATCH /api/routines/:id/completed**: Toggle completion status
- **DELETE /api/routines/:id**: Delete routine

#### Training Max (TM) Adjustments

- **POST /api/routines/:id/tm-events**: Create TM adjustment event
- **GET /api/routines/:id/tm-events**: Get TM adjustment history
  - Query params: `exerciseId?` for filtering
- **GET /api/routines/:id/tm-events/summary**: Get TM adjustment summary statistics

#### Workout Sessions

- **GET /api/workouts/sessions**: List sessions with advanced filtering
  - Query params: `status`, `routineId`, `from`, `to`, `q`, `cursor`, `limit`, `sort`
- **POST /api/workouts/sessions/start**: Start new training session (idempotent)
- **PATCH /api/workouts/sessions/:id/finish**: Finish session (applies progression)
- **GET /api/workouts/sessions/active**: Get user's active session
- **GET /api/workouts/sessions/:id**: Get specific session details
- **PUT /api/workouts/sessions/:id/set-logs**: Upsert set logs (updates activity heartbeat)
- **DELETE /api/workouts/sessions/:id/set-logs/:routineExerciseId/:setNumber**: Delete set log

**Session Management Features:**
- **Single Active Session Invariant**: Only one `IN_PROGRESS` session per user
- **Activity Heartbeat**: `lastActivityAt` field updated on all session interactions
- **Auto-Expiration**: Stale sessions auto-aborted after configurable timeout
- **Background Maintenance**: Periodic cleanup via `WorkoutMaintenanceService`

#### RtF (Reps to Failure) Specialized Endpoints

- **GET /api/routines/:routineId/rtf-timeline**: Get RtF program timeline
- **GET /api/workouts/routines/:id/rtf-forecast**: Get RtF forecast data

#### System Endpoints

- **GET /api/health**: Health check endpoint
- **GET /api/metrics**: Prometheus metrics (IP allowlist protected)
- **GET /api/internal/cache-metrics**: Cache performance metrics

## Advanced Features

### Dual Authentication System

#### Supabase Authentication (Primary)
- **SupabaseJwtGuard**: Primary authentication guard
- **SupabaseJwtStrategy**: Token validation strategy
- **SupabaseService**: Token verification and user management
- Session cookies: `ss_session` for middleware detection
- Used by: Users, Routines, Workouts, Exercises modules

### Exercise Progression Systems

#### Progression Schemes

1. **DYNAMIC**: Progression when ALL sets reach rep target
2. **DYNAMIC_DOUBLE**: Individual progression per set
3. **PROGRAMMED_RTF**: Advanced calendar-based progression
   - 5 sets per occurrence (4 fixed + 1 AMRAP)
   - Weekly intensity as % of Training Max (TM)
   - Optional deloads (W7/14/21 → 3×5 @ RPE6)
   - Automatic TM adjustments based on AMRAP performance
   - Program styles: STANDARD | HYPERTROPHY

#### Training Max (TM) Management
- **Automatic Adjustments**: Based on AMRAP set performance
- **Manual Adjustments**: Via TM events API
- **Guardrails**: 20% max change per adjustment, absolute caps
- **History Tracking**: Complete audit trail of TM changes
- **Summary Statistics**: Aggregated TM adjustment analytics

### Caching Architecture

#### RtF Week Goals Cache (RTF-B04/B10)
- **Layered Cache**: L1 (in-memory) + L2 (Redis)
- **Cache Invalidation**: Automatic on TM adjustments
- **ETag Support**: Conditional GET with RTF-B12
- **Performance Metrics**: Cache hit/miss tracking via `CacheMetricsService`
- **Stampede Protection**: Prevents cache stampede scenarios