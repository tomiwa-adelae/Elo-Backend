import { frontendPath } from '../utils/frontendUrl';
import { formatMoney, type Currency } from '../money/money';

// Email clients strip <style> blocks unpredictably, so everything here is
// inline-styled. Table-free layout is fine for the clients that matter in
// 2026; Outlook desktop is the only holdout and it degrades to a plain stack.

// Holder rather than a const so SettingsService can rename the store at
// runtime without a redeploy. Env is only the fallback before settings load.
export const brand = { name: process.env.STORE_NAME ?? 'The Store' };

export function setMailBrand(name: string) {
  if (name.trim()) brand.name = name.trim();
}

// ELO's palette: warm cream paper, soft ink, lilac ribbon.
const INK = '#2B2A26';
const MUTED = '#7A766D';
const PAPER = '#F7F4EF';
const LILAC = '#9B7FD1';
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif";

function shell(
  heading: string,
  body: string,
  action?: { label: string; url: string },
): string {
  const button = action
    ? `<a href="${action.url}" style="display:inline-block;padding:14px 30px;background:${INK};color:#ffffff;text-decoration:none;border-radius:999px;font-family:${SANS};font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">${action.label}</a>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,400&family=Outfit:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-family:${SERIF};font-size:40px;letter-spacing:0.08em;color:${INK};line-height:1;">${brand.name}</div>
        <div style="font-family:${SERIF};font-style:italic;font-size:15px;color:${MUTED};margin-top:6px;">Softly worn. Everyday ease.</div>
      </div>
      <div style="background:#ffffff;border-radius:18px;padding:36px 32px;border-top:4px solid ${LILAC};">
        <h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:500;font-size:30px;line-height:1.15;color:${INK};">${heading}</h1>
        <div style="font-size:15px;line-height:1.65;color:#4a4842;">${body}</div>
        ${button ? `<div style="margin-top:30px;">${button}</div>` : ''}
      </div>
      <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
        Hand-wrapped in Lagos with love.<br />
        Questions? Reply to this email or write to
        ${process.env.SUPPORT_EMAIL_ADDRESS ?? 'us'}.
      </p>
    </div>
  </body>
</html>`;
}

function otpBlock(code: string): string {
  return `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:${INK};font-family:monospace;">${code}</p>`;
}

export function welcomeEmail(firstName?: string | null) {
  return {
    subject: `Welcome to ${brand.name}`,
    html: shell(
      `Welcome${firstName ? `, ${firstName}` : ''}`,
      `<p style="margin:0;">Your account is ready. You're one of the Softies now. Track orders, save your address and check out faster next time.</p>`,
      { label: 'Start shopping', url: frontendPath('/shop') },
    ),
  };
}

export function verifyEmail(code: string) {
  return {
    subject: `Your ${brand.name} verification code`,
    html: shell(
      'Confirm your email',
      `<p style="margin:0;">Enter this code to finish setting up your account. It expires in 15 minutes.</p>
       ${otpBlock(code)}
       <p style="margin:0;color:${MUTED};font-size:13px;">If you didn't create an account, you can ignore this email.</p>`,
    ),
  };
}

export function forgotPasswordEmail(code: string) {
  return {
    subject: `Reset your ${brand.name} password`,
    html: shell(
      'Reset your password',
      `<p style="margin:0;">Use this code to set a new password. It expires in 15 minutes.</p>
       ${otpBlock(code)}
       <p style="margin:0;color:${MUTED};font-size:13px;">Didn't request this? Your password is unchanged and no action is needed.</p>`,
    ),
  };
}

export function passwordChangedEmail() {
  return {
    subject: `Your ${brand.name} password was changed`,
    html: shell(
      'Your password was changed',
      `<p style="margin:0;">This is a confirmation that the password on your account was just updated.</p>
       <p style="margin:16px 0 0;">If this wasn't you, reset your password immediately and contact support.</p>`,
      { label: 'Reset password', url: frontendPath('/forgot-password') },
    ),
  };
}

// ── order emails ────────────────────────────────────────────────────────────

export interface OrderEmailData {
  orderNumber: string;
  email: string;
  items: {
    productTitle: string;
    variantTitle: string;
    quantity: number;
    totalKobo: number;
    image?: string | null;
  }[];
  subtotalKobo: number;
  discountKobo: number;
  deliveryKobo: number;
  totalKobo: number;
  currency: Currency;
  shippingAddress: unknown;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemsBlock(order: OrderEmailData): string {
  const money = (minor: number) => formatMoney(minor, order.currency);
  const rows = order.items
    .map(
      (item) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #efebe4;">
        <div>
          <div style="font-weight:600;color:${INK};">${escapeHtml(item.productTitle)}</div>
          <div style="font-size:13px;color:${MUTED};">${escapeHtml(item.variantTitle || 'Standard')} × ${item.quantity}</div>
        </div>
        <div style="white-space:nowrap;color:${INK};">${money(item.totalKobo)}</div>
      </div>`,
    )
    .join('');

  const line = (label: string, value: string, bold = false) =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;${bold ? `font-weight:700;color:${INK};font-size:16px;` : ''}"><span>${label}</span><span>${value}</span></div>`;

  return `
    <div style="margin:20px 0;">${rows}</div>
    ${line('Subtotal', money(order.subtotalKobo))}
    ${order.discountKobo ? line('Discount', `−${money(order.discountKobo)}`) : ''}
    ${line('Delivery', order.deliveryKobo ? money(order.deliveryKobo) : 'Free')}
    ${line('Total', money(order.totalKobo), true)}`;
}

function addressBlock(address: unknown): string {
  if (!address || typeof address !== 'object') return '';
  const a = address as Record<string, string | undefined>;
  const parts = [
    a.fullName,
    a.line1,
    a.line2,
    a.landmark && `Landmark: ${a.landmark}`,
    [a.city, a.state, a.postalCode].filter(Boolean).join(', '),
    a.country && a.countryCode !== 'NG' ? a.country : undefined,
    a.phoneNumber,
  ]
    .filter(Boolean)
    .map((p) => escapeHtml(String(p)));
  return `<p style="margin:20px 0 0;font-size:13px;color:${MUTED};">Delivering to</p><p style="margin:4px 0 0;">${parts.join('<br/>')}</p>`;
}

function orderLink(order: OrderEmailData) {
  return {
    label: 'View your order',
    url: frontendPath(
      `/orders/lookup?order=${encodeURIComponent(order.orderNumber)}&email=${encodeURIComponent(order.email)}`,
    ),
  };
}

export function orderConfirmedEmail(
  order: OrderEmailData,
  payOnDelivery: boolean,
) {
  return {
    subject: `Order ${order.orderNumber} confirmed`,
    html: shell(
      'Thank you for your order',
      `<p style="margin:0;">${
        payOnDelivery
          ? `We've received order <strong>${order.orderNumber}</strong>. Please have <strong>${formatMoney(order.totalKobo, order.currency)}</strong> ready when it arrives.`
          : `We've received your payment and order <strong>${order.orderNumber}</strong> is confirmed. We'll hand-fold it, wrap it in ELO tissue and let you know the moment it ships.`
      }</p>
       ${itemsBlock(order)}
       ${addressBlock(order.shippingAddress)}`,
      orderLink(order),
    ),
  };
}

export function orderShippedEmail(
  order: OrderEmailData,
  tracking?: {
    carrier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  },
) {
  const trackingLine = tracking?.trackingNumber
    ? `<p style="margin:16px 0 0;">${escapeHtml(tracking.carrier ?? 'Tracking')}: <strong>${escapeHtml(tracking.trackingNumber)}</strong></p>`
    : '';
  return {
    subject: `Order ${order.orderNumber} is on its way`,
    html: shell(
      'Your order is on its way',
      `<p style="margin:0;">Good news: order <strong>${order.orderNumber}</strong> has been sent out for delivery.</p>${trackingLine}${addressBlock(order.shippingAddress)}`,
      tracking?.trackingUrl
        ? { label: 'Track delivery', url: tracking.trackingUrl }
        : orderLink(order),
    ),
  };
}

export function orderDeliveredEmail(order: OrderEmailData) {
  return {
    subject: `Order ${order.orderNumber} delivered`,
    html: shell(
      'Your order was delivered',
      `<p style="margin:0;">Order <strong>${order.orderNumber}</strong> has been delivered. We hope it feels like a soft hug. Tag us <strong>@elo_brandshop</strong> when you wear it.</p>`,
      orderLink(order),
    ),
  };
}

export function orderCancelledEmail(
  order: OrderEmailData,
  reason?: string | null,
) {
  return {
    subject: `Order ${order.orderNumber} cancelled`,
    html: shell(
      'Your order was cancelled',
      `<p style="margin:0;">Order <strong>${order.orderNumber}</strong> has been cancelled.${reason ? ` Reason: ${escapeHtml(reason)}.` : ''}</p>
       <p style="margin:16px 0 0;">If you paid for this order, our team will contact you about your refund.</p>`,
    ),
  };
}

export function newOrderAdminEmail(order: OrderEmailData, method: string) {
  return {
    subject: `New order ${order.orderNumber} · ${formatMoney(order.totalKobo, order.currency)}`,
    html: shell(
      `New order ${order.orderNumber}`,
      `<p style="margin:0;">${escapeHtml(order.email)} placed an order (${escapeHtml(method)}).</p>${itemsBlock(order)}${addressBlock(order.shippingAddress)}`,
      {
        label: 'Open in admin',
        url: frontendPath(
          `/admin/orders/${encodeURIComponent(order.orderNumber)}`,
        ),
      },
    ),
  };
}

export function subscriberWelcomeEmail() {
  return {
    subject: `You're on the list · ${brand.name}`,
    html: shell(
      'Welcome to the Softies',
      `<p style="margin:0;">You'll be first to hear about new colours, restocks and the occasional founder's note. Nothing more, and you can unsubscribe any time.</p>`,
      { label: 'Shop the collection', url: frontendPath('/shop') },
    ),
  };
}

export function backInStockEmail(data: {
  productTitle: string;
  variantLabel: string;
  productSlug: string;
  colour?: string | null;
  image?: string | null;
}) {
  const url = frontendPath(
    `/products/${data.productSlug}${data.colour ? `?colour=${encodeURIComponent(data.colour)}` : ''}`,
  );
  const image = data.image
    ? `<img src="${data.image.startsWith('http') ? data.image : frontendPath(data.image)}" alt="" width="160" style="display:block;width:160px;max-width:100%;border-radius:12px;margin:0 0 20px;" />`
    : '';
  return {
    subject: `It's back: ${data.productTitle} · ${brand.name}`,
    html: shell(
      'Good news, it’s back',
      `${image}<p style="margin:0;">The <strong>${escapeHtml(data.productTitle)}</strong>${data.variantLabel ? ` in ${escapeHtml(data.variantLabel)}` : ''} is back in stock. Our restocks go quickly, so we wanted you to hear first.</p>`,
      { label: 'Shop it now', url },
    ),
  };
}
