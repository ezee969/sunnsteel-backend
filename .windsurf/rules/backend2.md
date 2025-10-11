---
trigger: always_on
---

# Sunnsteel Backend - Part 2 - Fitness API

#### Cache Monitoring
- **CacheMetricsService**: Unified metrics snapshot for active cache drivers
- **Prometheus Integration**: Real-time cache performance metrics
- **Multi-Driver Support**: In-memory, Redis, or layered cache configurations

#### Configuration
```env
RTF_CACHE_DRIVER=memory|redis
RTF_REDIS_URL=redis://host:port
RTF_WEEK_GOAL_TTL_SEC=600
RTF_CACHE_LAYERED=1
RTF_WEEK_GOALS_L1_TTL_MS=5000
RTF_ETAG_ENABLED=1
```

### Database Schema

#### Core Models

```prisma
model User {
  id              String  @id @default(uuid())
  email           String  @unique
  name            String
  password        String?
  supabaseUserId  String? @unique
  weightUnit      WeightUnit @default(KG)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Routine {
  id                        String    @id @default(uuid())
  userId                    String
  name                      String
  description               String?
  isFavorite                Boolean   @default(false)
  isCompleted               Boolean   @default(false)
  
  // RtF Program Fields
  programWithDeloads        Boolean?
  programDurationWeeks      Int?
  programStartWeek          Int?      @default(1)
  programStartDate          DateTime? @db.Date
  programEndDate            DateTime? @db.Date
  programTrainingDaysOfWeek Int[]     @default([])
  programTimezone           String?
  programStyle              ProgramStyle?
  programRtfSnapshot        Json?
  
  days                      RoutineDay[]
  workoutSessions          WorkoutSession[]
  tmAdjustments            TmAdjustment[]
}

model TmAdjustment {
  id         String      @id @default(uuid())
  routineId  String
  exerciseId String
  weekNumber Int
  deltaKg    Float
  preTmKg    Float
  postTmKg   Float
  reason     String?
  style      ProgramStyle?
  createdAt  DateTime    @default(now())
  
  routine    Routine     @relation(fields: [routineId], references: [id], onDelete: Cascade)
  exercise   Exercise    @relation(fields: [exerciseId], references: [id])
  
  @@index([routineId, exerciseId])
  @@index([createdAt])
}

model WorkoutSession {
  id            String              @id @default(uuid())
  userId        String
  routineId     String
  routineDayId  String
  status        WorkoutSessionStatus @default(IN_PROGRESS)
  startedAt     DateTime            @default(now())
  finishedAt    DateTime?
  lastActivityAt DateTime           @default(now())
  durationSec   Int?
  notes         String?
  setLogs       SetLog[]
  
  @@unique([userId], where: { status: IN_PROGRESS }, name: "single_active_session")
  @@index([lastActivityAt])
}

enum WorkoutSessionStatus {
  IN_PROGRESS
  COMPLETED
  ABORTED
}

enum ProgramStyle {
  STANDARD
  HYPERTROPHY
}

enum ProgressionScheme {
  NONE
  DYNAMIC
  DYNAMIC_DOUBLE
  PROGRAMMED_RTF
}
```

### Data Transfer Objects (DTOs)

#### Authentication DTOs
- **GoogleAuthDto**: Google ID token validation
- **SupabaseTokenDto**: Supabase token verification

#### Routine DTOs
- **CreateRoutineDto**: Complex routine creation with RtF support
- **UpdateRoutineDto**: Partial updates with program style validation
- **GetRoutinesFilterDto**: Boolean filter transformations

#### TM Adjustment DTOs
- **CreateTmEventDto**: TM adjustment with guardrails
- **GetTmAdjustmentsDto**: Exercise filtering
- **TmEventSummaryDto**: Aggregated statistics
- **TmEventResponseDto**: Complete event details

#### Workout DTOs
- **ListSessionsDto**: Advanced filtering and pagination
- **StartSessionDto**: Session initialization
- **FinishSessionDto**: Session completion

### Security & Guards

#### Guard Hierarchy
- **SupabaseJwtGuard**: Primary authentication (most endpoints)
- **ThrottlerGuard**: Global rate limiting (100 req/min)

#### Security Features
- **Token Blacklisting**: Immediate token invalidation
- **IP Allowlisting**: Metrics endpoint protection
- **Input Validation**: Comprehensive DTO validation
- **CORS Configuration**: Frontend-specific settings
- **Secure Cookies**: HttpOnly, SameSite, Secure flags

### Monitoring & Observability

#### Prometheus Metrics
- **TM Adjustment Metrics**: Success/failure rates, guardrail violations
- **Cache Metrics**: Hit/miss ratios, performance stats, stampede protection
- **Session Metrics**: Active sessions, completion rates, heartbeat tracking
- **RtF Metrics**: Week goals cache performance, forecast accuracy
- **System Metrics**: L1/L2 cache entries, layered cache performance

#### Health Checks
- **Health Endpoint**: Basic service status
- **Cache Metrics**: Internal cache performance monitoring via `/api/internal/cache-metrics`
- **Prometheus Metrics**: System metrics via `/api/metrics` (IP allowlist protected)

### Environment Configuration

#### Required Variables
```env
# Database
DATABASE_URL="postgresql://..."

# Authentication
JWT_ACCESS_SECRET="..."
JWT_REFRESH_SECRET="..."
SUPABASE_URL="https://..."
SUPABASE_SERVICE_ROLE_KEY="..."
GOOGLE_CLIENT_ID="..."

# Application
PORT=4000
FRONTEND_URL="http://localhost:3000"
NODE_ENV="development|production"

# Caching
RTF_CACHE_DRIVER="memory|redis"
RTF_REDIS_URL="redis://..."
RTF_WEEK_GOAL_TTL_SEC=600
RTF_CACHE_LAYERED=1
RTF_WEEK_GOALS_L1_TTL_MS=5000
RTF_ETAG_ENABLED=1

# Workout Management
WORKOUT_SESSION_TIMEOUT_HOURS=48
WORKOUT_SESSION_SWEEP_INTERVAL_MIN=30

# Monitoring
METRICS_IP_ALLOWLIST="127.0.0.1,::1"
```

## Development Patterns

### Code Organization
- **Modular Architecture**: Feature-based modules
- **Dependency Injection**: NestJS IoC container
- **Service Layer**: Business logic separation
- **Repository Pattern**: Database abstraction via Prisma

### Testing Strategy
- **Unit Tests**: Jest with comprehensive mocking
- **E2E Tests**: Supertest with test database
- **Guard Testing**: Authentication flow validation
- **Service Testing**: Business logic verification

### Error Handling
- **Custom Exceptions**: Domain-specific errors
- **Global Exception Filter**: Centralized error handling
- **Validation Pipes**: Input validation with class-validator
- **Logging**: Structured error logging

### Performance Optimizations
- **Database Indexing**: Composite indexes for queries
- **Connection Pooling**: Prisma connection management
- **Caching Strategy**: Multi-layer cache architecture
- **Query Optimization**: Selective field retrieval

## API Design Principles

### RESTful Conventions
- **Resource-based URLs**: Clear resource identification
- **HTTP Methods**: Proper verb usage (GET, POST, PATCH, DELETE)
- **Status Codes**: Appropriate HTTP status responses
- **Consistent Responses**: Standardized response formats

### Validation & Transformation
- **Input Validation**: class-validator decorators
- **Type Transformation**: class-transformer for DTOs
- **Global Pipes**: Automatic validation and transformation
- **Custom Validators**: Domain-specific validation rules

### Documentation Standards
- **JSDoc Comments**: Comprehensive code documentation
- **Markdown Documentation**: Structured documentation in `docs/` hierarchy
- **README Updates**: Endpoint documentation maintenance
- **Change Detection**: Automated documentation reminders

## Frontend Integration

### Authentication Flow
1. **Supabase Auth**: Primary authentication method
2. **Session Management**: HttpOnly cookies for session detection
3. **Token Refresh**: Automatic token renewal
4. **Logout Handling**: Complete session cleanup

### CORS Configuration
- **Origin**: Configurable frontend URL
- **Credentials**: Cookie support enabled
- **Methods**: Full HTTP method support
- **Headers**: Custom header allowance

## Agent Context

When implementing features:

- **Use Supabase authentication** for new endpoints (SupabaseJwtGuard)
- **Implement comprehensive DTOs** with validation
- **Follow modular architecture** patterns
- **Add appropriate caching** for performance-critical endpoints
- **Include Prometheus metrics** for monitoring
- **Write comprehensive tests** (unit + e2e)
- **Update documentation** automatically
- **Follow TypeScript strict patterns**
- **Implement proper error handling**
- **Use Prisma best practices** for database operations

## Documentation Conventions

- **NEVER create documentation files at repo root** (except README.md)
- **All project docs belong in `docs/` hierarchy**:
  - `docs/roadmaps/` - Active feature roadmaps and task tracking
  - `docs/history/` - Implementation completion reports
  - `docs/reference/` - Configuration guides, environment setup, API references
- **Update `docs/README.md` index** when adding new documentation areas
- **Roadmap files**: Use consistent task ID format (RTF-B01, RTF-B02, etc.) for traceability

## Scripts & Automation

### Available Scripts
```json
{
  "build": "nest build",
  "start:dev": "nest start --watch",
  "start:prod": "node dist/src/main",
  "deploy": "prisma migrate deploy && npm run start:prod",
  "test": "jest",
  "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
  "test:e2e:rtf": "jest --config ./test/jest-e2e.json --runTestsByPath test/routines-rtf-variants.e2e-spec.ts test/tm-adjustment-hypertrophy.e2e-spec.ts test/workouts-rtf-sets.e2e-spec.ts",
  "db:seed": "tsx prisma/seed.ts",
  "docs:check": "./scripts/update-docs.sh",
  "docs:update": "echo 'Run docs:check first, then update documentation manually'"
}
```

### Documentation Automation
- **Change Detection**: `scripts/update-docs.sh` detects structural changes
- **Endpoint Discovery**: Automatic controller endpoint detection
- **Schema Monitoring**: Prisma schema change tracking
- **DTO Tracking**: Data transfer object change detection