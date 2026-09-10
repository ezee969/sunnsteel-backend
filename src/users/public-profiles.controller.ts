import { Controller, Get, Header, Param } from '@nestjs/common';

import { UsersService } from './users.service';

@Controller('profiles')
export class PublicProfilesController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':identifier')
  @Header('Cache-Control', 'no-store')
  getPublicProfile(@Param('identifier') identifier: string) {
    return this.usersService.getPublicProfile(null, identifier);
  }
}
