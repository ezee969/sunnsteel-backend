# 🔑 Environment Variables Setup

## Backend (.env)

```bash
# Existing variables (keep these)
DATABASE_URL="your-neon-database-url"
JWT_SECRET="your-jwt-secret"
PORT=4000
FRONTEND_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-client-id"

# New Supabase variables
SUPABASE_URL="https://dvqorsgrolkyvlqcujxt.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...." # Service Role Key (secret)
```

## Frontend (.env.local)

```bash
# Existing variables (keep these)
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
NEXT_PUBLIC_FRONTEND_URL="http://localhost:3000"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="your-google-client-id"

# New Supabase variables
NEXT_PUBLIC_SUPABASE_URL="https://dvqorsgrolkyvlqcujxt.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...." # Anon/Public Key
```

## Railway Environment Variables

Add these to your Railway backend service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Vercel/Netlify Environment Variables

Add these to your frontend deployment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 🔍 Where to Find These Keys

In your Supabase Dashboard:

1. Go to **Settings** → **API**
2. **Project URL** = `SUPABASE_URL`
3. **anon/public key** = `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **service_role key** = `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## ⚠️ Important Notes

- **Anon Key**: Safe to expose in frontend (public)
- **Service Role Key**: Keep secret, backend only
- The key you mentioned `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` should be `NEXT_PUBLIC_SUPABASE_ANON_KEY`
