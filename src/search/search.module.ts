import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { RecentSearchesService } from './recent-searches.service';
import { SearchService } from './search.service';

/** NAV-01 to NAV-03. */
@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [SearchService, RecentSearchesService],
})
export class SearchModule {}
