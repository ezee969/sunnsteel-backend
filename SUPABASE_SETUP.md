# Supabase Setup Guide

This guide will walk you through setting up Supabase authentication for your Sunnsteel backend.

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Choose a database password and region
3. Wait for the project to be created

## Step 2: Configure Environment Variables

Add these environment variables to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

You can find these values in your Supabase project settings:

- Go to Settings → API
- Copy the Project URL and keys

## Step 3: Configure Authentication Providers

1. In your Supabase dashboard, go to Authentication → Providers
2. Configure the providers you want to use:

### Email Authentication

- Enable "Email" provider
- Configure email templates if needed

### Google OAuth (Optional)

- Enable "Google" provider
- Add your Google OAuth credentials:
  - Client ID: Use the same `GOOGLE_CLIENT_ID` from your current setup
  - Client Secret: Get this from Google Cloud Console
- Add authorized redirect URIs:
  - `https://your-project-id.supabase.co/auth/v1/callback`

## Step 4: Update Database Schema

The migration has already been created to add Supabase integration:

- `password` field is now optional
- `supabaseUserId` field added for linking accounts

## Step 5: Test the Integration

1. Install dependencies: `npm install`
2. Run the backend: `npm run start:dev`
3. Test the new endpoints:
   - `GET /api/auth/supabase/health` - Health check
   - `POST /api/auth/supabase/verify` - Verify Supabase token
   - `GET /api/auth/supabase/profile` - Get user profile (requires Supabase JWT)

## Available Endpoints

### New Supabase Endpoints

- `POST /api/auth/supabase/verify` - Verify Supabase token and get/create user
- `GET /api/auth/supabase/profile` - Get user profile using Supabase JWT
- `POST /api/auth/supabase/migrate` - Migrate existing users (for migration phase)
- `GET /api/auth/supabase/health` - Health check

### Existing Endpoints (Still Active)

- `POST /api/auth/login` - Legacy login
- `POST /api/auth/register` - Legacy registration
- `GET /api/users/profile` - Legacy profile (still works with old JWT)

## Migration Strategy

1. **Phase 1**: Both auth systems run in parallel
2. **Phase 2**: Frontend updated to use Supabase Auth
3. **Phase 3**: Migrate existing users
4. **Phase 4**: Remove legacy auth system

## Next Steps for Frontend

After setting up the backend, you'll need to:

1. Install Supabase client: `npm install @supabase/supabase-js`
2. Update auth provider to use Supabase
3. Replace custom auth hooks with Supabase hooks
4. Test the migration

## Security Notes

- Keep your service role key secure
- Use anon key for client-side operations
- The service role key is used server-side for token verification
- Row Level Security (RLS) is not needed as we're using our own database
