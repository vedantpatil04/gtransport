import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AiModule } from '../ai/ai.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { FilesModule } from '../files/files.module';
import { EMAIL_PROVIDER, MAILBOX_FETCH, MAILBOX_OAUTH_CLIENT } from './inbox.tokens';
import { ImapEmailProvider } from './providers/imap.provider';
import type { EmailProvider } from './email-provider';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';
import { InboxSyncScheduler } from './inbox-sync.scheduler';
import { MailboxConnectionService } from './mailbox-connection.service';

/**
 * The office inbox: a dedicated company mailbox, normalised, classified and reviewable.
 *
 * Which mailbox is read follows EMAIL_PROVIDER:
 *  - `gmail` / `microsoft_graph`: the company's own mailbox, connected by an administrator through
 *    OAuth consent and read through the provider's official API (MailboxConnectionService).
 *  - `imap`: one mailbox for the deployment, from the environment (bound to EMAIL_PROVIDER here).
 *  - `none` (default): nothing. The Inbox then says plainly that nothing is connected rather than
 *    showing an empty list that looks like an empty mailbox — the two mean very different things
 *    to whoever is waiting for an invoice.
 */
@Module({
  imports: [FilesModule, AuditModule, AiModule, ExpensesModule],
  controllers: [InboxController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): EmailProvider | null => {
        const email = config.email;
        const logger = new Logger('InboxModule');

        if (email.provider === 'none') {
          logger.log('No inbound mailbox is configured (EMAIL_PROVIDER=none).');
          return null;
        }
        if (email.provider === 'gmail' || email.provider === 'microsoft_graph') {
          logger.log(`Inbound mailbox: ${email.provider === 'gmail' ? 'Gmail API' : 'Microsoft Graph'}, connected per company through OAuth.`);
          return null;
        }

        const provider = new ImapEmailProvider({
          host: email.imap.host,
          port: email.imap.port,
          secure: email.imap.secure,
          user: email.imap.user,
          password: email.imap.password,
          mailbox: email.imap.mailbox,
          maxBodyChars: email.maxBodyChars,
        });

        // The host and mailbox are operational facts worth logging. The user and password are not.
        logger.log(`Inbound mailbox: IMAP ${email.imap.host}:${email.imap.port} (${email.imap.mailbox}).`);
        return provider;
      },
    },
    // Unbound in production: the OAuth client is built from configuration and the adapters use the
    // platform fetch. Registered as null so a test can replace the transport — and only a test.
    { provide: MAILBOX_OAUTH_CLIENT, useValue: null },
    { provide: MAILBOX_FETCH, useValue: null },
    MailboxConnectionService,
    InboxService,
    InboxSyncService,
    InboxSyncScheduler,
  ],
  exports: [InboxService, InboxSyncService, MailboxConnectionService],
})
export class InboxModule {}
