import { Controller, Headers, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { WebhooksService } from './webhooks.service';

/**
 * Provider callbacks. Public — RazorpayX has no user session — so authenticity rests entirely
 * on the signature, which the service checks against the raw body before anything else.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('razorpayx')
  @Public()
  @HttpCode(HttpStatus.OK)
  razorpayx(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    return this.webhooks.handleRazorpayX(req.rawBody, signature, eventId);
  }
}
