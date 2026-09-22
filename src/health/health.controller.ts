import { Controller, Get, Logger, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

@Controller('health')
export class HealthController {
  // TEMPORARY (TD-46). Removed in the same slice that fixes the client-IP
  // handling; it exists to answer, from production rather than from a guess,
  // what Railway's edge actually sends. Logged only when the caller asks for
  // it by query parameter, so ordinary health checks stay silent.
  private readonly logger = new Logger('ClientIpProbe');

  @Get()
  check(@Req() req: Request, @Query('probe') probe?: string) {
    if (probe === 'td46') {
      this.logger.log(
        JSON.stringify({
          reqIp: req.ip,
          reqIps: req.ips,
          socket: req.socket?.remoteAddress,
          xForwardedFor: req.headers['x-forwarded-for'] ?? null,
          xRealIp: req.headers['x-real-ip'] ?? null,
          xRailwayEdge: req.headers['x-railway-edge'] ?? null,
          trustProxy: req.app?.get('trust proxy') ?? null,
        }),
      );
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
