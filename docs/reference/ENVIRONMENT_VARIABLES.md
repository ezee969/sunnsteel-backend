````markdown
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

# RtF Week Goals Cache (RTF-B04/B10)
# Driver can be 'memory' or 'redis'
RTF_CACHE_DRIVER=memory
# Optional Redis URL when driver=redis
# RTF_REDIS_URL=redis://default:password@host:6379
# Base TTL for week goals (seconds) applied at L2 or single-layer driver
RTF_WEEK_GOAL_TTL_SEC=600
# Enable layered cache (L1 in-memory + L2 redis) when using redis driver (1=on,0=off)
RTF_CACHE_LAYERED=1
# L1 TTL in ms (short to cap staleness window)
RTF_WEEK_GOALS_L1_TTL_MS=5000

# RtF ETag (RTF-B12) enable/disable (1=on, 0=off)
RTF_ETAG_ENABLED=1
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


## Vercel/Netlify Environment Variables

Add these to your frontend deployment:


### Recent Schema Additions

- Added `ProgramStyle` enum and optional `programStyle` field to `Routine` for storing RtF variant (STANDARD | HYPERTROPHY).
- Added `TmAdjustment` model for tracking training max adjustments in Programmed RtF routines.

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

````