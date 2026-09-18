import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { CreateReportDto } from './dto/create-report.dto';
import { MemberReportsService } from './member-reports.service';

/** PROF-10: filing a report. Reading them is `TRUST-04` and does not exist. */
@UseGuards(SupabaseJwtGuard)
@Controller('reports')
export class MemberReportsController {
  constructor(private readonly reports: MemberReportsService) {}

  @Post()
  create(@Request() req: RequestWithUser, @Body() dto: CreateReportDto) {
    return this.reports.create(req.user.id, dto);
  }
}
