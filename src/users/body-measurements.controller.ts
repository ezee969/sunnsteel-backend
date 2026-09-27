import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { BodyMeasurementsService } from './body-measurements.service';
import { UpsertBodyMeasurementDto } from './dto/upsert-body-measurement.dto';

/** PROG-12: the owner's own dated body weight and measurements. */
@UseGuards(SupabaseJwtGuard)
@Controller('body-measurements')
export class BodyMeasurementsController {
  constructor(private readonly bodyMeasurements: BodyMeasurementsService) {}

  @Get()
  list(@Request() req: RequestWithUser, @Query('range') range?: string) {
    return this.bodyMeasurements.ownProgress(req.user.id, range);
  }

  @Put(':date')
  upsert(
    @Request() req: RequestWithUser,
    @Param('date') date: string,
    @Body() body: UpsertBodyMeasurementDto,
  ) {
    return this.bodyMeasurements.upsert(req.user.id, date, body);
  }

  @Delete(':date')
  @HttpCode(204)
  remove(@Request() req: RequestWithUser, @Param('date') date: string) {
    return this.bodyMeasurements.remove(req.user.id, date);
  }
}
