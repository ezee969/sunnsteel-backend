import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ModeratorGuard } from './moderator.guard';

/** TRUST-04: the review side of PROF-10, whose member-facing half is in `users`. */
@Module({
  providers: [ModerationService, ModeratorGuard, DatabaseService],
  controllers: [ModerationController],
})
export class ModerationModule {}
