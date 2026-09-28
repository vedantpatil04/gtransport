import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AiModule } from '../ai/ai.module';
import { FilesModule } from '../files/files.module';
import { EMAIL_PROVIDER } from './inbox.tokens';
import { ImapEmailProvider } from './providers/imap.provider';
import type { EmailProvider } from './email-provider';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxSyncService } from './inbox-sync.service';
import { InboxSyncScheduler } from './inbox-sync.scheduler';

/**
 * The office inbox: a dedicated company mailbox, normalised, classified and reviewable.
 *
 * `EMAIL_PROVIDER` is bound to null when no mailbox is configured, which is the default. The
 * Inbox then says plainly that nothing is connected rather than showing an empty list that looks
 * like an empty mailbox — the two mean very different things to whoever is waiting for an invoice.
 */
@Module({
  imports: [FilesModule, AuditModule, AiModule],
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
    InboxService,
    InboxSyncService,
    InboxSyncScheduler,
  ],
  exports: [InboxService, InboxSyncService],
})
export class InboxModule {}
