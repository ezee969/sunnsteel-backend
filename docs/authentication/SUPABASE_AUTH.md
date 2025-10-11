# Supabase Authentication Implementation

## Overview

The SunSteel API uses **Supabase Authentication** for all user authentication and authorization.

## Architecture

### Authentication Flow

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Frontend  │────────▶│  Supabase    │────────▶│  SunSteel   │
│  (Next.js)  │  Auth   │  Auth Server │  Token  │  API        │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │                        │
      │  1. Sign In/Up         │                        │
      │───────────────────────▶│                        │
      │                        │                        │
      │  2. JWT Token          │                        │
      │◀───────────────────────│                        │
      │                        │                        │
      │  3. API Request        │                        │
      │  Authorization: Bearer <token>                  │
      │────────────────────────────────────────────────▶│
      │                        │                        │
      │                        │  4. Verify Token       │
      │                        │◀───────────────────────│
      │                        │                        │
      │                        │  5. User Info          │
      │                        │───────────────────────▶│
      │                        │                        │
      │  6. Protected Resource │                        │
      │◀────────────────────────────────────────────────│
```

### Components

#### 1. **SupabaseService** (`src/auth/supabase.service.ts`)

Core service for Supabase authentication:

- **`verifyToken(token: string)`** - Validates Supabase JWT tokens
- **`getOrCreateUser(supabaseUser)`** - Syncs Supabase users to local database
- **`getUserBySupabaseId(id)`** - Retrieves user by Supabase ID

```typescript
// Example: Verify token and get user
const supabaseUser = await supabaseService.verifyToken(token)
const localUser = await supabaseService.getOrCreateUser(supabaseUser)
```

#### 2. **SupabaseJwtStrategy** (`src/auth/strategies/supabase-jwt.strategy.ts`)

Passport strategy using Bearer token authentication:

- Extends `passport-http-bearer` strategy
- Extracts token from `Authorization: Bearer <token>` header
- Validates with Supabase and syncs to local database
- Attaches user to `req.user`

#### 3. **SupabaseJwtGuard** (`src/auth/guards/supabase-jwt.guard.ts`)

NestJS guard for protecting routes:

```typescript
@Controller('routines')
@UseGuards(SupabaseJwtGuard)
export class RoutinesController {
	// All routes are protected
	@Get()
	async findAll(@Req() req: RequestWithUser) {
		const userId = req.user.id // User from Supabase
		// ...
	}
}
```

#### 4. **SupabaseAuthController** (`src/auth/supabase-auth.controller.ts`)

API endpoints for Supabase auth operations:

- **`POST /api/auth/supabase/verify`** - Verify Supabase token and get user
- **`GET /api/auth/supabase/profile`** - Get user profile (protected)
- **`POST /api/auth/supabase/logout`** - Clear session cookies

## API Endpoints

### Authentication Endpoints

#### Verify Token

Verifies a Supabase JWT token and returns user information.

**Endpoint:** `POST /api/auth/supabase/verify`

**Request:**
```json
{
	"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
	"user": {
		"id": "uuid",
		"email": "user@example.com",
		"name": "John Doe",
		"supabaseUserId": "supabase-uuid",
		"weightUnit": "kg"
	},
	"message": "Token verified successfully"
}
```

**Cookies Set:**
- `ss_session` - HttpOnly session cookie (7 days)

#### Get Profile

Retrieves the authenticated user's profile.

**Endpoint:** `GET /api/auth/supabase/profile`

**Headers:**
```
Authorization: Bearer <supabase_token>
```

**Response:**
```json
{
	"user": {
		"id": "uuid",
		"email": "user@example.com",
		"name": "John Doe",
		"supabaseUserId": "supabase-uuid",
		"weightUnit": "kg",
		"createdAt": "2024-01-01T00:00:00.000Z",
		"updatedAt": "2024-01-01T00:00:00.000Z"
	}
}
```

#### Logout

Clears session cookies.

**Endpoint:** `POST /api/auth/supabase/logout`

**Response:**
```json
{
	"message": "Logged out successfully"
}
```

### Protected Endpoints

All protected endpoints require the `Authorization` header:

```
Authorization: Bearer <supabase_jwt_token>
```

**Protected Routes:**
- `/api/routines/*` - Routine management
- `/api/workouts/*` - Workout tracking
- `/api/exercises/*` - Exercise library
- `/api/users/*` - User profile management

## Frontend Integration

### Setup Supabase Client

```typescript
// lib/supabase/client.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
	process.env.NEXT_PUBLIC_SUPABASE_URL!,
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

### Sign Up

```typescript
const { data, error } = await supabase.auth.signUp({
	email: 'user@example.com',
	password: 'secure-password'
})

if (data.session) {
	// Use data.session.access_token for API calls
}
```

### Sign In

```typescript
const { data, error } = await supabase.auth.signInWithPassword({
	email: 'user@example.com',
	password: 'secure-password'
})

if (data.session) {
	const accessToken = data.session.access_token
	// Use accessToken in API requests
}
```

### Sign In with OAuth (Google, GitHub, etc.)

```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
	provider: 'google',
	options: {
		redirectTo: `${window.location.origin}/auth/callback`
	}
})
```

### Making Authenticated API Requests

```typescript
// Get current session
const { data: { session } } = await supabase.auth.getSession()

if (session) {
	// Make API request with token
	const response = await fetch('https://api.sunsteel.com/api/routines', {
		headers: {
			'Authorization': `Bearer ${session.access_token}`,
			'Content-Type': 'application/json'
		}
	})
}
```

### Using with TanStack Query

```typescript
// hooks/useRoutines.ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export function useRoutines() {
	return useQuery({
		queryKey: ['routines'],
		queryFn: async () => {
			const { data: { session } } = await supabase.auth.getSession()
			
			if (!session) throw new Error('Not authenticated')
			
			const response = await fetch('/api/routines', {
				headers: {
					'Authorization': `Bearer ${session.access_token}`
				}
			})
			
			return response.json()
		}
	})
}
```

### Session Management

```typescript
// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
	if (event === 'SIGNED_IN') {
		// User signed in
		console.log('Access token:', session?.access_token)
	}
	
	if (event === 'SIGNED_OUT') {
		// User signed out
		// Clear local state
	}
	
	if (event === 'TOKEN_REFRESHED') {
		// Token was refreshed
		console.log('New token:', session?.access_token)
	}
})
```

### Sign Out

```typescript
await supabase.auth.signOut()

// Also call backend logout endpoint to clear cookies
await fetch('/api/auth/supabase/logout', {
	method: 'POST'
})
```

## Database Schema

### User Model

```prisma
model User {
	id             String    @id @default(uuid())
	email          String    @unique
	name           String
	supabaseUserId String?   @unique @map("supabase_user_id")
	weightUnit     String    @default("kg")
	createdAt      DateTime  @default(now()) @map("created_at")
	updatedAt      DateTime  @updatedAt @map("updated_at")
	
	// Relations
	routines       Routine[]
	workouts       Workout[]
	
	@@map("users")
}
```

**Key Fields:**
- `supabaseUserId` - Links local user to Supabase auth user
- Used for user lookup and synchronization

## Environment Variables

Required environment variables:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Database
DATABASE_URL=postgresql://...
```

**Security Notes:**
- `SUPABASE_ANON_KEY` - Safe to expose in frontend
- `SUPABASE_SERVICE_ROLE_KEY` - **Backend only**, bypasses RLS

## Security Considerations

### Token Validation

1. **Frontend sends Supabase token** - Generated by Supabase Auth
2. **Backend validates with Supabase** - Using `supabase.auth.getUser(token)`
3. **No custom JWT signing** - Supabase handles all token operations
4. **Automatic token refresh** - Handled by Supabase client

### Row Level Security (RLS)

While we validate tokens in the API, Supabase RLS provides an additional security layer:

```sql
-- Example RLS policy
CREATE POLICY "Users can only access their own routines"
ON routines FOR SELECT
USING (auth.uid() = user_id);
```

### Best Practices

✅ **DO:**
- Always validate tokens on the backend
- Use `SupabaseJwtGuard` for protected routes
- Store tokens securely (httpOnly cookies preferred)
- Implement proper error handling for expired tokens

❌ **DON'T:**
- Store tokens in localStorage (XSS vulnerable)
- Trust client-side token validation
- Expose `SUPABASE_SERVICE_ROLE_KEY` to frontend
- Use custom JWT signing (let Supabase handle it)

## Testing

### E2E Tests with Supabase

```typescript
// Create test user in Supabase
const { data } = await supabase.auth.signUp({
	email: 'test@example.com',
	password: 'test123456'
})

const token = data.session?.access_token

// Make authenticated request
await request(app.getHttpServer())
	.get('/api/routines')
	.set('Authorization', `Bearer ${token}`)
	.expect(200)
```

### Unit Tests

Mock the SupabaseService:

```typescript
const mockSupabaseService = {
	verifyToken: jest.fn().mockResolvedValue({
		id: 'supabase-user-id',
		email: 'test@example.com'
	}),
	getOrCreateUser: jest.fn().mockResolvedValue({
		id: 'local-user-id',
		email: 'test@example.com',
		supabaseUserId: 'supabase-user-id'
	})
}
```

## Troubleshooting

### "Invalid token" errors

**Causes:**
- Token expired (default 1 hour)
- Token not from correct Supabase project
- Token tampered with

**Solutions:**
- Refresh token using `supabase.auth.getSession()`
- Verify `SUPABASE_URL` matches frontend/backend
- Check token is sent correctly in Authorization header

### User not syncing to database

**Causes:**
- Database connection issue
- `supabaseUserId` field missing
- Email conflict (user already exists with different ID)

**Solutions:**
- Check database connection
- Run migrations: `npx prisma migrate deploy`
- Check logs for `getOrCreateUser()` errors

### CORS issues

**Causes:**
- Frontend origin not whitelisted
- Preflight requests failing

**Solutions:**
- Add frontend URL to CORS whitelist in `main.ts`
- Check `Access-Control-Allow-Origin` headers

## Additional Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [NestJS Guards](https://docs.nestjs.com/guards)
- [Passport HTTP Bearer Strategy](http://www.passportjs.org/packages/passport-http-bearer/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

---

**Last Updated:** October 2, 2025  
**Version:** 1.0.0
