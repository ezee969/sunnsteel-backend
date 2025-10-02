import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthController } from './supabase-auth.controller';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { UsersModule } from 'src/users/users.module';
import { TokenModule } from 'src/token/token.module';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from 'src/database/database.module';

/**
 * @module AuthModule
 * 
 * Handles authentication using Supabase JWT tokens.
 * 
 * **Active Components:**
 * - `SupabaseAuthController` - Supabase auth endpoints (/auth/supabase/*)
 * - `SupabaseJwtStrategy` - Validates Supabase Bearer tokens
 * - `SupabaseJwtGuard` - Protects routes requiring authentication
 * - `SupabaseService` - Verifies tokens and syncs users with Supabase
 * 
 * **Deprecated/Legacy Components:**
 * - `AuthController` - Legacy Passport.js endpoints (deprecated)
 * - `AuthService` - Legacy bcrypt/JWT auth methods (deprecated)
 * - `TokenService` - Custom JWT token generation (still used by legacy code)
 * 
 * **Protected Endpoints:**
 * All protected routes use `@UseGuards(SupabaseJwtGuard)` and expect
 * Supabase JWT tokens in the `Authorization: Bearer <token>` header.
 */
@Global()
@Module({
	imports: [
		UsersModule,
		TokenModule, // Still used by legacy AuthService
		PassportModule,
		JwtModule.register({}),
		DatabaseModule,
	],
	controllers: [SupabaseAuthController, AuthController],
	providers: [
		// Active Supabase Auth
		SupabaseJwtStrategy,
		SupabaseService,
		SupabaseJwtGuard,
		// Legacy (deprecated but kept for backward compatibility)
		AuthService,
	],
	exports: [SupabaseJwtGuard, SupabaseService],
})
export class AuthModule {}
