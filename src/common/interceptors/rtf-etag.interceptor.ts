import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import * as crypto from 'crypto';

/**
 * RTF-B12: ETag / Conditional GET support for RtF read endpoints.
 *
 * Applied per-route (week goals, timeline, forecast). We compute a strong ETag
 * over a sanitized payload that excludes volatile cache diagnostic fields:
 *   - _cache
 *   - cacheStats
 * The goal is to keep the entity tag stable across cache HIT/MISS differences
 * so clients can leverage 304 responses effectively.
 *
 * If request includes If-None-Match matching the computed ETag we return 304
 * with empty body.
 *
 * Opt-out: set env RTF_ETAG_ENABLED=0 to disable hashing (no header emitted).
 */
@Injectable()
export class RtfEtagInterceptor implements NestInterceptor {
  private enabled = (process.env.RTF_ETAG_ENABLED ?? '1') !== '0';

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.enabled) return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { headers: any }>();
    const res = http.getResponse<{
      setHeader: (k: string, v: string) => void;
      status: (c: number) => any;
    }>();

    return next.handle().pipe(
      map((body) => {
        try {
          // Clone & strip volatile fields
          const sanitized = this.stripVolatile(body);
          const hash = crypto
            .createHash('sha1')
            .update(JSON.stringify(sanitized))
            .digest('hex');
          const etag = '"' + hash + '"';
          const ifNoneMatch =
            (req.headers['if-none-match'] as string | undefined) || undefined;
          if (ifNoneMatch && ifNoneMatch === etag) {
            // Short-circuit 304
            res.setHeader('ETag', etag);
            (res as any).status(304);
            return undefined;
          }
          res.setHeader('ETag', etag);
        } catch {
          // swallow hashing errors – continue with normal body
        }
        return body;
      }),
    );
  }

  private stripVolatile(body: any): any {
    if (body === null || typeof body !== 'object') return body;
    if (Array.isArray(body)) return body.map((v) => this.stripVolatile(v));
    const out: any = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === '_cache' || k === 'cacheStats') continue;
      out[k] = this.stripVolatile(v);
    }
    return out;
  }
}
