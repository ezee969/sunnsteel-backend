# 🔧 Fix Supabase Configuration for Migration

## Issue: "User not allowed" Error

Your migration script found 3 users but they all failed with "User not allowed". This is a Supabase configuration issue.

## ✅ Fix Steps

### 1. Enable User Signups

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Settings**
3. Find **"Enable email signups"**
4. Make sure it's **ENABLED** (toggle should be ON)

### 2. Disable Email Confirmation (Temporarily for Migration)

1. In the same **Authentication** → **Settings** page
2. Find **"Enable email confirmations"**
3. **DISABLE** it temporarily (toggle should be OFF)
4. This allows the migration script to create users without email verification

### 3. Check Domain Restrictions

1. In **Authentication** → **Settings**
2. Look for **"Site URL"** or **"Redirect URLs"**
3. Make sure there are no domain restrictions blocking your users

### 4. Check Rate Limiting

1. In **Authentication** → **Rate Limits**
2. Make sure the limits aren't too restrictive for bulk operations

## 🔄 After Making These Changes

1. **Wait 1-2 minutes** for settings to propagate
2. **Re-run the dry-run** to test:
   ```bash
   DRY_RUN=true npx tsx scripts/migrate-users-to-supabase.ts
   ```
3. If successful, run the **actual migration**:
   ```bash
   npx tsx scripts/migrate-users-to-supabase.ts
   ```

## 🔒 Security Note

**IMPORTANT**: After the migration is complete, you should:

1. **Re-enable email confirmations** for security
2. **Configure proper redirect URLs**
3. **Set appropriate rate limits**

## 📧 Users Found for Migration

The script found these 3 users:

- `workout-detail-1756567031135@example.com`
- `test@example.com`
- `eze.olivero96@gmail.com`

Once the Supabase settings are fixed, these users will be migrated with temporary passwords.
