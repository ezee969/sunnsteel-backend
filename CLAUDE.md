# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS + Prisma backend for Sunnsteel (workout/routine tracking). Runs on Windows 11. Never try to mount/run the project yourself; ask the user to start it.

## Commands

- Run API: `npm run start:dev` (tsx watch, default `http://localhost:4000/api`)
- Run API + frontend together: `npm run dev:all` (PowerShell launcher `scripts/start-dev.ps1`)
- Build: `npm run build` (`tsc -p tsconfig.build.json`)
- Lint: `npm run lint` / `npm run lint:fix`
- Typecheck: `npm run typecheck`
- Format: `npm run format`
- Full gate (run before considering work done): `npm run verify` (lint && typecheck && build)
- Prisma migrate: `npx prisma migrate dev`
- Seed DB / load exercises: `npm run db:seed` (alias `npm run db:add-exercises`) — both run `prisma/add-exercises.ts`, the idempotent exercise-catalog loader. This is also the `prisma migrate reset`/`migrate dev` seed hook.
- Get a Supabase token for manual API testing: `npm run token:supabase`

There is no test runner/spec suite in this repo — `npm run verify` is the correctness gate.

## Architecture

### Module layout

Feature modules under `src/` (auth, users, token, exercises, routines, workouts, metrics, health, common, database). `DatabaseService extends PrismaClient` (`src/database/database.service.ts`) is exported via `DatabaseModule` and injected everywhere Prisma access is needed. Controllers share the `RequestWithUser` type from `src/common/types/request-with-user.ts` rather than redeclaring it.

### Auth (Supabase)

- Supabase Auth issues JWTs; `SupabaseJwtStrategy`/`SupabaseJwtGuard` (`src/auth/strategies`, `src/auth/guards`) validate bearer tokens and sync the user into the local DB.
- Protect endpoints with `@UseGuards(SupabaseJwtGuard)`.
- `POST /auth/supabase/verify` (`src/auth/supabase-auth.controller.ts`) sets an HttpOnly `ss_session=1` cookie that the frontend middleware uses for route protection — it's a marker cookie, not the actual session.

### Workouts module — service decomposition

`workouts.service.ts` is a thin facade; behavior lives in single-purpose services under `src/workouts/services/` (barrel-exported via `services/index.ts`) plus a few top-level files in `src/workouts/`:

- `workout-session-start.service.ts` — starting a session
- `workout-session-log.service.ts` — logging sets during a session
- `workout-session-finish.service.ts` — finishing a session (applies weight progression)
- `workout-session-read.service.ts` — reads/listing
- `workout-maintenance.service.ts` — scheduled/maintenance tasks

When adding workout behavior, add a new focused service (or extend the matching one above) rather than growing `workouts.service.ts` or `WorkoutsController` directly.

### Progression schemes

Progression is tracked **per exercise** (`RoutineExercise.progressionScheme`), never per routine. The backend accepts three live schemes, enforced by `LIVE_PROGRESSION_SCHEMES` in `src/routines/dto/create-routine.dto.ts`:

- `NONE` — no automatic progression
- `DOUBLE_PROGRESSION` — increase reps first, then weight once all sets hit target
- `DYNAMIC_DOUBLE_PROGRESSION` — each set progresses independently

Progression is applied on session finish in `workout-session-finish.service.ts`.

⚠️ Reps-to-Failure (RtF / `PROGRAMMED_RTF`) was removed from the backend. The shared `@sunsteel/contracts` package still exports legacy RtF/TM types and the Prisma enum may still carry `PROGRAMMED_RTF`/`PROGRAMMED_RTF_HYPERTROPHY` values until the DB migration lands — do not wire them back up. The DTO restricts accepted schemes to the three above regardless of what contracts exports.

### Shared contracts

DTOs/enums are often sourced from the local `@sunsteel/contracts` package (`file:../sunsteel-contracts`) rather than redefined — check `src/routines/dto/*` and `src/workouts/dto/*` for examples before adding new shapes.

**Response serialization boundary.** Read/mutation endpoints return the shared *response* contract types (`Routine`, `WorkoutSession`, `UserProfile`, etc.), not raw Prisma results. Each domain has a mapper that is the single place converting Prisma `Date` → ISO string and asserting, at compile time, that the response matches the contract: `src/routines/routine.mapper.ts`, `src/workouts/workout-session.mapper.ts`, and `mapUserProfile`/inline mappers in `src/users/users.service.ts`. Mapper inputs are typed via `Prisma.*GetPayload<{ select: typeof SOME_SELECT }>` so a select/contract drift breaks the build. When adding an endpoint that returns a persisted entity, map it through (or add) one of these rather than returning the Prisma object directly. Note: the contracts package still carries optional legacy RtF fields — they're simply left unset.

### Runtime conventions

- `src/main.ts` polyfills `globalThis.crypto` via Node's `webcrypto` — this must stay as the very first thing in the file (before other imports run).
- Global route prefix is `api`; CORS origin comes from `FRONTEND_URL` env var (fallback `http://localhost:3000`).
- Global `ValidationPipe` has `transform: true` + implicit conversion, `whitelist: true`, `forbidNonWhitelisted: true` — DTO property types matter, and unknown request fields are rejected rather than ignored.
- Global rate limiting via `ThrottlerGuard` (`src/app.module.ts`).
- Built-in endpoints: `GET /health`, `GET /metrics` (Prometheus, IP-allowlisted).

## Code style

- Match the surrounding file's formatting (tabs/spaces and semicolon usage vary across existing files).

## Documentation

The previous `docs/` folder was removed because it had drifted from the code (see the progression-scheme mismatch above) — don't recreate assumptions from memory of it. A new docs setup is planned; until then, treat source + this file as the only trustworthy reference.
