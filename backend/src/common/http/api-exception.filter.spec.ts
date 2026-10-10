import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiExceptionFilter, describePrismaMeta } from './api-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = { method: 'GET', originalUrl: '/api/v1/payments', headers: { 'x-request-id': 'req-123' }, requestId: 'req-123' };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0]?.[0] as number, body: json.mock.calls[0]?.[0] as { error: { code: string; message: string; requestId: string } } };
}

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Invalid `prisma.paymentRecord.findMany()` invocation', { code, clientVersion: 'test', meta });

describe('ApiExceptionFilter — database errors', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers 503 — not an opaque 500 — when the code is ahead of the database (missing column or table)', () => {
    for (const code of ['P2022', 'P2021']) {
      const { status, body } = run(known(code, { modelName: 'PaymentRecord', column: 'payment_records.remarks' }));
      expect(status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.message).toMatch(/being updated/i);
      expect(body.error.requestId).toBe('req-123');
    }
  });

  it('logs the Prisma code, model and column next to the request id, so a reference id finds its cause', () => {
    run(known('P2022', { modelName: 'PaymentRecord', column: 'payment_records.remarks' }));
    const [line] = errorLog.mock.calls[0] as [string];
    expect(line).toContain('Database error P2022');
    expect(line).toContain('rid=req-123');
    expect(line).toContain('model');
    expect(line).toContain('column=payment_records.remarks');
  });

  it('treats a dropped or exhausted connection as a retryable 503', () => {
    for (const code of ['P1001', 'P1017', 'P2024', 'P2034']) {
      expect(run(known(code)).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });

  it('keeps the existing mappings for unique, foreign-key and not-found errors', () => {
    expect(run(known('P2002')).status).toBe(HttpStatus.CONFLICT);
    expect(run(known('P2003')).status).toBe(HttpStatus.CONFLICT);
    expect(run(known('P2025')).status).toBe(HttpStatus.NOT_FOUND);
  });

  it('still answers 500 for a database error nobody anticipated', () => {
    const { status, body } = run(known('P2010'));
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe('An unexpected database error occurred.');
  });

  it('never writes the query arguments of a rejected query to the log', () => {
    const error = new Prisma.PrismaClientValidationError('Invalid invocation:\n{ where: { description: { contains: "secret-search" } } }\nUnknown argument `bogus`.', { clientVersion: 'test' });
    run(error);
    const logged = errorLog.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).not.toContain('secret-search');
    expect(logged).toContain('Unknown argument');
  });

  it('leaves HTTP exceptions alone', () => {
    expect(run(new HttpException('nope', 403)).status).toBe(403);
  });
});

describe('describePrismaMeta', () => {
  it('keeps names and drops everything else', () => {
    expect(describePrismaMeta({ modelName: 'PaymentRecord', column: 'remarks', query: 'SELECT secret', values: [1] })).toBe('modelName=PaymentRecord column=remarks');
    expect(describePrismaMeta({ target: ['company_id', 'client_submission_id'] })).toBe('target=company_id,client_submission_id');
    expect(describePrismaMeta(undefined)).toBe('');
  });
});
