import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { FilesModule } from '../files/files.module';
import { FinanceModule } from '../finance/finance.module';
import { PAYOUT_PROVIDER, type PayoutProvider } from './payment-providers';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PayoutAccountsService } from './payout-accounts.service';
import { DisabledPayoutProvider, RazorpayXPayoutProvider } from './providers/razorpayx-payout.provider';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Payment execution: payment records, their state machine, and payouts through RazorpayX.
 * The provider is chosen from configuration; with none configured, manual payments still work
 * and anything that would move money online refuses clearly.
 */
@Module({
  imports: [FinanceModule, FilesModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [
    PaymentsService,
    PayoutAccountsService,
    WebhooksService,
    {
      provide: PAYOUT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PayoutProvider => {
        const { provider, razorpayx } = config.payouts;
        if (provider !== 'razorpayx') return new DisabledPayoutProvider();
        return new RazorpayXPayoutProvider({
          baseUrl: razorpayx.baseUrl,
          keyId: razorpayx.keyId!,
          keySecret: razorpayx.keySecret!,
          accountNumber: razorpayx.accountNumber!,
          webhookSecret: razorpayx.webhookSecret!,
        });
      },
    },
  ],
})
export class PaymentsModule {}
