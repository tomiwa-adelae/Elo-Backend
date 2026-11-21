import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PaystackService, type PaystackChargeData } from './paystack.service';
import { PaymentsService } from './payments.service';
import { Public } from '../decorators/public.decorator';
import type { AppRequest } from '../types/request';

interface PaystackWebhookEvent {
  event: string;
  data: PaystackChargeData;
}

/**
 * Mounted at /webhook (outside the /api prefix — see the exclude in main.ts).
 *
 * Payment truth lives here, not in the browser redirect: the redirect can be
 * skipped, replayed, or forged, whereas this callback is signed and retried
 * by Paystack until it gets a 2xx.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly paystack: PaystackService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystack(
    @Req() req: AppRequest,
    @Headers('x-paystack-signature') signature: string,
  ) {
    if (!req.rawBody) {
      // Without the raw bytes the signature cannot be checked, and an
      // unverified webhook must never be trusted.
      this.logger.error('Webhook received without a raw body');
      throw new BadRequestException('Missing request body');
    }

    if (!this.paystack.verifyWebhookSignature(req.rawBody, signature)) {
      this.logger.warn('Rejected webhook with an invalid signature');
      throw new BadRequestException('Invalid signature');
    }

    const event = req.body as PaystackWebhookEvent;

    this.logger.log(
      `Paystack event ${event.event} for ${event.data?.reference}`,
    );

    switch (event.event) {
      case 'charge.success':
        await this.payments.confirmPayment(event.data);
        break;

      case 'charge.failed':
        await this.payments.failPayment(event.data, 'Charge failed');
        break;

      default:
        // Unhandled event types still get a 200 — anything else makes
        // Paystack retry an event we will never act on.
        this.logger.debug(`Ignoring unhandled event ${event.event}`);
    }

    return { received: true };
  }
}
