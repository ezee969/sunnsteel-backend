import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { UsersController } from './users.controller';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [TokenModule],
  providers: [UsersService, DatabaseService],
  exports: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
