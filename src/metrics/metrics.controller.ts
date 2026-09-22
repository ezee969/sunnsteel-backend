import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { clientIp, normalizeIp } from '../common/client-ip';
import { PrometheusMetricsService } from './prometheus-metrics.service';

@Controller('metrics')
export class MetricsController {
  private readonly allowlist: Set<string>;

  constructor(
    private readonly prom: PrometheusMetricsService,
    config: ConfigService,
  ) {
    const raw = config.get('METRICS_IP_ALLOWLIST') || '127.0.0.1,::1';
    this.allowlist = new Set(
      raw
        .split(',')
        .map((entry: string) => normalizeIp(entry.trim()))
        .filter(Boolean),
    );
  }

  @Get()
  async scrape(@Req() req: Request, @Res() res: Response) {
    // TD-46. This used to read the first `X-Forwarded-For` entry itself. That
    // is the value a client controls behind an edge that appends rather than
    // overwrites, and it is the shape of bug that survives a move to another
    // host unnoticed. `clientIp` is the one place that question is answered.
    const ip = clientIp(req.headers, req.ip);
    if (this.allowlist.size && !this.allowlist.has(ip)) {
      throw new ForbiddenException('metrics access denied');
    }
    const body = await this.prom.metricsText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(body);
  }
}
