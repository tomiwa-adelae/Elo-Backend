import { frontendPath } from '../utils/frontendUrl';

// Email clients strip <style> blocks unpredictably, so everything here is
// inline-styled. Table-free layout is fine for the clients that matter in
// 2026; Outlook desktop is the only holdout and it degrades to a plain stack.

const BRAND = process.env.STORE_NAME ?? 'The Store';

function shell(
  heading: string,
  body: string,
  action?: { label: string; url: string },
): string {
  const button = action
    ? `<a href="${action.url}" style="display:inline-block;padding:12px 24px;background:#111111;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">${action.label}</a>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="background:#ffffff;border-radius:12px;padding:32px;">
        <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#111111;">${BRAND}</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111111;">${heading}</h1>
        <div style="font-size:15px;line-height:1.6;color:#444444;">${body}</div>
        ${button ? `<div style="margin-top:28px;">${button}</div>` : ''}
      </div>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#888888;text-align:center;">
        Sent by ${BRAND}. Need help? Reply to this email or contact
        ${process.env.SUPPORT_EMAIL_ADDRESS ?? 'support'}.
      </p>
    </div>
  </body>
</html>`;
}

function otpBlock(code: string): string {
  return `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#111111;font-family:monospace;">${code}</p>`;
}

export function welcomeEmail(firstName?: string | null) {
  return {
    subject: `Welcome to ${BRAND}`,
    html: shell(
      `Welcome${firstName ? `, ${firstName}` : ''}`,
      `<p style="margin:0;">Your account is ready. Browse the latest arrivals and save the pieces you like to your wishlist.</p>`,
      { label: 'Start shopping', url: frontendPath('/shop') },
    ),
  };
}

export function verifyEmail(code: string) {
  return {
    subject: `Your ${BRAND} verification code`,
    html: shell(
      'Confirm your email',
      `<p style="margin:0;">Enter this code to finish setting up your account. It expires in 15 minutes.</p>
       ${otpBlock(code)}
       <p style="margin:0;color:#888888;font-size:13px;">If you didn't create an account, you can ignore this email.</p>`,
    ),
  };
}

export function forgotPasswordEmail(code: string) {
  return {
    subject: `Reset your ${BRAND} password`,
    html: shell(
      'Reset your password',
      `<p style="margin:0;">Use this code to set a new password. It expires in 15 minutes.</p>
       ${otpBlock(code)}
       <p style="margin:0;color:#888888;font-size:13px;">Didn't request this? Your password is unchanged and no action is needed.</p>`,
    ),
  };
}

export function passwordChangedEmail() {
  return {
    subject: `Your ${BRAND} password was changed`,
    html: shell(
      'Your password was changed',
      `<p style="margin:0;">This is a confirmation that the password on your account was just updated.</p>
       <p style="margin:16px 0 0;">If this wasn't you, reset your password immediately and contact support.</p>`,
      { label: 'Reset password', url: frontendPath('/forgot-password') },
    ),
  };
}
