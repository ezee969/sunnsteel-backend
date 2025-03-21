import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from 'src/users/users.module';
import { TokenModule } from 'src/token/token.module';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './guards/passport-jwt.guard';
import { TokenService } from 'src/token/token.service';
import { DatabaseModule } from 'src/database/database.module';
@Module({
  imports: [
    UsersModule,
    TokenModule,
    PassportModule,
    JwtModule.register({}),
    DatabaseModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    {
      provide: JwtAuthGuard,
      useFactory: (tokenService: TokenService) => {
        return new JwtAuthGuard(tokenService);
      },
      inject: [TokenService],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
