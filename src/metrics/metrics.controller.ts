import { Controller, Get, Req, ForbiddenException, Res } from '@nestjs/common';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

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
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  private clientIp(req: Request) {
    // Respect X-Forwarded-For first element if present (behind proxy)
    const fwd = req.headers['x-forwarded-for'] as string | undefined;
    if (fwd) return fwd.split(',')[0].trim();
    return req.ip || (req.socket && (req.socket as any).remoteAddress) || '';
  }

  @Get()
  async scrape(@Req() req: Request, @Res() res: Response) {
    const ip = this.clientIp(req);
    if (this.allowlist.size && !this.allowlist.has(ip)) {
      throw new ForbiddenException('metrics access denied');
    }
    const body = await this.prom.metricsText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(body);
  }
}
