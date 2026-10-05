import { Controller, Get } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('health')
export class HealthController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * Railway's health check reads the status code only. `realtime` is the
   * MSG-06 listener's state and never fails the check: without it the app
   * falls back to polling, which is degraded, not down.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      realtime: this.realtime.status,
    };
  }
}
