import { Global, Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from 'src/database/database.module';

@Global()
@Module({
  providers: [TokenService],
  exports: [TokenService],
  imports: [JwtModule, DatabaseModule],
})
export class TokenModule {}
