# API Documentation

Complete reference for the Sunnsteel Backend API endpoints, authentication, and usage patterns.

## 📋 Documentation Index

### **Core API Reference**
- **[Users](USERS.md)** ✅ - User management endpoints
- **[Exercises](EXERCISES.md)** - Exercise catalog endpoints
- **[Routines](ROUTINES.md)** - Routine management endpoints
- **[Workouts](WORKOUTS.md)** - Workout session endpoints
- **[Training Max](TRAINING_MAX.md)** - TM adjustment endpoints

### **Authentication**
See **[Authentication Documentation](../authentication/)** for complete authentication guide:
- [Supabase Auth Implementation](../authentication/SUPABASE_AUTH.md)
- [Quick Reference](../authentication/QUICK_REFERENCE.md)
- [Migration Guide](../authentication/MIGRATION_GUIDE.md)

### **API Guides**
- **[Quick Reference](QUICK_REFERENCE.md)** - Common endpoints cheat sheet
- **[Error Handling](ERROR_HANDLING.md)** - Error codes and responses
- **[Rate Limiting](RATE_LIMITING.md)** - Request limits and throttling
- **[Pagination](PAGINATION.md)** - List endpoint pagination
- **[Filtering](FILTERING.md)** - Query parameters and filters

### **Advanced Features**
- **[RtF Programs](RTF_PROGRAMS.md)** - Reps-to-Failure program endpoints
- **[Caching](CACHING.md)** - Cache headers and ETag support
- **[Webhooks](WEBHOOKS.md)** - Event notifications (future)

## 🚀 Base URL

```
Development: http://localhost:4000/api
Production: https://api.sunnsteel.com/api
```

## 🔐 Authentication

All API endpoints require authentication via Supabase JWT Bearer tokens:

```bash
# Example authenticated request
curl -H "Authorization: Bearer <supabase_token>" \
     https://api.sunnsteel.com/api/users/profile
```

For complete authentication documentation, see [Authentication Guide](../authentication/SUPABASE_AUTH.md).

## 📊 Response Format

All API responses follow a consistent format:

```json
{
  "data": { /* response data */ },
  "meta": { /* pagination, etc */ },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 🔗 Quick Links

- **[Getting Started](../getting-started/README.md)** - Setup and first API call
- **[Authentication](../authentication/SUPABASE_AUTH.md)** - Supabase auth architecture
- **[Postman Collection](POSTMAN_COLLECTION.md)** - Import ready-to-use requests

---

*This documentation is part of the comprehensive Sunnsteel Backend documentation. Return to [main index](../README.md).*