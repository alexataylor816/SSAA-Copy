import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_DIR = path.resolve(__dirname, "..");

export const config = {
  secretKey: process.env.SECRET_KEY ?? "dev-secret-change-me",
  jwtSecretKey: process.env.JWT_SECRET_KEY ?? "dev-jwt-secret-change-me",
  databasePath: process.env.DATABASE_PATH ?? path.join(BASE_DIR, "ssaa.db"),
  corsOrigins: process.env.CORS_ORIGINS ?? "*",
  // `||` not `??`: an empty UPLOAD_DIR in .env means "use the default".
  uploadDir: process.env.UPLOAD_DIR || path.join(BASE_DIR, "uploads"),
  port: Number(process.env.PORT ?? 8000),
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? "SSAA <onboarding@resend.dev>",
  /**
   * SMTP (e.g. Gmail with an App Password). When SMTP_USER and SMTP_PASS are
   * set this is used instead of Resend. `||` so blank lines in .env mean unset.
   */
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || undefined,
    // Google shows App Passwords in groups of four; the spaces aren't part of it.
    pass: process.env.SMTP_PASS?.replace(/\s+/g, "") || undefined,
  },
  /**
   * Echo password-reset codes in the API response when email can't be sent.
   * Local development only: in production that would let anyone reset any
   * account by reading the code straight out of the response.
   */
  // EXPOSE_DEV_CODES=false turns it off on a shared dev server too (e.g. a public Codespaces link).
  exposeDevCodes: process.env.EXPOSE_DEV_CODES
    ? process.env.EXPOSE_DEV_CODES === "true"
    : process.env.NODE_ENV !== "production",
  /** Google OAuth client ID for "Continue with Google" (`POST /auth/google`). */
  googleClientId: process.env.GOOGLE_CLIENT_ID,
};
