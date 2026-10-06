import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { findUserById, updateUserProfile, type User } from "../models/users.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

function route(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  };
}

function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    language: user.language,
    profilePictureUrl: user.profilePictureUrl,
    companyId: user.companyId,
    createdAt: user.createdAt,
  };
}

const AVATAR_RE = /^\/uploads\/(schedule-requests|avatars)\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i;

/**
 * Self-service profile editing (the ManageProfileModal slim port). Only the
 * caller's own row is ever touched — there is no target user parameter.
 */
profileRouter.patch(
  "/auth/profile",
  route((req, res) => {
    const { fullName, phone, language, profilePictureUrl } = req.body ?? {};
    const updates: { fullName?: string; phone?: string | null; language?: string; profilePictureUrl?: string | null } = {};

    if (fullName !== undefined) {
      if (typeof fullName !== "string" || !fullName.trim()) {
        throw new HttpError(400, "Full name must not be empty.");
      }
      updates.fullName = fullName.trim();
    }
    if (phone !== undefined) {
      if (phone !== null && (typeof phone !== "string" || phone.trim().length > 30)) {
        throw new HttpError(400, "Phone number must be 30 characters or fewer.");
      }
      updates.phone = phone === null ? null : phone.trim();
    }
    if (language !== undefined) {
      if (language !== "en" && language !== "es") {
        throw new HttpError(400, "Language must be 'en' or 'es'.");
      }
      updates.language = language;
    }
    if (profilePictureUrl !== undefined) {
      if (profilePictureUrl !== null && (typeof profilePictureUrl !== "string" || !AVATAR_RE.test(profilePictureUrl))) {
        throw new HttpError(400, "Profile pictures must be images uploaded to this server.");
      }
      updates.profilePictureUrl = profilePictureUrl;
    }
    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "Nothing to update.");
    }

    const user = updateUserProfile(req.userId!, updates);
    if (!user) throw new HttpError(401, "User not found.");
    res.json({ user: serializeUser(user) });
  }),
);
