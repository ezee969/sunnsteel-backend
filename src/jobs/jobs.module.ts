import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { JobsService } from './jobs.service';

/**
 * PLAT-01: one pg-boss instance per process. Global, because any module that
 * announces a change writes the outbox with its own transaction
 * (`writeOutbox`) and only a consumer needs the service, to register itself.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: JobsService,
      useFactory: (db: DatabaseService) => new JobsService(db),
      inject: [DatabaseService],
    },
  ],
  exports: [JobsService],
})
export class JobsModule {}
