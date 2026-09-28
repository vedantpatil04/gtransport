import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { FilesService } from '../files/files.service';
import { ClassifyMessageDto, InboxQuery, SetInboxStatusDto, SyncInboxDto } from './dto/inbox.dto';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';
import { presentInboxDetail, presentInboxRow } from './inbox.presenter';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * The office inbox.
 *
 * Office roles read; the roles that run the fleet trigger a synchronisation or a re-classification.
 * A driver has no access at all — company mail is not theirs to read, and the guard refuses it
 * before any handler runs.
 *
 * Nothing here sends, replies to, forwards or deletes a message. The provider interface has no
 * method for it (§21).
 */
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly sync: InboxSyncService,
    private readonly files: FilesService,
  ) {}

  /** Whether a mailbox is connected, and how the last synchronisation went. */
  @Get('status')
  @Roles(...OFFICE_ROLES)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.status(user.companyId);
  }

  /** Contacts the mailbox now, and says plainly what happened. */
  @Post('verify-connection')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  verifyConnection() {
    return this.sync.verifyConnection();
  }

  @Get('summary')
  @Roles(...OFFICE_ROLES)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.summary(user.companyId);
  }

  @Get('messages')
  @Roles(...OFFICE_ROLES)
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: InboxQuery) {
    const page = await this.inbox.list(user.companyId, query);
    return { ...page, data: page.data.map(presentInboxRow) };
  }

  /**
   * Runs a synchronisation on demand.
   *
   * Returns what actually happened — fetched, filed, already known, failed — rather than a bare
   * success, so "synced" can never mean "we contacted nothing" (§39).
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  async runSync(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncInboxDto) {
    const outcome = await this.sync.sync(user.companyId, { limit: dto.limit, actorUserId: user.id });
    // Classification follows ingestion, bounded so one request cannot run away.
    const classified = outcome.ok ? await this.inbox.classifyPending(user.companyId, 10) : { processed: 0, failed: 0 };
    return { ...outcome, classified };
  }

  @Get('messages/:id')
  @Roles(...OFFICE_ROLES)
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentInboxDetail(await this.inbox.findOne(user.companyId, id));
  }

  @Patch('messages/:id/status')
  @Roles(...OFFICE_ROLES)
  setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: SetInboxStatusDto) {
    return this.inbox.setStatus(user, id, dto.status);
  }

  /** A person setting the category. From here on no AI run will change it. */
  @Patch('messages/:id/classification')
  @Roles(...OFFICE_ROLES)
  classify(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ClassifyMessageDto) {
    return this.inbox.classify(user, id, dto.classification);
  }

  @Post('messages/:id/retry-ai')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  retryAI(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.inbox.retryClassification(user, id);
  }

  /**
   * Streams a stored attachment.
   *
   * Goes through the same file service as every other download, so the company check and the
   * role check are the ones already in place — and the storage credentials never leave the
   * server (§17, §24). Served as an attachment, never inline, so nothing renders in the browser.
   */
  @Get('messages/:id/attachments/:attachmentId')
  @Roles(...OFFICE_ROLES)
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('attachmentId', uuid()) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const fileId = await this.inbox.attachmentFileId(user.companyId, id, attachmentId);
    const file = await this.files.readFor(user, fileId);

    res.setHeader('Content-Type', file.mimeType);
    // Downloaded, never displayed: an inbound file is untrusted whatever its type says.
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(Buffer.from(file.bytes));
  }
}

/** Kept out of the class above so the role list reads in one place. */
export const INBOX_DRIVER_ACCESS: UserRole[] = [];
