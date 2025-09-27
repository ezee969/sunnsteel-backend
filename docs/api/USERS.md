# Users API

Complete reference for user management endpoints in the Sunnsteel Backend API.

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
- [Data Models](#data-models)
- [Error Handling](#error-handling)
- [Examples](#examples)

## Overview

The Users API provides endpoints for managing user profiles and account information. Currently, the API focuses on profile retrieval, with user creation and updates handled through the authentication system.

**Key Features:**
- User profile retrieval
- Supabase authentication integration
- Weight unit preferences (KG/LB)
- Secure data handling with password exclusion

## Authentication

All Users API endpoints require authentication via **Supabase JWT** tokens.

```http
Authorization: Bearer <supabase_jwt_token>
```

**Guard Used**: `SupabaseJwtGuard`

## Endpoints

### GET /api/users/profile

**Description**: Retrieve the authenticated user's profile information.

**Authentication**: Supabase JWT required

**Rate Limiting**: 100 requests per minute

**Request Parameters**: None

**Request Body**: None

**Response**:
```typescript
interface UserProfile {
  id: string                    // UUID
  email: string                 // User's email address
  name: string                  // User's display name
  supabaseUserId: string | null // Supabase user ID (if linked)
  weightUnit: 'KG' | 'LB'      // Preferred weight unit
  createdAt: string             // ISO 8601 timestamp
  updatedAt: string             // ISO 8601 timestamp
}
```

**Example Request**:
```http
GET /api/users/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Example Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john.doe@example.com",
  "name": "John Doe",
  "supabaseUserId": "auth0|507f1f77bcf86cd799439011",
  "weightUnit": "KG",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Success Status**: `200 OK`

## Data Models

### User Profile Model

```typescript
interface UserProfile {
  id: string                    // Unique user identifier (UUID)
  email: string                 // User's email address (unique)
  name: string                  // User's display name
  supabaseUserId: string | null // Supabase user ID for linked accounts
  weightUnit: WeightUnit        // Preferred weight unit
  createdAt: string             // Account creation timestamp
  updatedAt: string             // Last profile update timestamp
}
```

### Weight Unit Enum

```typescript
enum WeightUnit {
  KG = 'KG',    // Kilograms
  LB = 'LB'     // Pounds
}
```

**Default Value**: `KG`

### Security Notes

- **Password Excluded**: User passwords are never returned in API responses
- **Selective Fields**: Only safe profile fields are exposed
- **Authentication Required**: All endpoints require valid authentication

## Error Handling

### Common Error Responses

**401 Unauthorized**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**404 Not Found** (User not found):
```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```

**429 Too Many Requests**:
```json
{
  "statusCode": 429,
  "message": "Too many requests",
  "error": "Too Many Requests"
}
```

**500 Internal Server Error**:
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

### Error Scenarios

- **Invalid Token**: Malformed or expired JWT token
- **User Not Found**: User exists in token but not in database
- **Database Error**: Connection or query issues
- **Rate Limit Exceeded**: Too many requests from client

## Examples

### Complete Profile Retrieval Flow

```bash
# 1. Authenticate with Supabase (handled by frontend)
# 2. Get user profile
curl -X GET "http://localhost:4000/api/users/profile" \
  -H "Authorization: Bearer <supabase_jwt_token>" \
  -H "Content-Type: application/json"

# Expected response
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john.doe@example.com",
  "name": "John Doe",
  "supabaseUserId": "auth0|507f1f77bcf86cd799439011",
  "weightUnit": "KG",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### Error Handling Example

```bash
# Request without authentication
curl -X GET "http://localhost:4000/api/users/profile"

# Response: 401 Unauthorized
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### JavaScript/TypeScript Integration

```typescript
// Frontend integration example
interface UserProfile {
  id: string
  email: string
  name: string
  supabaseUserId: string | null
  weightUnit: 'KG' | 'LB'
  createdAt: string
  updatedAt: string
}

async function getUserProfile(token: string): Promise<UserProfile> {
  const response = await fetch('/api/users/profile', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

// Usage
try {
  const profile = await getUserProfile(supabaseToken)
  console.log(`Welcome, ${profile.name}!`)
  console.log(`Preferred unit: ${profile.weightUnit}`)
} catch (error) {
  console.error('Failed to fetch profile:', error)
}
```

## Future Endpoints

The following endpoints are planned for future releases:

- **PATCH /api/users/profile** - Update user profile
- **PATCH /api/users/preferences** - Update user preferences
- **DELETE /api/users/account** - Delete user account
- **GET /api/users/stats** - User activity statistics

## Related Documentation

- [Authentication API](AUTHENTICATION.md) - User authentication and registration
- [Architecture: Authentication](../architecture/AUTHENTICATION.md) - System design
- [Supabase Integration](../features/SUPABASE_INTEGRATION.md) - Supabase auth details
- [Error Handling](ERROR_HANDLING.md) - Complete error reference
- [Rate Limiting](RATE_LIMITING.md) - Request throttling details

## Integration Notes

### Frontend Integration
- Use Supabase client for authentication
- Store JWT token securely (not in localStorage)
- Handle token refresh automatically
- Implement proper error handling

### Backend Integration
- User profile is automatically available after authentication
- Use `req.user` object in controllers for user context
- Profile data is cached for performance
- Database queries are optimized with selective fields

---

**Last Updated**: January 2025  
**API Version**: 1.0  
**Authentication**: Supabase JWT Required