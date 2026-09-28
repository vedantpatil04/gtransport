import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the RazorpayX API, used by tests so the real adapter is exercised over
 * real HTTP without any credentials. It mirrors the documented behaviour that matters:
 *  - POST /v1/payouts requires X-Payout-Idempotency;
 *  - repeating a key returns the SAME payout (no second transfer);
 *  - reusing a key with a different body is rejected (400).
 * Tests can make it time out, fail with 5xx, or reject, to drive every error path.
 */
export interface MockPayout {
  id: string;
  amount: number;
  status: string;
  fund_account_id: string;
  reference_id: string;
  utr: string | null;
}

export class MockRazorpayX {
  private server!: Server;
  readonly payouts = new Map<string, MockPayout>();
  private readonly byKey = new Map<string, { id: string; body: string }>();
  readonly requests: { method: string; path: string; idempotencyKey?: string; auth?: string }[] = [];
  /** Next behaviour for POST /v1/payouts, consumed once. */
  nextPayout: 'ok' | 'hang' | 'server-error' | 'reject' = 'ok';
  /** Random like RazorpayX's own ids, so reruns against the same database never collide. */
  private id = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Number of distinct payouts actually created — the figure that must never double. */
  get payoutCount(): number {
    return this.payouts.size;
  }

  setStatus(id: string, status: string, utr: string | null = null): MockPayout {
    const payout = this.payouts.get(id)!;
    payout.status = status;
    payout.utr = utr;
    return payout;
  }

  /** A webhook body and its signature, exactly as RazorpayX would send them. */
  webhook(secret: string, event: string, payout: MockPayout, failureReason?: string) {
    const body = JSON.stringify({
      entity: 'event',
      event,
      payload: { payout: { entity: { ...payout, ...(failureReason ? { failure_reason: failureReason } : {}) } } },
      created_at: Math.floor(Date.now() / 1000),
    });
    return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const key = req.headers['x-payout-idempotency'] as string | undefined;
    this.requests.push({ method: req.method ?? '', path: req.url ?? '', idempotencyKey: key, auth: req.headers.authorization });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && req.url === '/v1/contacts') return send(200, { id: this.id('cont') });
    if (req.method === 'POST' && req.url === '/v1/fund_accounts') return send(200, { id: this.id('fa') });

    if (req.method === 'GET' && req.url?.startsWith('/v1/payouts/')) {
      const payout = this.payouts.get(decodeURIComponent(req.url.slice('/v1/payouts/'.length)));
      return payout ? send(200, payout) : send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'Not found' } });
    }

    if (req.method === 'POST' && req.url === '/v1/payouts') {
      const behaviour = this.nextPayout;
      this.nextPayout = 'ok';
      if (!key) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Idempotency key is missing.', field: 'X-Payout-Idempotency' } });

      const seen = this.byKey.get(key);
      if (seen) {
        if (seen.body !== raw) return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Different request body for the same idempotency key.' } });
        return send(200, this.payouts.get(seen.id));
      }
      if (behaviour === 'reject') return send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Invalid fund account' } });

      // "hang" and "server-error" still create the payout first — the dangerous case, where the
      // provider acted but the caller never learned of it.
      const body = JSON.parse(raw) as { amount: number; fund_account_id: string; reference_id: string };
      const payout: MockPayout = { id: this.id('pout'), amount: body.amount, status: 'queued', fund_account_id: body.fund_account_id, reference_id: body.reference_id, utr: null };
      this.payouts.set(payout.id, payout);
      this.byKey.set(key, { id: payout.id, body: raw });

      if (behaviour === 'hang') return; // never answer: the client times out
      if (behaviour === 'server-error') return send(502, { error: { code: 'SERVER_ERROR', description: 'Bad gateway' } });
      return send(200, payout);
    }
    send(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'Unknown route' } });
  }
}
