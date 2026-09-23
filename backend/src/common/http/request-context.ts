import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepts a caller-supplied request id when it is sane, otherwise generates one. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(req: Partial<Request> | undefined): string {
  return req?.requestId ?? 'unknown';
}
