import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiUsageService } from '../ai/ai-usage';
import { BillingModule } from '../billing/billing.module';
import { DatabaseService } from '../database/database.service';
import { ROUTINE_DRAFT_MODEL, routineDraftModelFrom } from './routine-draft-model';
import { RoutineDraftsController } from './routine-drafts.controller';
import { RoutineDraftsService } from './routine-drafts.service';

/** INTEL-03: natural-language routine drafts. */
@Module({
  imports: [BillingModule],
  providers: [
    DatabaseService,
    AiUsageService,
    RoutineDraftsService,
    {
      provide: ROUTINE_DRAFT_MODEL,
      inject: [ConfigService],
      useFactory: routineDraftModelFrom,
    },
  ],
  controllers: [RoutineDraftsController],
})
export class RoutineDraftsModule {}
