# 🚀 Supabase Authentication Migration Guide

This guide will help you migrate from your current custom JWT authentication to Supabase Auth while maintaining all existing user data.

## 📋 Overview

**Migration Type**: Hybrid Architecture

- ✅ Keep existing Neon PostgreSQL database for business data
- ✅ Use Supabase only for authentication
- ✅ Preserve all existing user data and relationships
- ✅ Zero downtime migration possible

## 🏗️ Phase 1: Setup Supabase Project

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a project name (e.g., "sunnsteel-auth")
3. Set a strong database password
4. Choose the same region as your Railway deployment for optimal performance
5. Wait for project creation (2-3 minutes)

### 1.2 Configure Environment Variables

Add these to your backend `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Add these to your frontend `.env.local` file:

```bash
# Supabase Configuration (Frontend)
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Find these values in**: Supabase Dashboard → Settings → API

### 1.3 Configure Authentication Providers

1. Go to **Authentication → Providers** in Supabase dashboard
2. **Email Provider**: Enable and configure
3. **Google Provider** (Optional):
   - Enable Google provider
   - Use your existing `GOOGLE_CLIENT_ID` and add the client secret
   - Add redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`

## 🔧 Phase 2: Deploy Backend Changes

### 2.1 Install Dependencies

```bash
cd backend
npm install @supabase/supabase-js
```

### 2.2 Database Migration

The Prisma migration is already created. Apply it:

```bash
npx prisma migrate deploy
```

### 2.3 Deploy to Railway

1. Push your changes to Git
2. Railway will automatically deploy
3. Verify environment variables are set in Railway dashboard
4. Test the new endpoints:
   - `GET /api/auth/supabase/health` (should return 200 OK)

### 2.4 Test Backend Integration

```bash
# Test health endpoint
curl https://your-backend.railway.app/api/auth/supabase/health

# Should return:
# {"status":"ok","timestamp":"...","service":"supabase-auth"}
```

## 🌐 Phase 3: Deploy Frontend Changes

### 3.1 Install Dependencies

```bash
cd frontend
npm install @supabase/supabase-js
```

### 3.2 Environment Variables

Set these in your frontend hosting platform (Vercel/Netlify/etc.):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3.3 Deploy Frontend

Push your changes to trigger deployment.

## 👥 Phase 4: User Migration

### 4.1 Both Auth Systems Active

Both authentication systems work simultaneously:

- **New users**: Automatically use Supabase Auth
- **Existing users**: Can still use old auth OR migrate

### 4.2 User Migration Options

#### Option A: Automatic Migration (Recommended)

Run the migration script to migrate all users:

```bash
cd backend
# Dry run first (recommended)
DRY_RUN=true npm run tsx scripts/migrate-users-to-supabase.ts

# Actual migration
npm run tsx scripts/migrate-users-to-supabase.ts
```

#### Option B: Manual Migration Page

Users can migrate themselves at `/migrate`:

- Validates old credentials
- Creates Supabase account
- Links accounts seamlessly

### 4.3 Migration Communication

**Email Template** for existing users:

```
Subject: 🔒 Enhanced Security - Account Migration Required

Hi [Name],

We've upgraded Sunnsteel with enhanced security and new features!

To continue using your account, please migrate to our new authentication system:
👉 https://your-app.com/migrate

Benefits:
✅ Enhanced security
✅ Password reset via email
✅ Improved Google sign-in
✅ Better session management

Your workouts and data remain unchanged.

Questions? Reply to this email.

Best,
Sunnsteel Team
```

## 🔄 Phase 5: Switch Authentication Systems

### 5.1 Update App Provider

Replace the old `AuthProvider` with `SupabaseAuthProvider`:

```tsx
// In app/layout.tsx or your provider file
import { SupabaseAuthProvider } from '@/providers/supabase-auth-provider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <body>
        <AppProvider>
          <QueryProvider>
            <SupabaseAuthProvider>
              {' '}
              {/* Replace AuthProvider */}
              {children}
            </SupabaseAuthProvider>
          </QueryProvider>
        </AppProvider>
      </body>
    </html>
  );
}
```

### 5.2 Update Login/Signup Pages

Replace form components:

```tsx
// In app/(auth)/login/page.tsx
import { SupabaseLoginForm } from './components/SupabaseLoginForm';

export default function LoginPage() {
  return <SupabaseLoginForm />; // Replace LoginForm
}
```

```tsx
// In app/(auth)/signup/page.tsx
import { SupabaseSignupForm } from './components/SupabaseSignupForm';

export default function SignupPage() {
  return <SupabaseSignupForm />; // Replace SignupForm
}
```

## 🧹 Phase 6: Cleanup (Optional)

### 6.1 Remove Old Auth System (After 100% Migration)

1. **Remove old auth endpoints**:

   - `POST /api/auth/login`
   - `POST /api/auth/register`
   - `POST /api/auth/refresh`
   - `POST /api/auth/logout`

2. **Remove unused database tables**:

   ```prisma
   // Remove from schema.prisma:
   // model RefreshToken
   // model BlacklistedToken
   ```

3. **Remove unused dependencies**:

   ```bash
   npm uninstall bcrypt @types/bcrypt passport passport-jwt passport-local
   ```

4. **Update protected routes**:
   ```tsx
   // Replace JwtAuthGuard with SupabaseJwtGuard
   @UseGuards(SupabaseJwtGuard) // instead of JwtAuthGuard
   ```

## 🚀 Deployment Checklist

### Backend (Railway)

- [ ] Environment variables set in Railway dashboard
- [ ] Database migration applied
- [ ] Health endpoint responding
- [ ] Google OAuth configured (if using)

### Frontend (Vercel/Netlify)

- [ ] Environment variables set
- [ ] Auth callback route working: `/auth/callback`
- [ ] New login/signup forms deployed
- [ ] Migration page accessible: `/migrate`

### Supabase Dashboard

- [ ] Email templates configured
- [ ] Auth providers enabled
- [ ] Redirect URLs added
- [ ] User management accessible

## 🔍 Testing Checklist

### New Users

- [ ] Can sign up with email/password
- [ ] Can sign up with Google
- [ ] Email confirmation works
- [ ] Can access protected routes
- [ ] Profile data saves correctly

### Existing Users (Before Migration)

- [ ] Can still log in with old system
- [ ] Can access migration page
- [ ] Migration process works smoothly
- [ ] Data preserved after migration

### Existing Users (After Migration)

- [ ] Can log in with new credentials
- [ ] Google OAuth works
- [ ] Password reset works
- [ ] All data preserved
- [ ] Session management improved

## 🆘 Troubleshooting

### Common Issues

#### "Missing Supabase configuration"

- Verify environment variables are set
- Restart your application after adding variables

#### "Invalid token" or "Token verification failed"

- Check that SUPABASE_SERVICE_ROLE_KEY is correct
- Ensure token is passed as Bearer token

#### Google OAuth not working

- Verify Google Client ID matches Supabase configuration
- Check redirect URIs in Google Console and Supabase

#### Users can't access protected routes

- Ensure SupabaseJwtGuard is properly configured
- Check that session state is being set correctly

#### Migration script fails

- Verify database connection
- Check Supabase service role permissions
- Run in dry-run mode first

### Debug Commands

```bash
# Check backend health
curl https://your-backend.railway.app/api/auth/supabase/health

# Test token verification
curl -X POST https://your-backend.railway.app/api/auth/supabase/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"your-supabase-jwt"}'

# Check database connection
npx prisma studio
```

## 📞 Support

If you encounter issues during migration:

1. **Check logs**: Railway logs, browser console, Supabase dashboard
2. **Verify configuration**: Environment variables, redirect URLs
3. **Test incrementally**: One phase at a time
4. **Keep rollback ready**: Old auth system remains functional during migration

## 🎉 Benefits After Migration

✅ **Security**: Supabase handles security best practices  
✅ **Features**: Built-in password reset, email verification  
✅ **Scalability**: Handles auth scaling automatically  
✅ **Maintenance**: No more custom JWT token management  
✅ **User Experience**: Faster auth, better error handling  
✅ **Development**: Focus on business logic, not auth infrastructure

The migration preserves all your existing data while providing a much more robust and feature-rich authentication system!
