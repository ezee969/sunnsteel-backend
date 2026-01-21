## Sunnsteel Backend (NestJS + Prisma)

- The project is executed in Windows 11.
- Never try to mount/run the project by yourself; ask the user to do it.
- Keep documentation under `docs/` (avoid adding new root-level docs files).

### Developer workflows (from `package.json`)

- Run API: `npm run start:dev` (default `http://localhost:4000/api`)
- Run both apps: `npm run dev:all` (PowerShell launcher in `start-dev.ps1`)
- Prisma:
  - Migrate: `npx prisma migrate dev`
  - Seed: `npm run db:seed`
  - Load exercises: `npm run db:add-exercises`
- Tests: `npm test`, `npm run test:e2e`, `npm run test:e2e:rtf`

### Runtime conventions

- `src/main.ts` polyfills `globalThis.crypto` via Node `webcrypto` (keep this at the very top of the file).
- Global route prefix is `api` and CORS origin comes from `FRONTEND_URL` (fallback `http://localhost:3000`) in [src/main.ts](../src/main.ts).
- Global validation uses `ValidationPipe({ transform: true, enableImplicitConversion: true })`, so DTO property types matter (implicit string→number conversions are expected).

### Database (Prisma)

- Prisma client is provided as `DatabaseService extends PrismaClient` in [src/database/database.service.ts](../src/database/database.service.ts) and exported via `DatabaseModule`.

### Ops / internal endpoints

- Global rate limiting is enabled via `ThrottlerGuard` (see [src/app.module.ts](../src/app.module.ts)).
- Built-in endpoints: `/health` and `/internal/cache-metrics` (see [src/app.module.ts](../src/app.module.ts)).

### Auth (Supabase)

- Protect endpoints using `@UseGuards(SupabaseJwtGuard)` (see [src/auth/auth.module.ts](../src/auth/auth.module.ts)).
- The `/auth/supabase/verify` endpoint sets an HttpOnly cookie `ss_session=1` used by the frontend middleware for route protection (see [src/auth/supabase-auth.controller.ts](../src/auth/supabase-auth.controller.ts)).

### Caching (RtF week goals)

- Global singleton cache module is [src/cache/cache.module.ts](../src/cache/cache.module.ts).
- Driver/config is environment-based: `RTF_CACHE_DRIVER=memory|redis`, `RTF_REDIS_URL`, `RTF_CACHE_LAYERED`.

### Shared contracts (`@sunsteel/contracts`)

- Backend DTOs/enums often come from `@sunsteel/contracts` (examples: `src/routines/dto/*`, `src/workouts/dto/*`). Prefer reusing these shared shapes over redefining them.

### Code style

- Match the surrounding file’s formatting (tabs/spaces and semicolon usage vary across existing files). Run `npm run lint`/`npm run format` when touching many files.
