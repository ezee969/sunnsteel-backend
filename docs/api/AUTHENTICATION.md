# Authentication API

Complete reference for authentication endpoints, flows, and security implementation in the Sunnsteel Backend API.

## 📋 Table of Contents

- [Overview](#overview)
- [Authentication Methods](#authentication-methods)
- [Legacy JWT Endpoints](#legacy-jwt-endpoints)
- [Supabase Authentication](#supabase-authentication)
- [Google Authentication](#google-authentication)
- [Token Management](#token-management)
- [Security Features](#security-features)
- [Error Handling](#error-handling)
- [Examples](#examples)

## Overview

The Sunnsteel Backend API implements a **dual authentication system**:

- **Supabase Authentication** (Primary) - Modern, secure authentication with external provider support
- **Legacy JWT Authentication** - Maintained for backward compatibility

All API endpoints require authentication via one of these methods. New integrations should use Supabase authentication.

## Authentication Methods

### Supabase JWT (Recommended)
```http
Authorization: Bearer <supabase_jwt_token>
```

### Legacy JWT (Deprecated)
```http
Authorization: Bearer <legacy_jwt_token>
```

### Session Cookies
- `refresh_token` - HttpOnly cookie for token refresh
- `has_session` - Client-readable session indicator

## Legacy JWT Endpoints

### POST /api/auth/register

**Description**: Register a new user account with email and password.

**Authentication**: None required

**Rate Limiting**: 100 requests per minute

**Request Body**:
```typescript
interface RegisterDto {
  email: string     // Valid email address
  password: string  // Minimum 6 characters
  name: string      // User's display name
}
```

**Response**:
```typescript
interface RegisterResponse {
  user: {
    id: string
    email: string
    name: string
    createdAt: string
  }
  accessToken: string
}
```

**Example Request**:
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "John Doe"
}
```

**Example Response**:
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Cookies Set**:
- `refresh_token` (HttpOnly, 7 days)
- `has_session` (7 days)

---

### POST /api/auth/login

**Description**: Authenticate user with email and password.

**Authentication**: None required

**Rate Limiting**: 100 requests per minute

**Request Body**:
```typescript
interface LoginDto {
  email: string     // Registered email address
  password: string  // User's password
}
```

**Response**: Same as register response

**Example Request**:
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

---

### POST /api/auth/refresh

**Description**: Refresh access token using refresh token cookie.

**Authentication**: Refresh token cookie required

**Rate Limiting**: 100 requests per minute

**Request Body**: None

**Response**:
```typescript
interface RefreshResponse {
  accessToken: string
}
```

**Example Request**:
```http
POST /api/auth/refresh
Cookie: refresh_token=<refresh_token>
```

**Example Response**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### POST /api/auth/logout

**Description**: Logout user and blacklist current token.

**Authentication**: JWT token required

**Rate Limiting**: 100 requests per minute

**Request Body**: None

**Response**:
```typescript
interface LogoutResponse {
  message: string
}
```

**Example Request**:
```http
POST /api/auth/logout
Authorization: Bearer <access_token>
```

**Example Response**:
```json
{
  "message": "Logged out successfully"
}
```

**Cookies Cleared**:
- `refresh_token`
- `has_session`

## Supabase Authentication

### POST /api/auth/supabase/verify

**Description**: Verify Supabase JWT token and sync user data.

**Authentication**: Supabase JWT token required

**Rate Limiting**: 100 requests per minute

**Request Body**:
```typescript
interface SupabaseTokenDto {
  token: string  // Supabase JWT token
}
```

**Response**:
```typescript
interface SupabaseVerifyResponse {
  user: {
    id: string
    email: string
    name: string
    supabaseUserId: string
    createdAt: string
    updatedAt: string
  }
  isNewUser: boolean
}
```

**Example Request**:
```http
POST /api/auth/supabase/verify
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Example Response**:
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "supabaseUserId": "auth0|507f1f77bcf86cd799439011",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "isNewUser": false
}
```

## Google Authentication

### POST /api/auth/google

**Description**: Authenticate user with Google ID token.

**Authentication**: None required

**Rate Limiting**: 100 requests per minute

**Request Body**:
```typescript
interface GoogleAuthDto {
  idToken: string  // Google ID token from client
}
```

**Response**: Same as register response

**Example Request**:
```http
POST /api/auth/google
Content-Type: application/json

{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2NzAyN..."
}
```

## Token Management

### Access Tokens
- **Lifetime**: 15 minutes
- **Type**: JWT
- **Usage**: API request authorization
- **Storage**: Client memory (not localStorage)

### Refresh Tokens
- **Lifetime**: 7 days
- **Type**: Secure random string
- **Usage**: Access token renewal
- **Storage**: HttpOnly cookie

### Token Blacklisting
- Tokens are blacklisted on logout
- Blacklisted tokens are rejected immediately
- Cleanup occurs automatically

## Security Features

### Cookie Security
```typescript
const cookieOptions = {
  httpOnly: true,           // Prevent XSS
  secure: NODE_ENV === 'production',  // HTTPS only in production
  sameSite: 'lax',         // CSRF protection
  path: '/',               // Available site-wide
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
}
```

### Rate Limiting
- **Global**: 100 requests per minute per IP
- **Authentication**: Additional throttling on auth endpoints
- **Headers**: Rate limit info in response headers

### CORS Configuration
- **Origin**: Configurable frontend URL
- **Credentials**: Enabled for cookie support
- **Methods**: GET, POST, PATCH, DELETE
- **Headers**: Authorization, Content-Type

## Error Handling

### Common Error Responses

**400 Bad Request**:
```json
{
  "statusCode": 400,
  "message": ["Password must be at least 6 characters"],
  "error": "Bad Request"
}
```

**401 Unauthorized**:
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
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

### Validation Errors
- Email format validation
- Password strength requirements
- Required field validation
- Token format validation

## Examples

### Complete Authentication Flow

```bash
# 1. Register new user
curl -X POST "http://localhost:4000/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepassword123",
    "name": "John Doe"
  }'

# 2. Use access token for API requests
curl -X GET "http://localhost:4000/api/users/profile" \
  -H "Authorization: Bearer <access_token>"

# 3. Refresh token when expired
curl -X POST "http://localhost:4000/api/auth/refresh" \
  -H "Cookie: refresh_token=<refresh_token>"

# 4. Logout when done
curl -X POST "http://localhost:4000/api/auth/logout" \
  -H "Authorization: Bearer <access_token>"
```

### Supabase Authentication Flow

```bash
# 1. Verify Supabase token
curl -X POST "http://localhost:4000/api/auth/supabase/verify" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<supabase_jwt_token>"
  }'

# 2. Use Supabase token for API requests
curl -X GET "http://localhost:4000/api/users/profile" \
  -H "Authorization: Bearer <supabase_jwt_token>"
```

## Related Documentation

- [Architecture: Authentication](../architecture/AUTHENTICATION.md) - System design
- [Users API](USERS.md) - User management endpoints
- [Error Handling](ERROR_HANDLING.md) - Complete error reference
- [Rate Limiting](RATE_LIMITING.md) - Throttling details