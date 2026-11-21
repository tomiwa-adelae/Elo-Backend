import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export interface InitializeTransactionArgs {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializedTransaction {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackChargeData {
  reference: string;
  amount: number;
  status: string;
  channel?: string;
  currency?: string;
  paid_at?: string;
  customer?: { email?: string };
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  private get secretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'PAYSTACK_SECRET_KEY is not configured',
      );
    }
    return key;
  }

  /**
   * Creates a pending transaction and returns the hosted checkout URL.
   *
   * Paystack works in kobo, which is also how amounts are stored, so no
   * conversion happens anywhere in this flow.
   */
  async initializeTransaction(
    args: InitializeTransactionArgs,
  ): Promise<InitializedTransaction> {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: args.email,
          amount: args.amountKobo,
          reference: args.reference,
          callback_url: args.callbackUrl,
          metadata: args.metadata,
        }),
      },
    );

    const body = (await response.json()) as PaystackEnvelope<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>;

    if (!response.ok || !body.status) {
      this.logger.error(
        `Paystack initialize failed (${response.status}): ${body?.message}`,
      );
      throw new InternalServerErrorException(
        'Could not start payment. Please try again.',
      );
    }

    return {
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code,
      reference: body.data.reference,
    };
  }

  /**
   * Server-side confirmation of a transaction.
   *
   * Used to reconcile when a webhook is missed — never trusted from the
   * browser redirect, which the shopper can forge.
   */
  async verifyTransaction(reference: string): Promise<PaystackChargeData> {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.secretKey}` } },
    );

    const body =
      (await response.json()) as PaystackEnvelope<PaystackChargeData>;

    if (!response.ok || !body.status) {
      this.logger.error(
        `Paystack verify failed for ${reference}: ${body?.message}`,
      );
      throw new InternalServerErrorException('Could not verify payment');
    }

    return body.data;
  }

  /**
   * Validates the `x-paystack-signature` header: HMAC SHA512 of the raw
   * request body keyed with the secret.
   *
   * Must run against the exact bytes received — re-serialising the parsed JSON
   * changes key order and whitespace and the digest stops matching. That is
   * what the rawBody capture in main.ts exists for.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;

    const expected = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');

    // Length must match before timingSafeEqual, which throws otherwise.
    if (expectedBuffer.length !== receivedBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}
