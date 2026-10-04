import { Resend } from "resend";
import { config } from "../config.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

/**
 * Sends the password-reset code by email via Resend when RESEND_API_KEY is
 * configured. Otherwise returns false so the caller can fall back to the
 * dev-only devCode-in-response behavior.
 */
export async function sendPasswordResetEmail(to: string, code: string): Promise<boolean> {
  if (!resend) return false;

  // The Resend SDK doesn't throw on API errors — it resolves with { error }.
  const { error } = await resend.emails.send({
    from: config.emailFrom,
    to,
    subject: "Your SSAA password reset code",
    text: `Hi,\n\nYour password reset verification code is: ${code}\n\nThis code expires in 15 minutes. If you did not request a password reset, please ignore this email.\n\n— The SSAA Team`,
  });

  if (error) {
    console.error("Resend failed to send password reset email:", error);
    return false;
  }

  return true;
}

/**
 * Username/email reminder. Returns false when no key is configured so the
 * caller can be honest with the user instead of pretending an email went out.
 */
export async function sendUsernameReminderEmail(to: string, fullName: string): Promise<boolean> {
  if (!resend) return false;

  const { error } = await resend.emails.send({
    from: config.emailFrom,
    to,
    subject: "Your SSAA account",
    text: `Hi${fullName ? ` ${fullName}` : ""},\n\nYour SSAA sign-in email is: ${to}\n\nIf you didn't create an SSAA account, you can ignore this email.\n\n— The SSAA Team`,
  });

  if (error) {
    console.error("Resend failed to send username reminder email:", error);
    return false;
  }

  return true;
}
