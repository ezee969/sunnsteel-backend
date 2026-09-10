# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

NestJS + Prisma backend for Sunnsteel (workout/routine tracking). Runs on Windows 11. Never try to mount/run the project yourself; ask the user to start it.

## Commands

- Run API: `npm run start:dev` (tsx watch, default `http://localhost:4000/api`)
- Run API + frontend together: `npm run dev:all` (PowerShell launcher `scripts/start-dev.ps1`)
- Build: `npm run build` (`tsc -p tsconfig.build.json`)
- Lint: `npm run lint` / `npm run lint:fix`
- Typecheck: `npm run typecheck`
- Format: `npm run format`
- Full gate (run before considering work done): `npm run verify` (lint && typecheck && test && build)
- Prisma migrate: `npx prisma migrate dev`
- Seed DB / load exercises: `npm run db:seed` (alias `npm run db:add-exercises`) — both run `prisma/add-exercises.ts`, the idempotent exercise-catalog loader. This is also the `prisma migrate reset`/`migrate dev` seed hook.
- Get a Supabase token for manual API testing: `npm run token:supabase`

`npm test` runs the Node test runner via the existing ts-node dependency. `scripts/workout-stats.test.ts` covers dashboard statistics with mocked database calls; it is included in `npm run verify`.

## Architecture

### Module layout

Feature modules under `src/` (auth, users, token, exercises, routines, workouts, metrics, health, common, database). `DatabaseService extends PrismaClient` (`src/database/database.service.ts`) is exported via `DatabaseModule` and injected everywhere Prisma access is needed. Controllers share the `RequestWithUser` type from `src/common/types/request-with-user.ts` rather than redeclaring it.

### Auth (Supabase)

- Supabase Auth issues JWTs; `SupabaseJwtStrategy`/`SupabaseJwtGuard` (`src/auth/strategies`, `src/auth/guards`) validate bearer tokens and sync the user into the local DB.
- Protect endpoints with `@UseGuards(SupabaseJwtGuard)`.
- `POST /auth/supabase/verify` (`src/auth/supabase-auth.controller.ts`) sets an HttpOnly `ss_session=1` cookie that the frontend middleware uses for route protection — it's a marker cookie, not the actual session.

### Workouts module — service decomposition

`workouts.service.ts` is a thin facade; behavior lives in single-purpose services under `src/workouts/services/` (barrel-exported via `services/index.ts`) plus a few top-level files in `src/workouts/`:

- `workout-session-start.service.ts` — starting or resuming a session; reuse refreshes `lastActivityAt`
- `workout-session-log.service.ts` — logging sets during a session
- `workout-session-finish.service.ts` — finishing a session (applies weight progression)
- `workout-session-read.service.ts` — reads/listing

Active workout sessions are recoverable user data. Do not restore a timer that
silently marks stale sessions `ABORTED`: LIVE-10 deliberately leaves them active
until the owner resumes, completes the saved work, or discards it. Staleness is
derived by the frontend from the existing `lastActivityAt`/`startedAt` fields;
resuming through `POST /workouts/sessions/start` refreshes `lastActivityAt`.

When adding workout behavior, add a new focused service (or extend the matching one above) rather than growing `workouts.service.ts` or `WorkoutsController` directly.

### Progression schemes

Progression is tracked **per exercise** (`RoutineExercise.progressionScheme`), never per routine. The backend accepts three live schemes, enforced by `LIVE_PROGRESSION_SCHEMES` in `src/routines/dto/create-routine.dto.ts`:

- `NONE` — no automatic progression
- `DOUBLE_PROGRESSION` — increase reps first, then weight once all sets hit target
- `DYNAMIC_DOUBLE_PROGRESSION` — each set progresses independently

Progression is applied on session finish in `workout-session-finish.service.ts`.

⚠️ Reps-to-Failure (RtF / `PROGRAMMED_RTF`) was removed from the backend and shared contracts. The Prisma enum may still carry `PROGRAMMED_RTF`/`PROGRAMMED_RTF_HYPERTROPHY` values until the DB migration lands — do not wire them back up. The DTO restricts accepted schemes to the three above regardless of the database enum.

### Shared contracts

DTOs/enums are sourced from the published `@sunsteel/contracts` package rather than redefined — check `src/routines/dto/*` and `src/workouts/dto/*` for examples before adding new shapes. Do not switch the dependency to a local `file:` link: update `../sunnsteel-contracts`, publish a new registry version, and then bump this repository to that version.

**Response serialization boundary.** Read/mutation endpoints return the shared _response_ contract types (`Routine`, `WorkoutSession`, `UserProfile`, etc.), not raw Prisma results. Each domain has a mapper that is the single place converting Prisma `Date` → ISO string and asserting, at compile time, that the response matches the contract: `src/routines/routine.mapper.ts`, `src/workouts/workout-session.mapper.ts`, and `mapUserProfile`/inline mappers in `src/users/users.service.ts`. Mapper inputs are typed via `Prisma.*GetPayload<{ select: typeof SOME_SELECT }>` so a select/contract drift breaks the build. When adding an endpoint that returns a persisted entity, map it through (or add) one of these rather than returning the Prisma object directly.

**Profile privacy is an authorization boundary, not a presentation filter.** `User` stores independent `PUBLIC`/`FOLLOWERS`/`PRIVATE` settings for biography, location, training identity, workout history, records, routines, achievements and body metrics, all defaulting to `PRIVATE`. `src/users/profile-privacy.ts` is the central owner/follower/public resolver. `getPublicProfile` must resolve access before issuing biography, location, training-identity, analytics, personal-record or body-metric reads, and `PublicUserProfile` must never include email. Denied biography/location/training-identity values are not selected or serialized. Owners always retain access; `FOLLOWERS` means the viewer follows the profile owner. Favorite exercises use an ordered relation to catalog `Exercise` rows rather than free text. Routine and achievement policies are persisted for future surfaces but expose no content yet.

### Runtime conventions

- `src/main.ts` polyfills `globalThis.crypto` via Node's `webcrypto` — this must stay as the very first thing in the file (before other imports run).
- Global route prefix is `api`; CORS origin comes from `FRONTEND_URL` env var (fallback `http://localhost:3000`).
- Global `ValidationPipe` has `transform: true` + implicit conversion, `whitelist: true`, `forbidNonWhitelisted: true` — DTO property types matter, and unknown request fields are rejected rather than ignored.
- Global rate limiting via `ThrottlerGuard` (`src/app.module.ts`).
- Built-in endpoints: `GET /health`, `GET /metrics` (Prometheus, IP-allowlisted).

## Code style

- Match the surrounding file's formatting (tabs/spaces and semicolon usage vary across existing files).

## Documentation

The previous backend-local `docs/` folder was removed because it had drifted from the code (see the progression-scheme mismatch above). Do not recreate implementation assumptions from memory of it; treat source plus this file as the trustworthy backend reference.

Before proposing or implementing product features, read the canonical cross-repository roadmap at [`../sunnsteel-frontend/docs/roadmaps/product-roadmap.md`](../sunnsteel-frontend/docs/roadmaps/product-roadmap.md). It records shipped capabilities, the active queue, dependencies, deferred work and retained product decisions. Verify backend code before changing a feature to `SHIPPED`; backend implementation guidance still comes from source plus this file.

### Portfolio docs (monorepo parent folder)

`../FEATURES.md` (product-facing) and `../TECH_STACK.md` (technical/portfolio-facing) live in the parent workspace folder (`sunsteel/`), outside all three repositories. They are derived documents: the code and the canonical roadmap above are the sources of truth.

Update them in the same change when backend work moves a roadmap feature to `SHIPPED`, removes or hides an active user-facing capability, changes a dependency/CI/build script, or changes an architecture decision recorded in this file. Keep `FEATURES.md` free of technical details and `TECH_STACK.md` free of unverified claims; update its "Last verified" date only when actually verified against code. Do not sync them for refactors, fixes, or in-progress work with no user-visible or stack-visible effect.
