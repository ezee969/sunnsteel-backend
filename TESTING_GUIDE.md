# 🧪 Supabase Authentication Testing Guide

## ✅ Current Status

- ✅ Backend running on http://localhost:4000 with Supabase integration
- ✅ Frontend running on http://localhost:3000 with new auth forms
- ✅ Both auth systems active (old + new)

## 🎯 Test Plan

### **Test 1: New User Signup with Supabase**

1. **Go to signup page**: http://localhost:3000/signup
2. **Create a new account** with:
   - Name: Your Test Name
   - Email: your-test-email@example.com
   - Password: TestPassword123!
3. **Expected Result**:
   - Account created in Supabase
   - Redirected to dashboard
   - User record created in your database with `supabaseUserId`

### **Test 2: Login with New Account**

1. **Go to login page**: http://localhost:3000/login
2. **Login with the credentials** you just created
3. **Expected Result**:
   - Successful login
   - Redirected to dashboard
   - Session maintained

### **Test 3: Google OAuth (Optional)**

1. **On signup or login page**, click "Continue with Google"
2. **Complete Google OAuth flow**
3. **Expected Result**:
   - Account created/logged in via Google
   - Redirected to dashboard

### **Test 4: Password Reset (Supabase Feature)**

1. **On login page**, click "Forgot Password" (if available)
2. **Enter your email**
3. **Check email** for reset link
4. **Expected Result**:
   - Password reset email sent by Supabase
   - Can reset password via email link

### **Test 5: Protected Routes**

1. **While logged in**, navigate to protected routes:
   - http://localhost:3000/dashboard
   - http://localhost:3000/routines
   - http://localhost:3000/workouts
2. **Expected Result**: All routes accessible

3. **Logout** and try accessing protected routes
4. **Expected Result**: Redirected to login page

## 🔍 Verification Steps

### **Backend Verification**

Check that Supabase integration is working:

```bash
# Test health endpoint
curl http://localhost:4000/api/auth/supabase/health

# Should return:
# {"status":"ok","timestamp":"...","service":"supabase-auth"}
```

### **Database Verification**

After creating a new user, check your database:

```sql
-- Check that user was created with supabaseUserId
SELECT id, email, name, supabaseUserId, createdAt
FROM "User"
ORDER BY createdAt DESC
LIMIT 5;
```

### **Supabase Dashboard Verification**

1. Go to your Supabase dashboard
2. Navigate to **Authentication** → **Users**
3. **Verify** your test user appears in the list
4. **Check** user metadata and status

## 🐛 Troubleshooting

### **Common Issues**

#### **"Missing Supabase configuration"**

- Check environment variables in frontend `.env.local`
- Restart frontend: `npm run dev`

#### **"User not allowed"**

- Go to Supabase Dashboard → Authentication → Settings
- Enable "Email signups"
- Disable "Email confirmations" (temporarily)

#### **Network errors**

- Ensure backend is running on port 4000
- Check CORS configuration allows localhost:3000

#### **Redirect loops**

- Clear browser cookies
- Check middleware configuration
- Verify auth provider setup

## 📊 Success Criteria

✅ **Complete Success** means:

1. Can create new account via Supabase
2. Can login with new account
3. User appears in both Supabase and your database
4. Protected routes work correctly
5. Logout works properly
6. Sessions persist across browser refreshes

## 🚀 Next Steps After Testing

Once testing is successful:

1. **Deploy to production** (Railway + Vercel)
2. **Configure production URLs** in Supabase
3. **Enable email confirmations** for security
4. **Set up proper Google OAuth** for production
5. **Clean up old auth system** (optional)

## 📧 Need Help?

If you encounter issues:

1. Check browser console for errors
2. Check backend logs
3. Verify Supabase dashboard shows user creation
4. Test API endpoints directly with curl
