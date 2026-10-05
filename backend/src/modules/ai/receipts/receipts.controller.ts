import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { requireDriverScope } from '../../auth/access-scope';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { CurrentUser, Roles } from '../../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../../auth/roles';
import { AppConfigService } from '../../../config/app-config.service';
import { ReceiptAIService } from '../receipt-ai.service';
import { MaintenanceIntelligenceService } from './maintenance-intelligence.service';
import { ReceiptJobService } from './receipt-job.service';
import { ReceiptReviewService } from './receipt-review.service';
import { presentDriverReceipt, presentPendingReceipt, presentReceiptReview } from './receipt.presenter';
import {
  MyReceiptsQuery, PendingReceiptsQuery, RejectExtractionDto, ReopenServiceReceiptDto, VerifyServiceReceiptDto,
} from './dto/receipt-review.dto';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * Service receipt AI: review, verification and maintenance intelligence.
 *
 * Uploading is not here. A service receipt arrives through the existing
 * `POST /operations/mine` flow, which already stores the file and creates the maintenance
 * record — Phase 7 hooks AI onto that rather than adding a second way to submit the same
 * thing (§27: do not duplicate controllers for functionality that already exists).
 *
 * Roles follow the rest of the application: the office reads, the fleet-managing roles decide.
 * Verification changes a financial figure, so it is limited to the roles that may change one
 * anywhere else in the system, and a driver can only ever see their own uploads.
 */
@Controller('service-receipts')
export class ServiceReceiptsController {
  constructor(
    private readonly review: ReceiptReviewService,
    private readonly jobs: ReceiptJobService,
    private readonly intelligence: MaintenanceIntelligenceService,
    private readonly ai: ReceiptAIService,
    private readonly config: AppConfigService,
  ) {}

  // ── Driver ──

  /**
   * A driver's own service uploads, with a plain state each. No AI detail (§33).
   *
   * Scoped by the session: there is no driver id on the route, so one driver cannot ask for
   * another's uploads.
   */
  @Get('mine')
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyReceiptsQuery) {
    const { driverId } = requireDriverScope(user);
    const rows = await this.review.driverStatus(user.companyId, driverId, query.limit);
    return { data: rows.map(presentDriverReceipt) };
  }

  // ── Office: the review queue ──

  /** Receipts waiting on a person, newest first. */
  @Get('pending')
  @Roles(...OFFICE_ROLES)
  async pending(@CurrentUser() user: AuthenticatedUser, @Query() query: PendingReceiptsQuery) {
    const page = await this.review.pending(user.companyId, query);
    return { ...page, data: page.data.map(presentPendingReceipt) };
  }

  /**
   * The state of the processing queue, and what is doing the processing.
   *
   * The configured provider and model are reported, and so is whether the in-process worker is
   * running: a queue holding twelve receipts means something quite different when nothing is
   * draining it, and the office should be able to see which of the two it is looking at (§39).
   */
  @Get('queue')
  @Roles(...OFFICE_ROLES)
  async queue(@CurrentUser() user: AuthenticatedUser) {
    const counts = await this.jobs.queueStatus(user.companyId);
    return { ...counts, ...this.ai.describeProvider(), workerEnabled: this.config.ai.workerEnabled };
  }

  /** Fleet-wide maintenance intelligence: due and overdue services, repeated issues, recent work. Verified records only. */
  @Get('maintenance/summary')
  @Roles(...OFFICE_ROLES)
  maintenanceSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.intelligence.fleetSummary(user.companyId);
  }

  /**
   * What one vehicle's verified service history suggests.
   *
   * Everything in the response is an observation or an estimate, and the `basis` field says so
   * explicitly — the UI is never left to decide how much authority to give these numbers (§13).
   */
  @Get('maintenance/vehicles/:vehicleId')
  @Roles(...OFFICE_ROLES)
  vehicleIntelligence(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', uuid()) vehicleId: string) {
    return this.intelligence.forVehicle(user.companyId, vehicleId);
  }

  // ── Office: one record ──

  /** The review screen's payload. Declared after the literal paths above. */
  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentReceiptReview(await this.review.review(user.companyId, id));
  }

  /**
   * Verifies the service record, with any corrections the reviewer made.
   *
   * The submitted values become the record and the record becomes authoritative. Restricted to
   * the roles that may change a financial figure elsewhere in the system.
   */
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: VerifyServiceReceiptDto) {
    return this.review.verify(user, id, dto);
  }

  /** Marks the extraction unusable. The receipt and the typed values are untouched. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: RejectExtractionDto) {
    return this.review.reject(user, id, dto.reason);
  }

  /**
   * Re-opens a record a person settled — the controlled reprocessing workflow (§14).
   *
   * Deliberately the narrowest permission here: undoing a verification is an administrative act,
   * not part of ordinary review.
   */
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ReopenServiceReceiptDto) {
    return this.review.reopen(user, id, dto.reason);
  }

  /** Reads the receipt again. Refused outright for a record a person has already settled. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...FLEET_MANAGE_ROLES, UserRole.ACCOUNTING)
  retry(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.review.retry(user, id);
  }
}
