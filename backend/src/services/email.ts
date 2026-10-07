import nodemailer from "nodemailer";
import { Resend } from "resend";
import { config } from "../config.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The original app's wrapper (supabase/functions/request-password-reset):
 * the body with line breaks, then a grey "— The SSAA Team" footer under a rule.
 */
export function styledEmail(body: string): { text: string; html: string } {
  return {
    text: `${body}\n\n— The SSAA Team`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${escapeHtml(body).replace(/\n/g, "<br/>")}
        <p style="font-size: 12px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
          — The SSAA Team
        </p>
      </div>
    `,
  };
}

type Sender = (mail: Mail) => Promise<boolean>;

/**
 * SMTP (Gmail App Password) when configured, else Resend, else nothing — in
 * which case callers fall back to their dev-only behaviour.
 */
function createSender(): Sender | null {
  const { smtp } = config;
  if (smtp.user && smtp.pass) {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    // Gmail only sends as the signed-in account, so EMAIL_FROM's Resend
    // sandbox address can't be used here.
    const from = `SSAA <${smtp.user}>`;
    return async (mail) => {
      try {
        await transport.sendMail({ from, ...mail });
        return true;
      } catch (err) {
        console.error(`SMTP failed to send "${mail.subject}" to ${mail.to}:`, err);
        return false;
      }
    };
  }

  if (config.resendApiKey) {
    const resend = new Resend(config.resendApiKey);
    return async (mail) => {
      // The Resend SDK doesn't throw on API errors — it resolves with { error }.
      const { error } = await resend.emails.send({ from: config.emailFrom, ...mail });
      if (error) {
        console.error(`Resend failed to send "${mail.subject}" to ${mail.to}:`, error);
        return false;
      }
      return true;
    };
  }

  return null;
}

const send = createSender();

export function emailTransportName(): "smtp" | "resend" | "none" {
  if (config.smtp.user && config.smtp.pass) return "smtp";
  return config.resendApiKey ? "resend" : "none";
}

/** Returns false when the code could not be emailed, so the caller can fall back. */
export async function sendPasswordResetEmail(to: string, code: string): Promise<boolean> {
  if (!send) return false;
  return send({
    to,
    subject: "Your Password Reset Code",
    ...styledEmail(
      `Hi,\n\nYour password reset verification code is: ${code}\n\nThis code expires in 15 minutes. If you did not request a password reset, please ignore this email.`,
    ),
  });
}

/** Returns false when nothing was sent, so the caller can say so instead of pretending. */
export async function sendUsernameReminderEmail(to: string, fullName: string): Promise<boolean> {
  if (!send) return false;
  return send({
    to,
    subject: "Your SSAA Username",
    ...styledEmail(
      `Hi${fullName ? ` ${fullName}` : ""},\n\nYour SSAA username (the email you sign in with) is: ${to}\n\nIf you didn't request this, you can ignore this email.`,
    ),
  });
}
