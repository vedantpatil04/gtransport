import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentProvider } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { PAYOUT_PROVIDER, type PayoutProvider } from './payment-providers';

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;
const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

/** "ramesh.kumar@okaxis" → "ra****@okaxis". */
export const maskUpi = (upi: string) => {
  const [name, handle] = upi.split('@');
  return `${(name ?? '').slice(0, 2)}****@${handle ?? ''}`;
};

export interface PayoutAccountInput {
  method: PaymentMethod;
  accountHolderName: string;
  ifsc?: string;
  accountNumber?: string;
  upiId?: string;
}

/**
 * Where an employee's payouts go. The full account number or UPI ID is sent to RazorpayX once,
 * to create a fund account, and is never stored or logged here: we keep the provider's ids and
 * a masked summary only. Without RazorpayX configured there is nothing to create, so this
 * refuses — manual payments do not need it.
 */
@Injectable()
export class PayoutAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  async get(companyId: string, employeeId: string) {
    return this.prisma.employeePayoutAccount.findFirst({
      where: { companyId, employeeId },
      select: { method: true, accountHolderName: true, ifsc: true, accountNumberLast4: true, upiIdMasked: true, provider: true, updatedAt: true },
    });
  }

  async save(user: AuthenticatedUser, employeeId: string, input: PayoutAccountInput) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId, deletedAt: null }, select: { id: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (!this.provider.enabled) throw new BadRequestException('Online payouts are not configured, so payout accounts cannot be added yet.');

    const name = input.accountHolderName.trim();
    let details: { ifsc: string | null; accountNumberLast4: string | null; upiIdMasked: string | null };
    let request;
    if (input.method === PaymentMethod.UPI) {
      const upi = input.upiId?.trim() ?? '';
      if (!UPI.test(upi)) throw new BadRequestException('Enter a valid UPI ID, e.g. name@okaxis.');
      details = { ifsc: null, accountNumberLast4: null, upiIdMasked: maskUpi(upi) };
      request = { name, referenceId: employee.id, upi: { address: upi } };
    } else if (input.method === PaymentMethod.BANK_TRANSFER) {
      const ifsc = input.ifsc?.trim().toUpperCase() ?? '';
      const account = input.accountNumber?.replace(/\s/g, '') ?? '';
      if (!IFSC.test(ifsc)) throw new BadRequestException('Enter a valid IFSC, e.g. SBIN0001234.');
      if (!ACCOUNT.test(account)) throw new BadRequestException('Enter a valid account number (9–18 digits).');
      details = { ifsc, accountNumberLast4: account.slice(-4), upiIdMasked: null };
      request = { name, referenceId: employee.id, bankAccount: { ifsc, accountNumber: account } };
    } else {
      throw new BadRequestException('Payout accounts are for UPI or bank transfer.');
    }

    const { contactId, fundAccountId } = await this.provider.createFundAccount(request);
    const data = { method: input.method, accountHolderName: name, ...details, provider: PaymentProvider.RAZORPAYX, providerContactId: contactId, providerFundAccountId: fundAccountId, updatedById: user.id };
    await this.prisma.employeePayoutAccount.upsert({
      where: { employeeId: employee.id },
      create: { companyId: user.companyId, employeeId: employee.id, ...data, createdById: user.id },
      update: data,
    });
    // Only masked details reach the audit trail.
    await this.audit.record({ action: 'payout_account.saved', entityType: 'Employee', entityId: employee.id, companyId: user.companyId, actorUserId: user.id, actorRole: user.role, changes: { method: input.method, ...details } });
    return this.get(user.companyId, employee.id);
  }
}
