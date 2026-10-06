import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import os from "node:os";
import { config } from "../config.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { storage } from "../services/storage.js";

export const uploadsRouter = Router();

uploadsRouter.get("/uploads/*", (req, res) => {
  const filename = (req.params as Record<string, string>)[0];
  res.sendFile(filename, { root: config.uploadDir }, (err) => {
    if (err) res.status(404).end();
  });
});

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const UPLOAD_FOLDERS = new Set(["schedule-requests", "avatars"]);

/**
 * Accepts one photo (≤5 MB), returning the `/uploads/*` URL the client keeps
 * (schedule-request attachments, profile avatars).
 * Authenticated: anonymous uploads would turn this into free file hosting.
 */
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype) && IMAGE_EXT.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF photos under 5 MB are accepted."));
    }
  },
});

uploadsRouter.post("/uploads", requireAuth, singlePhoto, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Attach a photo as the `photo` field." });
  }
  // `folder` picks the subfolder and is restricted to an allowlist —
  // schedule-request photos and profile avatars. Authenticated: anonymous
  // uploads would turn this into free file hosting.
  const folder =
    typeof req.body?.folder === "string" && UPLOAD_FOLDERS.has(req.body.folder)
      ? req.body.folder
      : "schedule-requests";
  const url = storage.save(req.file, folder);
  res.status(201).json({ url });
});

/**
 * Multer hands file problems (wrong type, over the size limit) to Express's
 * error middleware, which answers 500. A rejected upload is the client's
 * mistake, so translate it to a 400 here instead.
 */
function singlePhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("photo")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "Photos must be under 5 MB."
        : err instanceof Error
          ? err.message
          : "Could not accept that file.";
    res.status(400).json({ error: message });
  });
}
