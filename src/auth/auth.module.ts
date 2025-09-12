import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';
import { SupabaseService } from './supabase.service';
import { SupabaseAuthController } from './supabase-auth.controller';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { UsersModule } from 'src/users/users.module';
import { TokenModule } from 'src/token/token.module';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/passport-jwt.guard';
import { DatabaseModule } from 'src/database/database.module';

@Global()
@Module({
  imports: [
    UsersModule,
    TokenModule,
    PassportModule,
    JwtModule.register({}),
    DatabaseModule,
  ],
  controllers: [AuthController, SupabaseAuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    SupabaseJwtStrategy,
    SupabaseService,
    JwtAuthGuard,
    SupabaseJwtGuard,
  ],
  exports: [AuthService, JwtAuthGuard, SupabaseJwtGuard, SupabaseService],
})
export class AuthModule {}
