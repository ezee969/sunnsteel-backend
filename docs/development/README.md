# Development & Operations

Guidelines, processes, and best practices for developing and maintaining the Sunnsteel Backend.

## 📋 Documentation Index

### **Development Setup**
- **[Local Development](LOCAL_DEVELOPMENT.md)** - Complete dev environment setup
- **[IDE Configuration](IDE_CONFIGURATION.md)** - VSCode/IDE setup and extensions
- **[Git Workflow](GIT_WORKFLOW.md)** - Branching strategy and commit conventions
- **[Code Standards](CODE_STANDARDS.md)** - Style guide and linting rules

### **Testing**
- **[Testing Strategy](TESTING_STRATEGY.md)** - Unit, integration, and e2e testing
- **[Test Setup](TEST_SETUP.md)** - Jest configuration and test database
- **[Writing Tests](WRITING_TESTS.md)** - Testing patterns and best practices
- **[Test Coverage](TEST_COVERAGE.md)** - Coverage requirements and reporting

### **Database Management**
- **[Migrations](MIGRATIONS.md)** - Creating and managing database migrations
- **[Seeding](SEEDING.md)** - Test data and database seeding
- **[Schema Changes](SCHEMA_CHANGES.md)** - Safe schema evolution practices
- **[Backup & Recovery](BACKUP_RECOVERY.md)** - Data protection strategies

### **Code Quality**
- **[Code Review](CODE_REVIEW.md)** - Review process and checklist
- **[Performance Guidelines](PERFORMANCE_GUIDELINES.md)** - Optimization best practices
- **[Security Guidelines](SECURITY_GUIDELINES.md)** - Security best practices
- **[Documentation Standards](DOCUMENTATION_STANDARDS.md)** - Code and API documentation

### **CI/CD & Automation**
- **[GitHub Actions](GITHUB_ACTIONS.md)** - CI/CD pipeline configuration
- **[Automated Testing](AUTOMATED_TESTING.md)** - Test automation in CI
- **[Code Quality Checks](CODE_QUALITY_CHECKS.md)** - Linting and formatting in CI
- **[Release Process](RELEASE_PROCESS.md)** - Version management and releases

## 🛠️ Development Tools

### **Required Tools**
- **Node.js** v18+ with npm
- **PostgreSQL** 14+ for local development
- **Redis** for caching (optional for basic dev)
- **Git** for version control

### **Recommended Tools**
- **VSCode** with NestJS extensions
- **Postman** for API testing
- **pgAdmin** for database management
- **Docker** for containerized services

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev
npx prisma db seed

# Start development server
npm run start:dev

# Run tests
npm run test
npm run test:e2e

# Code quality
npm run lint
npm run format
```

## 🧪 Manual API Testing

- Manual test file: `test/api-manual-tests.http`
- Fetch Supabase token helper: `npm run token:supabase` (runs `scripts/get-supabase-token.ps1`)
- Required env vars: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`
- Steps:
  1. Configure env in `.env`.
  2. Run `npm run token:supabase` to inject token into the manual test file.
  3. In your HTTP client, execute “Step 1: Verify Token” to set `@supabaseToken`.
  4. Call protected endpoints using `Authorization: Bearer {{supabaseToken}}`.

- Details: See `docs/reference/ENVIRONMENT_VARIABLES.md` and `docs/authentication/SUPABASE_AUTH.md`.

## 📊 Development Metrics

- **Test Coverage**: >90% target
- **Build Time**: <2 minutes
- **Startup Time**: <10 seconds
- **Code Quality**: ESLint + Prettier

---

*This documentation is part of the comprehensive Sunnsteel Backend documentation. Return to [main index](../README.md).*