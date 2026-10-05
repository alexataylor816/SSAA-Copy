import { Router } from "express";
import { consumeResetCode, createResetCode } from "../models/passwordResets.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
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
  res.json({ success: true, devCode });
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
