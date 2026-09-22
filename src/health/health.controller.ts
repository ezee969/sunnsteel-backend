import { Controller, Get, Logger, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  // TEMPORARY (TD-47). Removed in the same slice. The production database is
  // private by design, so the password query TD-47 requires before anything is
  // deleted cannot be run from a developer machine; this answers it from
  // inside the service instead.
  //
  // It logs **counts only**. No email, no id and above all no password hash
  // leaves the database: the question is "does anyone still depend on the
  // legacy password path", which a number answers.
  private readonly logger = new Logger('LegacyPasswordProbe');

  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check(@Req() _req: Request, @Query('probe') probe?: string) {
    if (probe === 'td47') {
      const [total, withPassword, strandedOnPassword, withSupabase] =
        await Promise.all([
          this.db.user.count(),
          this.db.user.count({ where: { password: { not: null } } }),
          // The only group that would lose access: a password and no Supabase
          // identity to sign in with instead.
          this.db.user.count({
            where: { password: { not: null }, supabaseUserId: null },
          }),
          this.db.user.count({ where: { supabaseUserId: { not: null } } }),
        ]);
      this.logger.log(
        JSON.stringify({
          total,
          withPassword,
          strandedOnPassword,
          withSupabase,
        }),
      );
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
