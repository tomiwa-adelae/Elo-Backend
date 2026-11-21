import { randomInt } from 'crypto';

const PREFIX = process.env.ORDER_PREFIX ?? 'ORD';

/**
 * Human-quotable order reference, e.g. ORD-6X4K2M.
 *
 * Deliberately not sequential: a guessable order number combined with the
 * guest lookup endpoint would let anyone enumerate other people's orders.
 * Ambiguous characters (0/O, 1/I) are excluded because these get read aloud
 * over the phone to support.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateOrderNumber(): string {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${PREFIX}-${suffix}`;
}

/**
 * Paystack references must be unique per transaction. Tying it to the order
 * number keeps support able to match a charge to an order at a glance, while
 * the timestamp keeps retries of a failed payment distinct.
 */
export function generatePaymentReference(orderNumber: string): string {
  return `${orderNumber}-${Date.now().toString(36).toUpperCase()}`;
}
