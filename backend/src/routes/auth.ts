import { Router } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { consumeResetCode, createResetCode } from "../models/passwordResets.js";
import {
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  linkGoogleSub,
  updateUserPassword,
  type User,
} from "../models/users.js";
import { sendPasswordResetEmail, sendUsernameReminderEmail } from "../services/email.js";
import { hashPassword, verifyPassword } from "../services/passwords.js";
import { signToken, verifyToken } from "../services/tokens.js";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serializeUser(user: User) {
  return { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt };
}

authRouter.post("/auth/signup", (req, res) => {
  const { email, password, fullName } = req.body ?? {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  if (findUserByEmail(email)) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const user = createUser({ email, passwordHash: hashPassword(password), fullName: fullName.trim() });
  const token = signToken({ sub: user.id, email: user.email });
  res.status(201).json({ token, user: serializeUser(user) });
});

authRouter.post("/auth/signin", (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = signToken({ sub: user.id, email: user.email });
  res.json({ token, user: serializeUser(user) });
});

// Sends the code via Resend when RESEND_API_KEY is configured. Without a key,
// falls back to logging the code server-side and echoing it as `devCode` so
// the flow stays testable locally.
authRouter.post("/auth/request-password-reset", async (req, res) => {
  const { email } = req.body ?? {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }

  const user = findUserByEmail(email);
  let devCode: string | undefined;
  if (user) {
    const code = createResetCode(user.id);
    try {
      const sent = await sendPasswordResetEmail(user.email, code);
      if (!sent) {
        devCode = code;
        console.log(`[dev] password reset code for ${user.email}: ${code}`);
      }
    } catch (err) {
      console.error(`Failed to send password reset email to ${user.email}:`, err);
      devCode = code;
    }
  }

  // Always respond the same way so we don't reveal whether the email exists.
  res.json({ success: true, devCode: config.exposeDevCodes ? devCode : undefined });
});

authRouter.post("/auth/verify-reset-code", (req, res) => {
  const { email, code, newPassword } = req.body ?? {};

  if (typeof email !== "string" || typeof code !== "string") {
    return res.status(400).json({ error: "Email and code are required." });
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const user = findUserByEmail(email);
  if (!user) {
    return res.status(400).json({ error: "Invalid or expired code." });
  }

  const resetUserId = consumeResetCode(user.id, code);
  if (!resetUserId) {
    return res.status(400).json({ error: "Invalid or expired code." });
  }

  updateUserPassword(resetUserId, hashPassword(newPassword));
  res.json({ success: true });
});

/**
 * Username/email reminder. `delivered` is false when no email provider is
 * configured so the client can tell the user the truth rather than claiming a
 * reminder was sent.
 */
authRouter.post("/auth/request-username-reminder", async (req, res) => {
  const { email } = req.body ?? {};

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }

  const user = findUserByEmail(email);
  let delivered = false;
  if (user) {
    try {
      delivered = await sendUsernameReminderEmail(user.email, user.fullName);
    } catch (err) {
      console.error(`Failed to send username reminder to ${user.email}:`, err);
    }
  }

  // Always the same shape so we don't reveal whether the email exists.
  res.json({ success: true, delivered });
});

/**
 * "Continue with Google". The client obtains a Google ID token via Google
 * Identity Services and posts it here as `credential`. We validate it against
 * Google's tokeninfo endpoint (audience must equal our GOOGLE_CLIENT_ID),
 * then find-or-create the matching SSAA account and issue our own JWT.
 *
 * Google-only accounts get a random, unverifiable password hash — they can
 * never sign in via `/auth/signin`. Without GOOGLE_CLIENT_ID configured this
 * returns 503 so the UI can say so honestly instead of failing opaquely.
 */
authRouter.post("/auth/google", async (req, res) => {
  const { credential } = req.body ?? {};

  if (typeof credential !== "string" || !credential) {
    return res.status(400).json({ error: "A Google credential is required." });
  }
  if (!config.googleClientId) {
    return res.status(503).json({ error: "Google sign-in is not configured on this server." });
  }

  let info: Record<string, unknown>;
  try {
    const tokeninfo = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    );
    if (!tokeninfo.ok) {
      return res.status(401).json({ error: "Google sign-in failed. Please try again." });
    }
    info = (await tokeninfo.json()) as Record<string, unknown>;
  } catch {
    return res.status(502).json({ error: "Could not reach Google to verify sign-in. Please try again." });
  }

  if (info.aud !== config.googleClientId) {
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }
  if (info.email_verified !== true && info.email_verified !== "true") {
    return res.status(401).json({ error: "That Google account's email is not verified." });
  }
  const email = typeof info.email === "string" ? info.email.toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return res.status(401).json({ error: "Google sign-in failed. Please try again." });
  }
  const sub = typeof info.sub === "string" && info.sub ? info.sub : null;

  let user = sub ? findUserByGoogleSub(sub) : undefined;
  let created = false;
  if (!user) {
    user = findUserByEmail(email);
    if (user && sub) linkGoogleSub(user.id, sub);
  }
  if (!user) {
    const name = typeof info.name === "string" && info.name.trim() ? info.name.trim() : email.split("@")[0];
    // No ":" means verifyPassword() always returns false — this account can
    // only ever sign in through Google.
    user = createUser({
      email,
      passwordHash: `google-oauth:${crypto.randomBytes(32).toString("hex")}`,
      fullName: name,
    });
    created = true;
    if (sub) linkGoogleSub(user.id, sub);
  }

  const token = signToken({ sub: user.id, email: user.email });
  res.json({ token, user: serializeUser(user), created });
});

authRouter.post("/auth/change-password", (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "Missing token." });
  }

  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Current and new passwords are required." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const user = findUserById(userId);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    // Same answer for a bad token-owner and a wrong password: nothing here
    // should tell an attacker which one failed.
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "The new password must be different from the current one." });
  }

  updateUserPassword(user.id, hashPassword(newPassword));
  res.json({ success: true });
});

authRouter.get("/auth/me", (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "Missing token." });
  }

  try {
    const payload = verifyToken(token);
    const user = findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Invalid token." });
    }
    res.json({ user: serializeUser(user) });
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
});
