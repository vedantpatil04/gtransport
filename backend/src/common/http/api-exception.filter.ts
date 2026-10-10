import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ApiErrorCode, errorCodeForStatus, type ApiErrorBody, type ApiFieldError } from './api-error';
import { getRequestId } from './request-context';

interface NormalisedError {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: ApiFieldError[];
}

/** `model=PaymentRecord column=remarks` style summary of Prisma's error metadata; arguments are never included. */
export function describePrismaMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  for (const key of ['modelName', 'table', 'column', 'target', 'constraint', 'field_name']) {
    const value = meta[key];
    if (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
      parts.push(`${key}=${Array.isArray(value) ? value.join(',') : value}`);
    }
  }
  return parts.join(' ');
}

/** Turns every thrown error into the single documented error envelope. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, code, message, details } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const where = `${request.method} ${request.originalUrl} rid=${getRequestId(request)}`;
      if (exception instanceof Prisma.PrismaClientKnownRequestError) {
        // One searchable line with the Prisma code, so a reference ID in a screenshot leads straight
        // to the cause (e.g. P2022 = the code is ahead of the database). Only the model/column
        // metadata Prisma gives — never the query arguments, which can hold what a user typed.
        this.logger.error(`Database error ${exception.code} on ${where} ${describePrismaMeta(exception.meta)}`.trim(), exception.stack);
      } else if (exception instanceof Prisma.PrismaClientValidationError) {
        // The message echoes the whole query including filter values; keep only the explanation.
        this.logger.error(`Database query rejected on ${where}: ${exception.message.trim().split('\n').pop()}`);
      } else {
        this.logger.error(`Unhandled error on ${where}`, exception instanceof Error ? exception.stack : String(exception));
      }
    }

    const body: ApiErrorBody = {
      error: {
        statusCode: status,
        code,
        message,
        ...(details?.length ? { details } : {}),
        requestId: getRequestId(request),
        path: request.originalUrl,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(status).json(body);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof HttpException) return this.fromHttpException(exception);
    if (exception instanceof Prisma.PrismaClientKnownRequestError) return this.fromPrismaError(exception);

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ApiErrorCode.SERVICE_UNAVAILABLE,
        message: 'The database is unavailable.',
      };
    }

    // Never leak internal messages or stack traces to clients.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
    };
  }

  private fromHttpException(exception: HttpException): NormalisedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const code = errorCodeForStatus(status);

    if (typeof payload === 'string') return { status, code, message: payload };

    const record = payload as { message?: unknown; error?: unknown; code?: unknown; details?: unknown };
    const details = Array.isArray(record.details) ? (record.details as ApiFieldError[]) : undefined;
    const message =
      typeof record.message === 'string'
        ? record.message
        : Array.isArray(record.message)
          ? record.message.join('; ')
          : exception.message;

    return {
      status,
      code: typeof record.code === 'string' ? (record.code as ApiErrorCode) : code,
      message,
      details,
    };
  }

  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): NormalisedError {
    switch (exception.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, code: ApiErrorCode.CONFLICT, message: 'A record with these unique values already exists.' };
      case 'P2003':
        return { status: HttpStatus.CONFLICT, code: ApiErrorCode.CONFLICT, message: 'A related record is required or still referenced.' };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, code: ApiErrorCode.NOT_FOUND, message: 'The requested record was not found.' };
      // The deployed code is ahead of the database: a table or column it needs has not been
      // created yet (a migration is pending). Retrying cannot help until the database is updated,
      // so say that plainly instead of an opaque 500 — the log line carries the code.
      case 'P2021':
      case 'P2022':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ApiErrorCode.SERVICE_UNAVAILABLE,
          message: 'This part of the system is being updated and is temporarily unavailable. Please try again shortly.',
        };
      // Pool exhausted, connection dropped or a write conflict: transient, safe to retry.
      case 'P1001':
      case 'P1002':
      case 'P1008':
      case 'P1017':
      case 'P2024':
      case 'P2034':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ApiErrorCode.SERVICE_UNAVAILABLE,
          message: 'The database is busy or briefly unreachable. Please try again in a moment.',
        };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: ApiErrorCode.INTERNAL_ERROR, message: 'An unexpected database error occurred.' };
    }
  }
}
