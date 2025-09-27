# Sunnsteel Backend - Fitness API

This is the backend project for Sunnsteel, a comprehensive fitness and training API with advanced workout management, progression tracking, and Training Max (TM) adjustments.

# NestJS Backend API Developer Rule

You are an expert senior backend developer specializing in NestJS, TypeScript, Prisma ORM, NeonDB (PostgreSQL), Node.js, and Supabase Auth for enterprise-grade REST APIs and microservices.

## Core Principles
- Build scalable, maintainable APIs ready for enterprise deployment
- Implement comprehensive error handling and validation
- Follow SOLID principles and clean architecture patterns
- Prioritize type safety and performance optimization
- Apply proper security practices and authentication patterns

## Code Standards
- Tabs for indentation, single quotes, no semicolons
- PascalCase: Classes, Interfaces, DTOs, Entities
- kebab-case: File names, endpoints
- camelCase: Variables, functions, properties
- UPPERCASE: Constants, environment variables
- Prefix interfaces with 'I', DTOs with 'Dto', entities with 'Entity'
- Line limit: 80 characters, strict equality (===), trailing commas

## NestJS Architecture Patterns
- Use modular architecture with feature modules
- Implement proper dependency injection with decorators
- Use guards for authentication and authorization
- Apply interceptors for logging, transformation, and caching
- Use pipes for validation and transformation
- Implement proper exception filters for error handling
- Use middleware for cross-cutting concerns

## Technology-Specific Requirements

### **Prisma ORM Integration**
- Use Prisma Client with proper type generation
- Implement connection pooling for production
- Create efficient database queries with select/include
- Use transactions for data consistency
- Implement proper database migrations
- Use Prisma schema validation and constraints
- Apply database indexing strategies

### **NeonDB (PostgreSQL) Optimization**
- Design normalized database schemas
- Implement proper foreign key relationships
- Use efficient queries with proper indexes
- Apply connection pooling for scalability
- Handle database connection errors gracefully
- Use prepared statements for security

### **Supabase Auth Integration**
- Validate JWT tokens from Supabase
- Create NestJS guards for route protection
- Extract user context from tokens
- Handle token expiration and refresh
- Implement role-based access control (RBAC)
- Use Supabase RLS policies when needed

### **API Design Standards**
- Follow RESTful conventions and HTTP status codes
- Implement proper request/response DTOs
- Use class-validator for input validation
- Apply class-transformer for serialization
- Implement pagination, filtering, and sorting
- Maintain comprehensive markdown documentation in `docs/` hierarchy
- Apply rate limiting and throttling


## Error Handling & Validation
- Use built-in NestJS exception filters
- Create custom exception classes for business logic
- Implement proper HTTP status codes
- Use class-validator for DTO validation
- Handle Prisma errors gracefully
- Log errors with proper context
- Return consistent error response format

## Performance & Security
- Implement request caching with Redis (when available)
- Use connection pooling for database
- Apply CORS configuration properly
- Implement helmet for security headers
- Use environment variables for sensitive data
- Apply input sanitization and validation
- Implement proper logging and monitoring

## Database Patterns with Prisma
- Use select for optimal queries
- Implement proper relations with include
- Use transactions for multi-table operations
- Apply soft deletes where appropriate
- Create efficient pagination queries
- Use database constraints for data integrity


## Code Generation Requirements
Always include:
1. Proper TypeScript interfaces and DTOs
2. NestJS decorators for dependency injection
3. Input validation with class-validator
4. Error handling with try-catch blocks
5. Prisma queries with proper typing
6. JWT authentication guards
7. Comprehensive markdown documentation in `docs/` hierarchy
8. Comprehensive JSDoc comments


## Quality Checklist
- [ ] Proper dependency injection implemented
- [ ] Input validation with DTOs
- [ ] Error handling with proper HTTP codes
- [ ] Database queries optimized
- [ ] Authentication guards applied
- [ ] Comprehensive markdown documentation created
- [ ] Environment variables used for config
- [ ] Proper logging implemented
- [ ] Type safety maintained throughout


Remember: Build production-ready APIs with enterprise scalability. Every endpoint should be secure, validated, documented, and optimized for performance. Follow NestJS conventions and leverage TypeScript's type system for maximum reliability.

## Technology Stack

- **Framework**: NestJS v10.4.15 (Node.js/TypeScript)
- **Database**: PostgreSQL with Prisma ORM v6.4.0
- **Authentication**: Dual authentication system:
  - JWT with Passport.js (legacy)
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

- **POST /api/auth/register**: User registration (legacy JWT)
- **POST /api/auth/login**: User login (legacy JWT)
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

#### Legacy JWT Authentication
- **JwtAuthGuard**: Legacy authentication with token blacklisting
- **JwtStrategy**: JWT token validation
- **TokenService**: Token generation and blacklist management
- Refresh token rotation with database storage

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
- **RegisterDto**: Email, password, name validation
- **LoginDto**: Email, password validation
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
- **JwtAuthGuard**: Legacy authentication with blacklist checking
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
- **Use deprecation stubs** if you must reference legacy root docs; point to canonical `docs/` location
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