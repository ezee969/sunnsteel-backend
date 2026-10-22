import { Controller, Get } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Railway's health check reads the status code only. `realtime` is the
   * MSG-06 listener's state and never fails the check: without it the app
   * falls back to polling, which is degraded, not down. `jobs` is the
   * PLAT-01 worker's state, the same way: stopped, messages wait in the
   * outbox and nothing is lost.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      realtime: this.realtime.status,
      jobs: this.jobs.status,
    };
  }
}
