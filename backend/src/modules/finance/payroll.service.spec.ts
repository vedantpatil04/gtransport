import { BadRequestException } from '@nestjs/common';
import { money, netPayable, parsePeriod } from './payroll.service';

describe('payroll arithmetic', () => {
  it('recovers advances from the salary, exactly', () => {
    const net = netPayable({ baseSalary: money(25000), allowances: money(1500.25), advanceRecovery: money(2000.5), deductions: money(500) });
    expect(net.toFixed(2)).toBe('23999.75');
  });

  it('builds money from the decimal string, so float error never enters', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point; in rupees it must be exactly 0.30.
    expect(money(0.1).plus(money(0.2)).toFixed(2)).toBe('0.30');
    expect(money(0.1).plus(money(0.2)).equals(money(0.3))).toBe(true);
    expect(money(undefined).toFixed(2)).toBe('0.00');
  });

  it('can go negative, which the service then refuses', () => {
    expect(netPayable({ baseSalary: money(100), allowances: money(0), advanceRecovery: money(50), deductions: money(60) }).isNegative()).toBe(true);
  });
});

describe('parsePeriod', () => {
  it('turns a month into its first day', () => {
    expect(parsePeriod('2026-09').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(parsePeriod('2027-01').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it.each(['2026-13', '2026-00', '2026-9', 'Sept 2026', ''])('rejects %p', (value) => {
    expect(() => parsePeriod(value)).toThrow(BadRequestException);
  });
});
