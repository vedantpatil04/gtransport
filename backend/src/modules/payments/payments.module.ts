import { Module } from '@nestjs/common';

/**
 * Payment execution domain (RazorpayX payouts, Razorpay gateway). Phase 0 defines provider
 * contracts only — no credentials, no SDK, no network calls.
 */
@Module({})
export class PaymentsModule {}
