import { Controller, Get, Header, Param, Query } from '@nestjs/common';

import { BodyMeasurementsService } from './body-measurements.service';
import { UsersService } from './users.service';

@Controller('profiles')
export class PublicProfilesController {
  constructor(
    private readonly usersService: UsersService,
    private readonly bodyMeasurements: BodyMeasurementsService,
  ) {}

  @Get(':identifier')
  @Header('Cache-Control', 'no-store')
  getPublicProfile(@Param('identifier') identifier: string) {
    return this.usersService.getPublicProfile(null, identifier);
  }

  /** PROG-12: a member's body progress, only when it is shared with everyone. */
  @Get(':identifier/body-measurements')
  @Header('Cache-Control', 'no-store')
  getBodyProgress(
    @Param('identifier') identifier: string,
    @Query('range') range?: string,
  ) {
    return this.bodyMeasurements.memberProgress(null, identifier, range);
  }
}
