import nodemailer from "nodemailer";
import { Resend } from "resend";
import { config } from "../config.js";
import { say, type Lang } from "../i18n/index.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The original app's wrapper (supabase/functions/request-password-reset): the template's HTML, then a
 * grey "— The SSAA Team" footer under a rule.
 */
export function styledHtml(innerHtml: string, lang: Lang = "en"): string {
  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a; line-height: 1.5;">
        ${innerHtml}
        <p style="font-size: 12px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
          ${say("— The SSAA Team", undefined, lang)}
        </p>
      </div>
    `;
}

/** Plain text with line breaks, in the same wrapper. */
export function styledEmail(body: string): { text: string; html: string } {
  return { text: `${body}\n\n— The SSAA Team`, html: styledHtml(escapeHtml(body).replace(/\n/g, "<br/>")) };
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

type Sender = (mail: Mail) => Promise<SendResult>;

/**
 * SMTP (Gmail App Password) when configured, else Resend, else nothing. Everything goes through
 * notifications/correspondence.ts, which renders the operator's template and records each send in the
 * correspondence log.
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
        return { ok: true };
      } catch (err) {
        console.error(`SMTP failed to send "${mail.subject}" to ${mail.to}:`, err);
        return { ok: false, error: err instanceof Error ? err.message : "SMTP error" };
      }
    };
  }

  if (config.resendApiKey) {
    const resend = new Resend(config.resendApiKey);
    return async (mail) => {
      try {
        // The Resend SDK doesn't throw on API errors — it resolves with { error }.
        const { error } = await resend.emails.send({ from: config.emailFrom, ...mail });
        if (error) {
          console.error(`Resend failed to send "${mail.subject}" to ${mail.to}:`, error);
          return { ok: false, error: error.message };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Resend error" };
      }
    };
  }

  return null;
}

const send = createSender();

export function emailTransportName(): "smtp" | "resend" | "none" {
  if (config.smtp.user && config.smtp.pass) return "smtp";
  return config.resendApiKey ? "resend" : "none";
}

export async function sendEmail(mail: Mail): Promise<SendResult> {
  if (!send) return { ok: false, error: "Email isn't set up on this server." };
  return send(mail);
}
