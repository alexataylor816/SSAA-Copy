import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { findUserById, updateUserProfile, type User } from "../models/users.js";
import { findEmployeeByLinkedUser, setEmployeeNumberForUser } from "../rbac/models.js";

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

function employeeNumberOf(user: User): string | null {
  return user.companyId ? (findEmployeeByLinkedUser(user.companyId, user.id)?.employeeNumber ?? null) : null;
}

/** What the profile dialog needs beyond the session: the caller's employee ID, if they have an employee record. */
profileRouter.get(
  "/auth/profile",
  route((req, res) => {
    const user = findUserById(req.userId!);
    if (!user) throw new HttpError(401, "User not found.");
    const employee = user.companyId ? findEmployeeByLinkedUser(user.companyId, user.id) : undefined;
    res.json({ user: serializeUser(user), employeeNumber: employee?.employeeNumber ?? null, hasEmployeeRecord: !!employee });
  }),
);

const AVATAR_RE = /^\/uploads\/(schedule-requests|avatars)\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i;

/**
 * Self-service profile editing (the ManageProfileModal slim port). Only the
 * caller's own row is ever touched — there is no target user parameter.
 */
profileRouter.patch(
  "/auth/profile",
  route((req, res) => {
    const { fullName, phone, language, profilePictureUrl, employeeNumber } = req.body ?? {};
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
    let employeeNumberValue: string | null | undefined;
    if (employeeNumber !== undefined) {
      if (employeeNumber !== null && (typeof employeeNumber !== "string" || employeeNumber.trim().length > 40)) {
        throw new HttpError(400, "Employee ID must be 40 characters or fewer.");
      }
      employeeNumberValue = employeeNumber === null ? null : employeeNumber.trim() || null;
    }
    if (Object.keys(updates).length === 0 && employeeNumberValue === undefined) {
      throw new HttpError(400, "Nothing to update.");
    }

    const user = Object.keys(updates).length ? updateUserProfile(req.userId!, updates) : findUserById(req.userId!);
    if (!user) throw new HttpError(401, "User not found.");
    // The ID lives on the user's employee record, as in the original; nothing to set without one.
    if (employeeNumberValue !== undefined && user.companyId) {
      setEmployeeNumberForUser(user.companyId, user.id, employeeNumberValue);
    }
    res.json({ user: serializeUser(user), employeeNumber: employeeNumberOf(user) });
  }),
);
