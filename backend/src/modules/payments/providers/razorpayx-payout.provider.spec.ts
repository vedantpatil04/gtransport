import { Prisma } from '@prisma/client';
import { MockRazorpayX } from '../../../../test/mock-razorpayx';
import { PayoutOutcomeUnknownError, PayoutRejectedError } from '../payment-providers';
import { RazorpayXPayoutProvider, toPaise } from './razorpayx-payout.provider';

const SECRET = 'whsec_test_only';

describe('RazorpayX payout provider (against a mock RazorpayX)', () => {
  const mock = new MockRazorpayX();
  let provider: RazorpayXPayoutProvider;

  beforeAll(async () => {
    const baseUrl = await mock.start();
    provider = new RazorpayXPayoutProvider({ baseUrl, keyId: 'rzp_test_x', keySecret: 's', accountNumber: '7878780080316316', webhookSecret: SECRET, timeoutMs: 300 });
  });
  afterAll(() => mock.stop());

  const request = (key: string, amount = '18000.00') => ({
    idempotencyKey: key, amount: new Prisma.Decimal(amount), fundAccountId: 'fa_1', mode: 'IMPS' as const, purpose: 'salary' as const, referenceId: 'pay_1', narration: 'Salary Sep 2026',
  });

  it('sends amount in paise, basic auth, and the idempotency header', async () => {
    const result = await provider.createPayout(request('key-auth-1'));
    const sent = mock.requests.at(-1)!;

    expect(sent.idempotencyKey).toBe('key-auth-1');
    expect(sent.auth).toBe(`Basic ${Buffer.from('rzp_test_x:s').toString('base64')}`);
    expect(mock.payouts.get(result.providerReference)?.amount).toBe(1_800_000);
    expect(result).toMatchObject({ status: 'PROCESSING', rawStatus: 'queued' });
  });

  it('creates exactly one payout when the same request is retried with the same key', async () => {
    const before = mock.payoutCount;
    const a = await provider.createPayout(request('key-retry-1'));
    const b = await provider.createPayout(request('key-retry-1'));
    expect(b.providerReference).toBe(a.providerReference);
    expect(mock.payoutCount).toBe(before + 1);
  });

  it('reports a timeout as an UNKNOWN outcome, not a failure — the payout may exist', async () => {
    const before = mock.payoutCount;
    mock.nextPayout = 'hang';
    await expect(provider.createPayout(request('key-hang-1'))).rejects.toBeInstanceOf(PayoutOutcomeUnknownError);
    expect(mock.payoutCount).toBe(before + 1); // it was in fact created

    // Retrying with the SAME key finds it rather than creating another.
    const found = await provider.createPayout(request('key-hang-1'));
    expect(found.providerReference).toBeTruthy();
    expect(mock.payoutCount).toBe(before + 1);
  });

  it('reports a 5xx as an unknown outcome too', async () => {
    mock.nextPayout = 'server-error';
    await expect(provider.createPayout(request('key-5xx-1'))).rejects.toBeInstanceOf(PayoutOutcomeUnknownError);
  });

  it('reports a 4xx as a definitive rejection', async () => {
    mock.nextPayout = 'reject';
    await expect(provider.createPayout(request('key-400-1'))).rejects.toBeInstanceOf(PayoutRejectedError);
  });

  it('maps RazorpayX statuses, with only "processed" meaning paid', async () => {
    const { providerReference } = await provider.createPayout(request('key-status-1'));
    for (const [raw, ours] of [['processing', 'PROCESSING'], ['processed', 'PAID'], ['reversed', 'REVERSED'], ['failed', 'FAILED'], ['rejected', 'FAILED'], ['cancelled', 'CANCELLED']]) {
      mock.setStatus(providerReference, raw!);
      expect((await provider.getPayout(providerReference)).status).toBe(ours);
    }
  });

  it('never treats an unrecognised status as success or failure', async () => {
    const { providerReference } = await provider.createPayout(request('key-status-2'));
    mock.setStatus(providerReference, 'mystery');
    await expect(provider.getPayout(providerReference)).rejects.toBeInstanceOf(PayoutOutcomeUnknownError);
  });

  it('verifies webhook signatures over the raw body and rejects tampering', () => {
    const payout = { id: 'pout_x', amount: 100, status: 'processed', fund_account_id: 'fa', reference_id: 'r', utr: 'UTR1' };
    const { body, signature } = mock.webhook(SECRET, 'payout.processed', payout);

    expect(provider.verifyWebhookSignature(Buffer.from(body), signature)).toBe(true);
    expect(provider.verifyWebhookSignature(Buffer.from(body.replace('processed', 'reversed')), signature)).toBe(false);
    expect(provider.verifyWebhookSignature(Buffer.from(body), 'deadbeef')).toBe(false);
    expect(provider.verifyWebhookSignature(Buffer.from(body), undefined)).toBe(false);
    expect(provider.parseWebhook(JSON.parse(body))).toMatchObject({ eventType: 'payout.processed', providerReference: 'pout_x', status: 'PAID', utr: 'UTR1' });
  });

  it('converts rupees to exact paise and refuses fractions of a paisa', () => {
    expect(toPaise(new Prisma.Decimal('18000.50'))).toBe(1_800_050);
    expect(() => toPaise(new Prisma.Decimal('10.005'))).toThrow(PayoutRejectedError);
    expect(() => toPaise(new Prisma.Decimal('0.50'))).toThrow(/at least ₹1/);
  });

  it('creates a contact and fund account for a payee', async () => {
    await expect(provider.createFundAccount({ name: 'Ramesh Kumar', referenceId: 'emp_1', upi: { address: 'ramesh@upi' } })).resolves.toEqual({
      contactId: expect.stringMatching(/^cont_/),
      fundAccountId: expect.stringMatching(/^fa_/),
    });
  });
});
