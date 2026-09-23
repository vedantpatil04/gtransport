import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestId } from './request-context';

/** One line per completed request. Health checks log at debug level to keep production logs readable. */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms rid=${getRequestId(req)}`;

      if (res.statusCode >= 500) this.logger.error(message);
      else if (res.statusCode >= 400) this.logger.warn(message);
      else if (req.path.startsWith('/health')) this.logger.debug(message);
      else this.logger.log(message);
    });

    next();
  }
}
