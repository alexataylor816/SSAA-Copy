import { Router } from "express";
import { createUser, findUserByEmail, findUserById, type User } from "../models/users.js";
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
