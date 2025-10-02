# Architecture Documentation

This section covers the system architecture, design patterns, and technical decisions behind the Sunnsteel Backend API.

## 📋 Documentation Index

- **[System Overview](SYSTEM_OVERVIEW.md)** - High-level architecture and components
- **[Module Architecture](MODULE_ARCHITECTURE.md)** - NestJS module organization
- **[Database Design](DATABASE_DESIGN.md)** - Schema design and relationships
- **[Caching Strategy](CACHING_STRATEGY.md)** - Multi-layer cache architecture
- **[Security Model](SECURITY_MODEL.md)** - Security patterns and practices
- **[Performance Considerations](PERFORMANCE.md)** - Optimization strategies

## 🏗️ Key Architectural Patterns

### **Modular Architecture**
- Feature-based module organization
- Clear separation of concerns
- Dependency injection with NestJS IoC

### **Authentication System**
- Supabase Auth integration
- JWT Bearer token validation
- User synchronization with local database

### **Multi-Layer Caching**
- L1: In-memory cache
- L2: Redis distributed cache
- Cache invalidation strategies

### **Database Patterns**
- Prisma ORM with type safety
- Connection pooling
- Optimized query patterns

## 🔄 Data Flow

```
Client Request → Guards → Controllers → Services → Database
                    ↓
              Cache Layer ← Business Logic
```

## 📊 Technology Stack

- **Framework**: NestJS v11.0.1
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Supabase Auth with JWT Bearer tokens
- **Caching**: Redis with layered architecture
- **Monitoring**: Prometheus metrics

---

*This documentation is part of the comprehensive Sunnsteel Backend documentation. Return to [main index](../README.md).*