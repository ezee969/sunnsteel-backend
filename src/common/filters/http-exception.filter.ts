import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  apiErrorMessage,
  isApiErrorCode,
  type ApiErrorCode,
  type ApiErrorParams,
} from "@sunsteel/contracts";
import type { Request, Response } from "express";

type ErrorPayload = {
  message?: string | string[];
  code?: string;
  params?: ApiErrorParams;
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

    const code = this.resolveCode(status, payload);
    const params = this.resolveParams(payload);
    // I18N-06: a coded refusal's message is its template, never an internal,
    // so it survives production even on a 5xx.
    const message =
      code && isApiErrorCode(code) && status !== HttpStatus.TOO_MANY_REQUESTS
        ? apiErrorMessage(code, params)
        : this.resolveMessage(status, payload, exception);

    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(
      `[${request.method}] ${request.url} -> ${status} ${message}`,
      stack,
    );

    response.status(status).json({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      ...(params ? { params } : {}),
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
      return "Internal server error";
    }

    if (typeof payload === "string" && payload.trim().length > 0) {
      return payload;
    }

    if (payload && typeof payload === "object") {
      const rawMessage = payload.message;
      if (typeof rawMessage === "string" && rawMessage.trim().length > 0) {
        return rawMessage;
      }
      if (Array.isArray(rawMessage) && rawMessage.length > 0) {
        return rawMessage.join(", ");
      }
    }

    if (exception instanceof Error && exception.message) {
      return exception.message;
    }

    return "Internal server error";
  }

  private resolveCode(
    status: number,
    payload: ErrorPayload | string | undefined,
  ): string | undefined {
    const code =
      payload && typeof payload === "object" && typeof payload.code === "string"
        ? payload.code
        : undefined;
    // The throttler throws its own exception with no code of ours.
    if (!code && status === HttpStatus.TOO_MANY_REQUESTS) {
      return "RATE_LIMITED" satisfies ApiErrorCode;
    }
    return code;
  }

  private resolveParams(
    payload: ErrorPayload | string | undefined,
  ): ApiErrorParams | undefined {
    if (!payload || typeof payload === "string" || !payload.params) {
      return undefined;
    }
    return payload.params;
  }
}
