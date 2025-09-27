# Sunnsteel Backend - Detailed Content Outlines

This document provides comprehensive content outlines for each section of the documentation plan, ensuring systematic and thorough coverage of all project components.

## Table of Contents

- [Getting Started Documentation](#getting-started-documentation)
- [Architecture Documentation](#architecture-documentation)
- [API Documentation](#api-documentation)
- [Module-Specific Documentation](#module-specific-documentation)
- [Advanced Features Documentation](#advanced-features-documentation)
- [Development & Operations](#development--operations)
- [Reference Documentation](#reference-documentation)

---

## Getting Started Documentation

### INSTALLATION.md

#### 1. Prerequisites
- **System Requirements**
  - Node.js 18+ installation and verification
  - PostgreSQL 14+ setup and configuration
  - Redis (optional, for caching) installation
  - Git for version control

#### 2. Environment Setup
- **Database Configuration**
  - PostgreSQL database creation
  - Connection string format and examples
  - User permissions and security setup
- **Environment Variables**
  - Required variables with descriptions
  - Optional variables and their defaults
  - Environment-specific configurations (dev/prod)
  - Security considerations for sensitive variables

#### 3. Project Setup
- **Repository Cloning**
  - Git clone command and repository URL
  - Branch selection for different environments
- **Dependency Installation**
  - npm install process and troubleshooting
  - Package-lock.json handling
  - Node modules structure overview

#### 4. Database Initialization
- **Prisma Setup**
  - Schema generation and validation
  - Database connection testing
- **Migrations**
  - Running initial migrations
  - Migration rollback procedures
  - Custom migration creation
- **Seeding**
  - Default data seeding process
  - Custom seed data creation
  - Seed data validation

#### 5. Application Startup
- **Development Server**
  - npm run start:dev command
  - Watch mode functionality
  - Hot reload configuration
- **Health Checks**
  - /api/health endpoint verification
  - Database connectivity testing
  - Cache connectivity testing (if Redis enabled)

#### 6. Verification & Testing
- **Basic API Testing**
  - Health endpoint curl examples
  - Authentication endpoint testing
  - Basic CRUD operation examples
- **Common Issues**
  - Port conflicts and resolution
  - Database connection failures
  - Permission issues and solutions

### QUICK_START.md

#### 1. 5-Minute Setup
- **Minimal Configuration**
  - Essential environment variables only
  - SQLite fallback for quick testing
  - In-memory cache configuration
- **One-Command Setup**
  - Combined setup script
  - Automated dependency installation
  - Quick database initialization

#### 2. First API Calls
- **Authentication Flow**
  - User registration example
  - Login process demonstration
  - Token usage in subsequent requests
- **Basic Operations**
  - Create a simple routine
  - Add exercises to routine
  - Start a workout session

#### 3. Common Workflows
- **User Journey Examples**
  - New user onboarding flow
  - Routine creation and management
  - Workout session lifecycle
  - Progress tracking demonstration

#### 4. Next Steps
- **Deep Dive Links**
  - Architecture documentation references
  - Module-specific guides
  - Advanced feature explanations
- **Development Resources**
  - API reference links
  - Testing guide references
  - Deployment documentation

### DEVELOPMENT.md

#### 1. Development Environment
- **IDE Configuration**
  - VSCode settings and extensions
  - TypeScript configuration
  - Debugging setup
- **Code Formatting**
  - Prettier configuration
  - ESLint rules and setup
  - Pre-commit hooks

#### 2. Development Workflow
- **Branch Strategy**
  - Git flow explanation
  - Feature branch naming conventions
  - Pull request process
- **Code Organization**
  - Module structure guidelines
  - File naming conventions
  - Import/export patterns

#### 3. Testing During Development
- **Unit Testing**
  - Jest configuration and usage
  - Test file organization
  - Mocking strategies
- **E2E Testing**
  - Supertest setup and usage
  - Test database management
  - API endpoint testing

#### 4. Debugging Techniques
- **Local Debugging**
  - VSCode debugger setup
  - Breakpoint usage
  - Variable inspection
- **Log Analysis**
  - Logging levels and configuration
  - Log file locations
  - Structured logging patterns

---

## Architecture Documentation

### OVERVIEW.md

#### 1. System Architecture
- **High-Level Architecture Diagram**
  - Component relationships
  - Data flow visualization
  - External service integrations
- **Architectural Patterns**
  - Modular monolith approach
  - Dependency injection patterns
  - Service layer architecture

#### 2. Technology Stack Rationale
- **Framework Selection**
  - NestJS benefits and trade-offs
  - TypeScript advantages
  - Express.js foundation
- **Database Choices**
  - PostgreSQL selection rationale
  - Prisma ORM benefits
  - Migration strategy

#### 3. Design Principles
- **SOLID Principles Application**
  - Single Responsibility examples
  - Open/Closed principle usage
  - Dependency Inversion implementation
- **Clean Architecture**
  - Layer separation
  - Business logic isolation
  - Infrastructure abstraction

#### 4. Scalability Considerations
- **Horizontal Scaling**
  - Stateless service design
  - Database connection pooling
  - Cache distribution strategies
- **Performance Optimization**
  - Query optimization techniques
  - Caching strategies
  - Background processing

### DATABASE_SCHEMA.md

#### 1. Entity Relationship Overview
- **Core Entities**
  - User, Routine, Exercise relationships
  - Workout session management
  - Training Max tracking
- **Supporting Entities**
  - Token management
  - Cache entries
  - Audit trails

#### 2. Detailed Table Definitions
- **User Management Tables**
  - User table structure and constraints
  - RefreshToken table design
  - Profile data organization
- **Exercise & Routine Tables**
  - Exercise catalog structure
  - Routine composition design
  - RoutineDay and RoutineExercise relationships
- **Workout Tables**
  - WorkoutSession lifecycle management
  - SetLog data structure
  - Progress tracking tables

#### 3. Indexes and Performance
- **Primary Indexes**
  - Unique constraints and their purposes
  - Composite index strategies
  - Query optimization indexes
- **Performance Considerations**
  - Query pattern analysis
  - Index maintenance strategies
  - Database statistics and monitoring

#### 4. Migration History
- **Schema Evolution**
  - Initial schema design
  - Major structural changes
  - Feature addition migrations
- **Migration Best Practices**
  - Backward compatibility strategies
  - Data migration procedures
  - Rollback considerations

### AUTHENTICATION.md

#### 1. Dual Authentication System
- **System Overview**
  - JWT vs Supabase authentication
  - Migration strategy from JWT to Supabase
  - Coexistence implementation
- **Authentication Flow Comparison**
  - Legacy JWT flow diagram
  - Supabase authentication flow
  - Token validation processes

#### 2. Implementation Details
- **Guard Architecture**
  - SupabaseJwtGuard implementation
  - JwtAuthGuard legacy support
  - Guard selection strategies
- **Strategy Patterns**
  - Passport.js integration
  - Custom strategy implementation
  - Token extraction methods

#### 3. Security Features
- **Token Management**
  - JWT generation and validation
  - Refresh token rotation
  - Token blacklisting mechanism
- **Session Security**
  - HttpOnly cookie implementation
  - CORS configuration
  - CSRF protection strategies

#### 4. Migration Considerations
- **Gradual Migration**
  - Endpoint-by-endpoint migration
  - User data synchronization
  - Rollback procedures
- **Testing Strategies**
  - Authentication flow testing
  - Security vulnerability testing
  - Performance impact assessment

---

## API Documentation

### API README.md

#### 1. API Overview
- **RESTful Design Principles**
  - Resource-based URL structure
  - HTTP method usage conventions
  - Status code standards
- **Authentication Requirements**
  - Token-based authentication
  - Authorization levels
  - Rate limiting policies

#### 2. Common Patterns
- **Request/Response Format**
  - JSON structure standards
  - Error response format
  - Pagination patterns
- **Validation Rules**
  - Input validation standards
  - Error message formats
  - Data transformation rules

#### 3. Getting Started with API
- **Base URL and Versioning**
  - API base URL structure
  - Version management strategy
  - Backward compatibility policy
- **Authentication Setup**
  - Token acquisition process
  - Header format requirements
  - Token refresh procedures

### AUTHENTICATION.md (API)

#### 1. Authentication Endpoints
- **POST /api/auth/register**
  - User registration process
  - Required fields and validation
  - Success and error responses
- **POST /api/auth/login**
  - User login process
  - Credential validation
  - Token generation and response
- **POST /api/auth/refresh**
  - Token refresh mechanism
  - Refresh token validation
  - New token generation

#### 2. Supabase Integration
- **POST /api/auth/supabase/verify**
  - Supabase token verification
  - User synchronization process
  - Session management
- **Session Management**
  - Cookie-based session handling
  - Session expiration policies
  - Logout procedures

#### 3. Google Authentication
- **POST /api/auth/google**
  - Google Sign-In integration
  - ID token validation
  - User account linking

#### 4. Security Considerations
- **Token Security**
  - Token storage recommendations
  - Transmission security
  - Expiration handling
- **Rate Limiting**
  - Authentication attempt limits
  - Lockout policies
  - Recovery procedures

### ROUTINES.md (API)

#### 1. Routine Management
- **GET /api/routines**
  - Routine listing with filters
  - Pagination implementation
  - Sorting options
- **POST /api/routines**
  - Routine creation process
  - RtF program configuration
  - Validation rules
- **PATCH /api/routines/:id**
  - Routine updates
  - Partial update support
  - Validation constraints

#### 2. RtF Program Endpoints
- **GET /api/routines/:id/rtf-timeline**
  - RtF program timeline generation
  - Week-by-week breakdown
  - Deload week handling
- **RtF Configuration**
  - Program style options (STANDARD/HYPERTROPHY)
  - Duration and scheduling
  - Timezone handling

#### 3. Training Max Management
- **POST /api/routines/:id/tm-events**
  - TM adjustment creation
  - Guardrail validation
  - Reason tracking
- **GET /api/routines/:id/tm-events**
  - TM adjustment history
  - Filtering options
  - Summary statistics

#### 4. Status Management
- **PATCH /api/routines/:id/favorite**
  - Favorite status toggle
  - Bulk operations
- **PATCH /api/routines/:id/completed**
  - Completion status management
  - Progress tracking

---

## Module-Specific Documentation

### Auth Module Documentation

#### auth/README.md

##### 1. Module Overview
- **Purpose and Scope**
  - Authentication and authorization responsibilities
  - Integration with external services
  - Security feature implementation
- **Architecture**
  - Module structure and dependencies
  - Service layer organization
  - Controller responsibilities

##### 2. Key Components
- **Services**
  - AuthService: Core authentication logic
  - SupabaseService: Supabase integration
  - TokenService: JWT management
- **Controllers**
  - AuthController: Legacy JWT endpoints
  - SupabaseAuthController: Supabase endpoints
- **Guards and Strategies**
  - Authentication guard implementation
  - Passport strategy configuration

#### auth/DUAL_AUTHENTICATION.md

##### 1. System Design
- **Architecture Overview**
  - Dual system rationale
  - Migration strategy
  - Coexistence implementation
- **Component Interaction**
  - Service layer coordination
  - Guard selection logic
  - Token validation flow

##### 2. Implementation Details
- **JWT System (Legacy)**
  - Token generation process
  - Validation mechanisms
  - Refresh token handling
- **Supabase System (Primary)**
  - Token verification process
  - User synchronization
  - Session management

##### 3. Migration Process
- **Gradual Migration**
  - Endpoint migration strategy
  - User data synchronization
  - Rollback procedures
- **Testing and Validation**
  - Migration testing procedures
  - Performance impact assessment
  - Security validation

### Routines Module Documentation

#### routines/README.md

##### 1. Module Overview
- **Core Functionality**
  - Routine CRUD operations
  - RtF program management
  - Training Max adjustments
- **Integration Points**
  - Workout session integration
  - Cache system usage
  - Exercise catalog integration

##### 2. Key Features
- **Routine Management**
  - Creation and modification
  - Favorite and completion status
  - Filtering and search capabilities
- **RtF Programs**
  - Calendar-based progression
  - Deload week implementation
  - Style variant support

#### routines/RTF_PROGRAMS.md

##### 1. RtF System Architecture
- **Program Structure**
  - 5-set system design (4 fixed + 1 AMRAP)
  - Weekly intensity progression
  - Deload week implementation
- **Calendar Integration**
  - Date-based scheduling
  - Timezone handling
  - Training day configuration

##### 2. Implementation Details
- **Week Goal Calculation**
  - Intensity percentage application
  - Training Max integration
  - Set target determination
- **Caching Strategy**
  - Week goals cache implementation
  - Cache invalidation triggers
  - Performance optimization

##### 3. Style Variants
- **STANDARD Program**
  - Traditional progression model
  - Intensity curve design
  - Deload implementation
- **HYPERTROPHY Program**
  - Volume-focused approach
  - Modified intensity patterns
  - Recovery considerations

### Workouts Module Documentation

#### workouts/README.md

##### 1. Module Overview
- **Session Management**
  - Workout session lifecycle
  - Single active session invariant
  - Auto-expiration mechanisms
- **Set Logging**
  - Set data capture and validation
  - Progress tracking integration
  - Real-time updates

##### 2. Key Components
- **WorkoutsService**
  - Session management logic
  - Set logging operations
  - Progression calculations
- **WorkoutMaintenanceService**
  - Background cleanup tasks
  - Session auto-expiration
  - Scheduled maintenance

#### workouts/SESSION_LIFECYCLE.md

##### 1. Session States
- **State Transitions**
  - IN_PROGRESS → COMPLETED
  - IN_PROGRESS → ABORTED
  - State validation rules
- **Invariants**
  - Single active session per user
  - Activity heartbeat tracking
  - Timeout mechanisms

##### 2. Session Operations
- **Session Start**
  - Idempotent start operation
  - Routine validation
  - Initial state setup
- **Session Progress**
  - Set logging operations
  - Activity heartbeat updates
  - Progress tracking
- **Session Completion**
  - Progression application
  - Final state updates
  - Cleanup operations

---

## Advanced Features Documentation

### RTF_SYSTEM.md

#### 1. System Overview
- **Reps to Failure Concept**
  - Training methodology background
  - Scientific basis and research
  - Implementation rationale
- **Program Structure**
  - 5-set system design
  - AMRAP set importance
  - Weekly progression model

#### 2. Technical Implementation
- **Calendar-Based Progression**
  - Week-by-week intensity calculation
  - Training Max percentage application
  - Deload week integration
- **Caching Architecture**
  - Week goals cache system
  - Performance optimization
  - Cache invalidation strategies

#### 3. Algorithm Details
- **Intensity Calculation**
  - Base intensity curves
  - Style variant modifications
  - Deload week adjustments
- **Progress Tracking**
  - AMRAP performance analysis
  - Training Max adjustment triggers
  - Long-term progression tracking

#### 4. Style Variants
- **STANDARD vs HYPERTROPHY**
  - Intensity curve differences
  - Volume considerations
  - Recovery implications
- **Customization Options**
  - Program duration flexibility
  - Training day configuration
  - Deload week customization

### TRAINING_MAX.md

#### 1. Training Max Concept
- **Definition and Purpose**
  - Training Max vs 1RM distinction
  - Conservative estimation approach
  - Safety and progression balance
- **Calculation Methods**
  - AMRAP-based calculations
  - Performance threshold analysis
  - Adjustment algorithms

#### 2. Adjustment System
- **Automatic Adjustments**
  - AMRAP performance triggers
  - Calculation algorithms
  - Guardrail implementation
- **Manual Adjustments**
  - TM event system
  - Reason tracking
  - Audit trail maintenance

#### 3. Guardrail System
- **Safety Constraints**
  - Maximum adjustment percentages
  - Absolute weight limits
  - Frequency restrictions
- **Validation Rules**
  - Input validation
  - Business logic constraints
  - Error handling

#### 4. Analytics and Tracking
- **Performance Metrics**
  - Adjustment frequency analysis
  - Progress trend tracking
  - Success rate monitoring
- **Reporting Features**
  - TM adjustment history
  - Summary statistics
  - Performance insights

---

## Development & Operations

### TESTING.md

#### 1. Testing Strategy
- **Testing Pyramid**
  - Unit test coverage goals
  - Integration test scope
  - E2E test scenarios
- **Test Organization**
  - Test file structure
  - Naming conventions
  - Test data management

#### 2. Unit Testing
- **Jest Configuration**
  - Test environment setup
  - Mocking strategies
  - Coverage reporting
- **Service Testing**
  - Business logic validation
  - Error handling testing
  - Edge case coverage

#### 3. E2E Testing
- **Supertest Integration**
  - API endpoint testing
  - Authentication flow testing
  - Data persistence validation
- **Test Database Management**
  - Test data seeding
  - Database cleanup
  - Isolation strategies

#### 4. Performance Testing
- **Load Testing**
  - Endpoint performance benchmarks
  - Database query optimization
  - Cache performance validation
- **Monitoring Integration**
  - Performance metrics collection
  - Regression detection
  - Optimization tracking

### DEPLOYMENT.md

#### 1. Production Deployment
- **Environment Setup**
  - Production environment configuration
  - Security hardening
  - Performance optimization
- **Database Management**
  - Migration deployment
  - Backup procedures
  - Monitoring setup

#### 2. CI/CD Pipeline
- **Build Process**
  - TypeScript compilation
  - Dependency management
  - Asset optimization
- **Deployment Automation**
  - Automated testing
  - Deployment scripts
  - Rollback procedures

#### 3. Monitoring and Observability
- **Application Monitoring**
  - Health check implementation
  - Performance metrics
  - Error tracking
- **Infrastructure Monitoring**
  - Database performance
  - Cache performance
  - System resource usage

---

## Reference Documentation

### CONFIGURATION.md

#### 1. Environment Variables
- **Required Variables**
  - Database configuration
  - Authentication secrets
  - External service keys
- **Optional Variables**
  - Feature flags
  - Performance tuning
  - Development options

#### 2. Application Configuration
- **Module Configuration**
  - Per-module settings
  - Feature toggles
  - Integration settings
- **Runtime Configuration**
  - Dynamic configuration
  - Configuration validation
  - Hot reloading support

#### 3. Security Configuration
- **Authentication Settings**
  - Token configuration
  - Session management
  - CORS settings
- **Data Protection**
  - Encryption settings
  - Data retention policies
  - Privacy compliance

### GLOSSARY.md

#### 1. Technical Terms
- **Architecture Terms**
  - Module, Service, Controller definitions
  - Dependency Injection concepts
  - Design pattern terminology
- **Domain Terms**
  - Training Max, RtF, AMRAP definitions
  - Exercise progression terminology
  - Workout session concepts

#### 2. Acronyms and Abbreviations
- **Technical Acronyms**
  - API, REST, JWT, CORS
  - ORM, SQL, NoSQL
  - CI/CD, DevOps terms
- **Domain Acronyms**
  - RtF, TM, AMRAP, RPE
  - Exercise and fitness terminology

#### 3. System-Specific Terms
- **Sunnsteel Concepts**
  - Custom terminology
  - Feature-specific terms
  - Business logic concepts
- **Implementation Terms**
  - Code-specific terminology
  - Configuration terms
  - Operational concepts

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Next Review**: February 2025  
**Owner**: Backend Development Team