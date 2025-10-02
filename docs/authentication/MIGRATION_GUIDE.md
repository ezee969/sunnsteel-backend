# Legacy Authentication Migration Guide

## Overview

This document explains the migration from the legacy Passport.js-based authentication system to Supabase authentication.

## What Changed

### Before (Legacy System)

```typescript
// ❌ Old: Custom JWT tokens with bcrypt passwords
POST /api/auth/register
POST /api/auth/login
POST /api/auth/google
POST /api/auth/logout
POST /api/auth/refresh

// Used PassportLocalGuard and JwtAuthGuard
@UseGuards(PassportLocalGuard)
@UseGuards(JwtAuthGuard)
```

**Components Removed:**
- `PassportLocalGuard` - Email/password authentication
- `JwtAuthGuard` - Custom JWT token validation
- `LocalStrategy` - Passport local strategy
- `JwtStrategy` - Passport JWT strategy
- Custom JWT token generation and refresh logic
- Bcrypt password hashing for new registrations

### After (Current System)

```typescript
// ✅ New: Supabase authentication
POST /api/auth/supabase/verify
GET /api/auth/supabase/profile
POST /api/auth/supabase/logout

// Uses SupabaseJwtGuard
@UseGuards(SupabaseJwtGuard)
```

**Active Components:**
- `SupabaseJwtGuard` - Validates Supabase JWT tokens
- `SupabaseJwtStrategy` - Bearer token strategy
- `SupabaseService` - Token verification and user sync
- Supabase handles all auth operations

## Migration Steps

### 1. Frontend Changes

#### Before: Custom Auth

```typescript
// ❌ Old: Custom registration
const response = await fetch('/api/auth/register', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email, password, name })
})
const { accessToken, user } = await response.json()

// Store token
localStorage.setItem('token', accessToken)
```

#### After: Supabase Auth

```typescript
// ✅ New: Supabase registration
import { supabase } from '@/lib/supabase/client'

const { data, error } = await supabase.auth.signUp({
	email,
	password,
	options: {
		data: { name } // User metadata
	}
})

if (data.session) {
	// Token automatically managed by Supabase
	const token = data.session.access_token
}
```

### 2. Login Changes

#### Before: Email/Password Login

```typescript
// ❌ Old: Custom login
const response = await fetch('/api/auth/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ email, password })
})
const { accessToken } = await response.json()
```

#### After: Supabase Login

```typescript
// ✅ New: Supabase login
const { data, error } = await supabase.auth.signInWithPassword({
	email,
	password
})

if (data.session) {
	const token = data.session.access_token
	// Use token for API requests
}
```

### 3. OAuth Changes

#### Before: Google OAuth

```typescript
// ❌ Old: Send Google ID token to backend
const response = await fetch('/api/auth/google', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ idToken: googleIdToken })
})
```

#### After: Supabase OAuth

```typescript
// ✅ New: Supabase OAuth
const { data, error } = await supabase.auth.signInWithOAuth({
	provider: 'google',
	options: {
		redirectTo: `${window.location.origin}/auth/callback`
	}
})

// Supabase handles OAuth flow automatically
```

### 4. API Request Changes

#### Before: Custom JWT Header

```typescript
// ❌ Old: Custom JWT token
const token = localStorage.getItem('token')

const response = await fetch('/api/routines', {
	headers: {
		'Authorization': `Bearer ${token}`, // Custom JWT
		'Content-Type': 'application/json'
	}
})
```

#### After: Supabase JWT Header

```typescript
// ✅ New: Supabase JWT token
const { data: { session } } = await supabase.auth.getSession()

if (session) {
	const response = await fetch('/api/routines', {
		headers: {
			'Authorization': `Bearer ${session.access_token}`, // Supabase JWT
			'Content-Type': 'application/json'
		}
	})
}
```

### 5. Session Management Changes

#### Before: Manual Refresh

```typescript
// ❌ Old: Manual token refresh
const refreshToken = getCookie('refresh_token')

const response = await fetch('/api/auth/refresh', {
	method: 'POST',
	credentials: 'include'
})
const { accessToken } = await response.json()
```

#### After: Automatic Refresh

```typescript
// ✅ New: Supabase auto-refresh
supabase.auth.onAuthStateChange((event, session) => {
	if (event === 'TOKEN_REFRESHED') {
		console.log('Token refreshed automatically')
		// Use session.access_token for new requests
	}
})

// Supabase automatically refreshes tokens before expiry
```

### 6. Logout Changes

#### Before: Clear Custom Tokens

```typescript
// ❌ Old: Clear custom JWT and cookies
await fetch('/api/auth/logout', {
	method: 'POST',
	credentials: 'include'
})
localStorage.removeItem('token')
```

#### After: Supabase Logout

```typescript
// ✅ New: Supabase logout
await supabase.auth.signOut()

// Optionally clear backend cookies
await fetch('/api/auth/supabase/logout', {
	method: 'POST'
})
```

## Backend Changes

### 1. Route Protection

#### Before: Multiple Guards

```typescript
// ❌ Old: Different guards for different endpoints
import { JwtAuthGuard } from './auth/guards/passport-jwt.guard'
import { PassportLocalGuard } from './auth/guards/passport-local.guard'

@Controller('routines')
export class RoutinesController {
	@UseGuards(JwtAuthGuard) // Custom JWT guard
	@Get()
	async findAll(@Req() req) {
		const userId = req.user.userId
	}
}
```

#### After: Single Supabase Guard

```typescript
// ✅ New: One guard for all protected routes
import { SupabaseJwtGuard } from './auth/guards/supabase-jwt.guard'

@Controller('routines')
@UseGuards(SupabaseJwtGuard) // Applied to entire controller
export class RoutinesController {
	@Get()
	async findAll(@Req() req) {
		const userId = req.user.id // User from Supabase
	}
}
```

### 2. User Access

#### Before: Custom JWT Payload

```typescript
// ❌ Old: req.user from custom JWT
interface JwtPayload {
	sub: string // User ID
	email: string
}

@Get()
async findAll(@Req() req) {
	const userId = req.user.userId // From JWT payload
	const email = req.user.email
}
```

#### After: Supabase User Object

```typescript
// ✅ New: req.user is full User entity from database
import { User } from '@prisma/client'

@Get()
async findAll(@Req() req) {
	const user: User = req.user // Complete user from DB
	const userId = user.id
	const email = user.email
	const name = user.name
	const supabaseUserId = user.supabaseUserId
}
```

## Database Schema Changes

### User Model Updates

```prisma
model User {
	id             String    @id @default(uuid())
	email          String    @unique
	name           String
	password       String?   // Now optional (legacy users only)
	supabaseUserId String?   @unique @map("supabase_user_id") // New field
	
	@@map("users")
}
```

**Migration SQL:**

```sql
-- Add supabaseUserId column
ALTER TABLE users 
ADD COLUMN supabase_user_id VARCHAR(255) UNIQUE;

-- Make password optional (for Supabase-only users)
ALTER TABLE users 
ALTER COLUMN password DROP NOT NULL;

-- Create index for faster lookups
CREATE INDEX idx_users_supabase_user_id 
ON users(supabase_user_id);
```

## Backward Compatibility

### Legacy User Migration

Existing users with bcrypt passwords can be migrated:

1. **Automatic linking:** When a Supabase user signs in with an email that exists in your database, the system automatically links them:

```typescript
// In SupabaseService.getOrCreateUser()
async getOrCreateUser(supabaseUser: SupabaseUser) {
	// Try to find by supabaseUserId first
	let user = await this.db.user.findUnique({
		where: { supabaseUserId: supabaseUser.id }
	})
	
	if (user) return user
	
	// If not found, try by email (for migration)
	user = await this.db.user.findUnique({
		where: { email: supabaseUser.email }
	})
	
	if (user) {
		// Link existing user to Supabase
		return this.db.user.update({
			where: { id: user.id },
			data: { supabaseUserId: supabaseUser.id }
		})
	}
	
	// Create new user if not found
	return this.db.user.create({
		data: {
			email: supabaseUser.email,
			name: supabaseUser.user_metadata?.name,
			supabaseUserId: supabaseUser.id
		}
	})
}
```

2. **User migration endpoint** (optional):

```typescript
// POST /api/auth/supabase/migrate
// For users who want to migrate their old account
@Post('migrate')
async migrateUser(@Body() dto: UserMigrationDto) {
	const { email, password } = dto
	
	// Validate old credentials
	const user = await this.usersService.findByEmailWithPassword(email)
	const isValid = await bcrypt.compare(password, user.password)
	
	if (!isValid) {
		throw new UnauthorizedException('Invalid credentials')
	}
	
	// Create Supabase account with same email
	// User must verify email and set new password
	return { message: 'Migration initiated. Check your email.' }
}
```

## Testing Changes

### E2E Test Updates

#### Before: Custom Auth in Tests

```typescript
// ❌ Old: Create user and get JWT
const testUser = { email: 'test@example.com', password: 'test123' }

const registerRes = await request(app.getHttpServer())
	.post('/api/auth/register')
	.send(testUser)

const token = registerRes.body.accessToken

await request(app.getHttpServer())
	.get('/api/routines')
	.set('Authorization', `Bearer ${token}`)
	.expect(200)
```

#### After: Supabase Auth in Tests

```typescript
// ✅ New: Create Supabase user and use their token
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data } = await supabase.auth.admin.createUser({
	email: 'test@example.com',
	password: 'test123',
	email_confirm: true
})

const { data: session } = await supabase.auth.signInWithPassword({
	email: 'test@example.com',
	password: 'test123'
})

const token = session.session.access_token

await request(app.getHttpServer())
	.get('/api/routines')
	.set('Authorization', `Bearer ${token}`)
	.expect(200)
```

## Deprecated Code Reference

### Files Marked as Deprecated

These files are kept for backward compatibility but are no longer actively used:

- ✏️ `src/auth/auth.controller.ts` - Legacy endpoints (deprecated)
- ✏️ `src/auth/auth.service.ts` - Legacy auth methods (deprecated)
- ❌ `src/auth/strategies/local.strategy.ts` - Should be removed
- ❌ `src/auth/strategies/jwt.strategy.ts` - Should be removed
- ❌ `src/auth/guards/passport-local.guard.ts` - Should be removed
- ❌ `src/auth/guards/passport-jwt.guard.ts` - Should be removed

### Dependencies to Consider Removing

Once all legacy code is removed:

```json
{
	"dependencies": {
		"passport-local": "^1.0.0",     // ❌ Remove
		"passport-jwt": "^4.0.1",       // ❌ Remove
		"bcrypt": "^5.1.1",             // ❌ Remove (if not used elsewhere)
		"@types/passport-local": "...", // ❌ Remove
		"@types/passport-jwt": "..."    // ❌ Remove
	}
}
```

**Keep these:**
- `@nestjs/passport` - Still used for Supabase strategy
- `passport` - Required by @nestjs/passport
- `passport-http-bearer` - Used by SupabaseJwtStrategy

## Common Issues

### Issue 1: "Cannot find user" errors

**Cause:** User exists in Supabase but not in local database

**Solution:** The `getOrCreateUser()` method should handle this automatically. If not:

```typescript
// Manually sync user
const { data: { user } } = await supabase.auth.getUser(token)
await supabaseService.getOrCreateUser(user)
```

### Issue 2: Old tokens still work

**Cause:** Legacy JWT tokens not properly invalidated

**Solution:** 
- Clear all `refresh_token` cookies on client side
- Wait for old JWT tokens to expire (default 15 minutes)
- Optionally: Clear token blacklist in Redis

### Issue 3: CORS errors after migration

**Cause:** Supabase requests to different origin

**Solution:** Update CORS configuration:

```typescript
// main.ts
app.enableCors({
	origin: [
		'http://localhost:3000',
		'https://app.sunsteel.com',
		process.env.SUPABASE_URL // Add Supabase URL
	],
	credentials: true
})
```

## Rollback Plan

If critical issues arise, you can temporarily re-enable legacy auth:

1. **Re-export legacy guards** in `auth.module.ts`:
```typescript
exports: [AuthService, JwtAuthGuard, SupabaseJwtGuard, SupabaseService]
```

2. **Re-import legacy strategies**:
```typescript
providers: [
	AuthService,
	LocalStrategy,
	JwtStrategy,
	SupabaseJwtStrategy,
	// ...
]
```

3. **Re-enable legacy endpoints** by uncommenting in `auth.controller.ts`

4. **Switch guards** on affected controllers back to `JwtAuthGuard`

## Timeline

- **Phase 1:** ✅ Supabase implementation complete
- **Phase 2:** ✅ Legacy code marked as deprecated
- **Phase 3:** ⏳ Monitor for 2 weeks
- **Phase 4:** 📅 Remove legacy code after verification
- **Phase 5:** 📅 Remove unused dependencies

---

**Last Updated:** October 2, 2025  
**Migration Status:** Phase 2 Complete  
**Recommended Next Steps:** Monitor production for 2 weeks before removing legacy code
