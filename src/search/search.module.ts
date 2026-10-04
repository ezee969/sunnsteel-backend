import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** NAV-01. */
@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
