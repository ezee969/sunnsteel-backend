import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
  controllers: [SupabaseAuthController],
  providers: [
    // Active Supabase Auth
    SupabaseJwtStrategy,
    SupabaseService,
    SupabaseJwtGuard,
  ],
  exports: [SupabaseJwtGuard, SupabaseService],
})
export class AuthModule {}
