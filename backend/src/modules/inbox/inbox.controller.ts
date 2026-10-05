import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { FINANCE_MANAGE_ROLES, FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import { FilesService } from '../files/files.service';
import {
  AcceptSuggestionDto, ClassifyMessageDto, InboxQuery, RejectSuggestionDto, SetInboxStatusDto, SuggestionQuery, SyncInboxDto,
} from './dto/inbox.dto';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';
import { MailboxConnectionService } from './mailbox-connection.service';
import { presentInboxDetail, presentInboxRow, presentSuggestion } from './inbox.presenter';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/** Everyone who may decide at least one kind of suggestion; the service checks the kind. */
const SUGGESTION_DECIDERS = [...new Set([...FLEET_MANAGE_ROLES, ...FINANCE_MANAGE_ROLES, UserRole.ACCOUNTING])];

/**
 * The office inbox.
 *
 * Office roles read; the roles that run the fleet trigger a synchronisation or a re-classification;
 * only an administrator connects or disconnects the company mailbox. A driver has no access at all
 * — company mail is not theirs to read, and the guard refuses it before any handler runs.
 *
 * Nothing here sends, replies to, forwards or deletes a message. The provider interface has no
 * method for it and the OAuth scopes are read-only (§21).
 */
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly sync: InboxSyncService,
    private readonly connections: MailboxConnectionService,
    private readonly files: FilesService,
  ) {}

  /** Whether a mailbox is connected, by whom, and how the last synchronisation went. */
  @Get('status')
  @Roles(...OFFICE_ROLES)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.status(user.companyId);
  }

  // ── Connection (Gmail API / Microsoft Graph, OAuth) ──

  /** Starts OAuth consent. The console sends the browser to the returned provider URL. */
  @Post('connection/authorize')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.beginAuthorization(user);
  }

  /**
   * The provider's redirect after consent.
   *
   * Public because it is the provider sending the browser back, with no session attached. It
   * trusts nothing but the single-use state, and answers with a redirect to the console carrying
   * only an outcome code — never a token.
   */
  @Public()
  @Get('oauth/callback')
  async callback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.connections.completeAuthorization({ state, code, error });
    const target = this.connections.returnUrl(outcome);
    res.setHeader('Cache-Control', 'no-store');
    if (target) {
      res.redirect(HttpStatus.SEE_OTHER, target);
      return;
    }
    res
      .status(outcome.ok ? HttpStatus.OK : HttpStatus.BAD_REQUEST)
      .type('text/plain')
      .send(outcome.ok ? 'The mailbox is connected. You can close this window.' : `The mailbox could not be connected (${outcome.reason}).`);
  }

  /** Disconnects the company mailbox: tokens are erased and revoked where the provider allows. */
  @Post('connection/disconnect')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.disconnect(user);
  }

  /** Contacts the mailbox now, and says plainly what happened. */
  @Post('verify-connection')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  verifyConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.sync.verifyConnection(user.companyId);
  }

  // ── Mail ──

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
   * Returns what actually happened — pages read, filed, already known, failed — rather than a
   * bare success, so "synced" can never mean "we contacted nothing" (§39).
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  async runSync(@CurrentUser() user: AuthenticatedUser, @Body() dto: SyncInboxDto) {
    const outcome = await this.sync.sync(user.companyId, { limit: dto.limit, actorUserId: user.id, trigger: 'manual' });
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

  // ── Suggestions ──

  /** AI-proposed follow-ups awaiting a decision (or, by status, decided ones). */
  @Get('suggestions')
  @Roles(...OFFICE_ROLES)
  async suggestions(@CurrentUser() user: AuthenticatedUser, @Query() query: SuggestionQuery) {
    const page = await this.inbox.listSuggestions(user.companyId, query);
    return { ...page, data: page.data.map(presentSuggestion) };
  }

  /** Accepts a suggestion. The service checks the role against the kind of suggestion. */
  @Post('suggestions/:id/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(...SUGGESTION_DECIDERS)
  async accept(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: AcceptSuggestionDto) {
    return presentSuggestion(await this.inbox.acceptSuggestion(user, id, dto));
  }

  @Post('suggestions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...SUGGESTION_DECIDERS)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: RejectSuggestionDto) {
    return presentSuggestion(await this.inbox.rejectSuggestion(user, id, dto.note));
  }
}
