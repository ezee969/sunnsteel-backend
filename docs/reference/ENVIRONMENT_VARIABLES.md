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

# Optional client anon key (if your backend scripts need to call Supabase Auth)
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."

# Optional test credentials for automation
TEST_USER_EMAIL="dev@example.com"
TEST_USER_PASSWORD="strong-password"

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

# Workout Session Auto-Expiration
# In-progress sessions older than this (hours) are auto-marked ABORTED by maintenance task
WORKOUT_SESSION_TIMEOUT_HOURS=48
# Maintenance sweep interval in minutes (how often cleanup runs). Reasonable default: every 30 minutes
WORKOUT_SESSION_SWEEP_INTERVAL_MIN=30
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

# Tip: You may reuse NEXT_PUBLIC_SUPABASE_ANON_KEY in backend scripts when using password grant.
```

## Railway Environment Variables

Add these to your Railway backend service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (optional)
- Any RtF cache variables needed for your deployment


## Vercel/Netlify Environment Variables

Add these to your frontend deployment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`


### Recent Schema Additions

- Added `ProgramStyle` enum and optional `programStyle` field to `Routine` for storing RtF variant (STANDARD | HYPERTROPHY).
- Added `TmAdjustment` model for tracking training max adjustments in Programmed RtF routines.

## 🔍 Where to Find These Keys

In your Supabase Dashboard:

1. Go to **Settings** → **API**
2. **Project URL** = `SUPABASE_URL`
3. **anon/public key** = `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **service_role key** = `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)
  
Additionally, you can set `SUPABASE_ANON_KEY` in the backend to reuse the client anon key for scripts.

## ⚠️ Important Notes

- **Anon Key**: Safe to expose in frontend (public)
- **Service Role Key**: Keep secret, backend only
- The key you mentioned `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` should be `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 🚀 Automation: Fetching Supabase Token for Manual Tests

Use the helper script to avoid manual copy/paste:

```bash
npm run token:supabase
```

What it does:
- Calls Supabase Auth password grant using `SUPABASE_URL` and anon key.
- Uses `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` if present (or accepts `-Email`/`-Password`).
- Prints the `access_token` to the console.
- Automatically updates `test/api-manual-tests.http` with `@supabaseToken = <token>`.

Examples:

```bash
# With env vars set
TEST_USER_EMAIL=dev@example.com \
TEST_USER_PASSWORD=strong-password \
npm run token:supabase

# Or pass parameters
npm run token:supabase -- -Email dev@example.com -Password strong-password
```

If the token expires, rerun the script and re-run your manual tests.

````