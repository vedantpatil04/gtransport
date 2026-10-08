import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { PaginationQuery } from '../../common/pagination/pagination';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { PAYROLL_ROLES } from '../auth/roles';
import {
  CancelPaymentDto, CreatePaymentDto, PaymentProofDto, PaymentQueryDto, PayoutAccountDto, RecordManualDto, UpdatePaymentNotesDto,
} from './dto/payments.dto';
import { presentDriverPayment, presentPayment } from './payments.presenter';
import { PaymentsService } from './payments.service';
import { PayoutAccountsService } from './payout-accounts.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly accounts: PayoutAccountsService,
  ) {}

  /** Whether online payouts are configured — the UI hides "Send" when they are not. */
  @Get('config')
  @Roles(...PAYROLL_ROLES)
  config() {
    return { payoutsEnabled: this.payments.payoutsEnabled };
  }

  @Get('summary')
  @Roles(...PAYROLL_ROLES)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.summary(user.companyId);
  }

  /** A driver's own payments. The employee comes from the session, never the request. */
  @Get('mine')
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQuery) {
    const page = await this.payments.listForDriver(user, query);
    return { ...page, data: page.data.map(presentDriverPayment) };
  }

  @Get('payout-accounts/:employeeId')
  @Roles(...PAYROLL_ROLES)
  async payoutAccount(@CurrentUser() user: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return { account: await this.accounts.get(user.companyId, employeeId) };
  }

  @Put('payout-accounts/:employeeId')
  @Roles(...PAYROLL_ROLES)
  async savePayoutAccount(@CurrentUser() user: AuthenticatedUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: PayoutAccountDto) {
    return { account: await this.accounts.save(user, employeeId, dto) };
  }

  @Get()
  @Roles(...PAYROLL_ROLES)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaymentQueryDto) {
    const page = await this.payments.list(user.companyId, query);
    return { ...page, data: page.data.map(presentPayment) };
  }

  @Post()
  @Roles(...PAYROLL_ROLES)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto) {
    return presentPayment(await this.payments.create(user, dto));
  }

  @Get(':id')
  @Roles(...PAYROLL_ROLES)
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return presentPayment(await this.payments.find(user.companyId, id));
  }

  /** Description and remarks only; nothing financial about a payment is editable. */
  @Patch(':id')
  @Roles(...PAYROLL_ROLES)
  async updateNotes(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentNotesDto) {
    return presentPayment(await this.payments.updateNotes(user, id, dto));
  }

  /** Attach or replace the proof of payment (uploaded first through POST /files/documents). */
  @Post(':id/proof')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async attachProof(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentProofDto) {
    return presentPayment(await this.payments.attachProof(user, id, dto.fileId));
  }

  /** The proof itself — payroll roles only, unlike the general file route. */
  @Get(':id/proof')
  @Roles(...PAYROLL_ROLES)
  async proof(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.payments.readProof(user.companyId, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(file.bytes));
  }

  @Get(':id/history')
  @Roles(...PAYROLL_ROLES)
  history(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.history(user.companyId, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return presentPayment(await this.payments.approve(user, id));
  }

  /** Sends through RazorpayX. `outcome: unknown` means the payment awaits a status check. */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async send(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { payment, outcome } = await this.payments.send(user, id);
    return { outcome, payment: presentPayment(payment) };
  }

  @Post(':id/check-status')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async checkStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const { payment, outcome } = await this.payments.checkStatus(user, id);
    return { outcome, payment: presentPayment(payment) };
  }

  @Post(':id/record-manual')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async recordManual(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordManualDto) {
    return presentPayment(await this.payments.recordManual(user, id, dto));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...PAYROLL_ROLES)
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPaymentDto) {
    return presentPayment(await this.payments.cancel(user, id, dto.reason));
  }
}
