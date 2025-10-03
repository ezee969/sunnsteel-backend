# Quick Reference: Supabase Authentication

## 🚀 For Frontend Developers

### Setup

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
	password: 'password123',
	options: {
		data: { name: 'John Doe' }
	}
})

if (data.session) {
	const token = data.session.access_token
	// Use token for API calls
}
```

### Sign In

```typescript
const { data, error } = await supabase.auth.signInWithPassword({
	email: 'user@example.com',
	password: 'password123'
})

if (data.session) {
	const token = data.session.access_token
	// Store or use immediately
}
```

### Make API Request

```typescript
const { data: { session } } = await supabase.auth.getSession()

const response = await fetch('https://api.sunsteel.com/api/routines', {
	headers: {
		'Authorization': `Bearer ${session.access_token}`,
		'Content-Type': 'application/json'
	}
})
```

### Sign Out

```typescript
await supabase.auth.signOut()

// Also clear backend cookies
await fetch('/api/auth/supabase/logout', { method: 'POST' })
```

## 🔧 For Backend Developers

### Protect a Route

```typescript
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard'

@Controller('routines')
@UseGuards(SupabaseJwtGuard) // Protect all routes
export class RoutinesController {
	@Get()
	async findAll(@Req() req: RequestWithUser) {
		const userId = req.user.id // Full User entity
		const email = req.user.email
		// ...
	}
}
```

### Access User in Endpoint

```typescript
import { User } from '@prisma/client'

type RequestWithUser = Request & { user: User }

@Get(':id')
async findOne(@Req() req: RequestWithUser, @Param('id') id: string) {
	const user = req.user // Full User entity from database
	
	// Access user properties
	console.log(user.id)             // UUID
	console.log(user.email)          // Email
	console.log(user.name)           // Name
	console.log(user.supabaseUserId) // Supabase ID
	console.log(user.weightUnit)     // User preference
	
	// Use in business logic
	return this.routinesService.findOne(user.id, id)
}
```

### Verify Token Manually

```typescript
constructor(private supabaseService: SupabaseService) {}

async someMethod(token: string) {
	// Verify with Supabase
	const supabaseUser = await this.supabaseService.verifyToken(token)
	
	// Get/create in local database
	const user = await this.supabaseService.getOrCreateUser(supabaseUser)
	
	return user
}
```

## 📡 API Endpoints

### Authentication

| Method | Endpoint | Purpose | Auth Required |
|--------|----------|---------|---------------|
| POST | `/api/auth/supabase/verify` | Verify token | No |
| GET | `/api/auth/supabase/profile` | Get user profile | Yes |
| POST | `/api/auth/supabase/logout` | Clear cookies | No |

### Verify Token Request

```bash
curl -X POST https://api.sunsteel.com/api/auth/supabase/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'
```

### Protected Request

```bash
curl https://api.sunsteel.com/api/routines \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```



## 🔐 Headers

### Required for Protected Endpoints

```
Authorization: Bearer <supabase_jwt_token>
Content-Type: application/json
```

### Example with fetch

```typescript
const headers = {
	'Authorization': `Bearer ${session.access_token}`,
	'Content-Type': 'application/json'
}

await fetch('/api/routines', { headers })
```

## 🐛 Common Issues

### "Invalid token" or 401 Unauthorized

**Check:**
1. Token is from the correct Supabase project
2. Token hasn't expired (default 1 hour)
3. `Authorization` header is formatted correctly
4. Backend `SUPABASE_URL` matches frontend

**Fix:**
```typescript
// Refresh session
const { data: { session } } = await supabase.auth.refreshSession()
const newToken = session.access_token
```

### User not found in database

**Check:**
1. `supabaseUserId` field exists in User table
2. User was created in Supabase
3. Token verification succeeded

**Fix:**
- The first API call should auto-create the user
- Check logs for `getOrCreateUser()` errors
- Verify database connection

### CORS errors

**Check:**
1. Frontend origin whitelisted in backend
2. `Access-Control-Allow-Origin` header present
3. Credentials included if using cookies

**Fix (backend):**
```typescript
// main.ts
app.enableCors({
	origin: ['http://localhost:3000', 'https://app.sunsteel.com'],
	credentials: true
})
```

## 🔑 Token Acquisition (Manual Testing)

- Use `npm run token:supabase` to fetch and inject a Supabase JWT into `test/api-manual-tests.http`.
- Ensure `.env` defines: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`.
- Details and troubleshooting: `docs/reference/ENVIRONMENT_VARIABLES.md`.

## 📚 Full Documentation

- **Implementation Guide:** `docs/authentication/SUPABASE_AUTH.md`
- **Migration Guide:** `docs/authentication/MIGRATION_GUIDE.md`
- **Cleanup Summary:** `docs/authentication/AUTH_CLEANUP_SUMMARY.md`

## 🔗 External Resources

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript/introduction)
- [Next.js + Supabase](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)

---

**Last Updated:** October 2, 2025  
**System:** Supabase Authentication v1.0
