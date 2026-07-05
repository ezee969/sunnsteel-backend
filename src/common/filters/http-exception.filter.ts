import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type ErrorPayload = {
  message?: string | string[];
  code?: string;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction = false) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = isHttpException
      ? (exception.getResponse() as ErrorPayload | string)
      : undefined;

    const message = this.resolveMessage(status, payload, exception);
    const code = this.resolveCode(payload);

    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(
      `[${request.method}] ${request.url} -> ${status} ${message}`,
      stack,
    );

    response.status(status).json({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private resolveMessage(
    status: number,
    payload: ErrorPayload | string | undefined,
    exception: unknown,
  ) {
    const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;

    if (isServerError && this.isProduction) {
      return 'Internal server error';
    }

    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      const rawMessage = payload.message;
      if (typeof rawMessage === 'string' && rawMessage.trim().length > 0) {
        return rawMessage;
      }
      if (Array.isArray(rawMessage) && rawMessage.length > 0) {
        return rawMessage.join(', ');
      }
    }

    if (exception instanceof Error && exception.message) {
      return exception.message;
    }

    return 'Internal server error';
  }

  private resolveCode(payload: ErrorPayload | string | undefined) {
    if (!payload || typeof payload === 'string') {
      return undefined;
    }

    return typeof payload.code === 'string' ? payload.code : undefined;
  }
}
