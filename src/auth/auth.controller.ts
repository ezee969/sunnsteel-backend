import { Controller } from '@nestjs/common';

/**
 * @deprecated This controller is deprecated in favor of Supabase authentication.
 * 
 * Legacy Passport.js-based authentication endpoints have been removed.
 * All authentication is now handled through Supabase.
 * 
 * **Migration Guide:**
 * - Instead of `/auth/register` → Use Supabase client-side signup
 * - Instead of `/auth/login` → Use Supabase client-side signIn
 * - Instead of `/auth/google` → Use Supabase OAuth providers
 * - Instead of `/auth/logout` → Use `/auth/supabase/logout`
 * - Instead of `/auth/refresh` → Use Supabase session refresh
 * 
 * **For token verification:** Use `/auth/supabase/verify`
 * **For profile access:** Use `/auth/supabase/profile` with Bearer token
 * 
 * All protected endpoints now use `SupabaseJwtGuard` which validates
 * Supabase JWT tokens via `Authorization: Bearer <token>` header.
 */
@Controller('auth')
export class AuthController {
	constructor() {}

	// All legacy endpoints removed - see SupabaseAuthController instead
}
