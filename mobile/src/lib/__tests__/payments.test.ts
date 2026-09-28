import { driverPaymentState, rupees, type PaymentStatus } from '../api/payments';

describe('driver payment status', () => {
  it.each<[PaymentStatus, string]>([
    ['PAID', 'received'],
    ['APPROVED', 'processing'],
    ['PROCESSING', 'processing'],
    // Awaiting an office status check is an internal step: to the driver it is still processing.
    ['STATUS_REVIEW_REQUIRED', 'processing'],
    ['PENDING_APPROVAL', 'pending'],
    ['DRAFT', 'pending'],
    ['FAILED', 'failed'],
    ['CANCELLED', 'cancelled'],
    ['REVERSED', 'returned'],
  ])('%s is shown as %s', (status, expected) => {
    expect(driverPaymentState(status)).toBe(expected);
  });
});

describe('rupees', () => {
  it('formats exactly from the API string, with Indian grouping', () => {
    expect(rupees('23999.75')).toBe('₹23,999.75');
    expect(rupees('1250000.00')).toBe('₹12,50,000');
    expect(rupees('18000.00')).toBe('₹18,000');
    expect(rupees('0.10')).toBe('₹0.10');
  });

  it('never rounds paise that a float would lose', () => {
    expect(rupees('99999999.99')).toBe('₹9,99,99,999.99');
  });

  it('shows corrections with a real minus sign', () => {
    expect(rupees('-500.00')).toBe('−₹500');
  });
});
