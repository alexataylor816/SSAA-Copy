import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Express } from "express";
import { config } from "../config.js";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * File storage abstraction.
 *
 * Phase 0 implements disk-local storage rooted at config.uploadDir.
 * Production swaps in an S3 implementation behind the same `save` contract,
 * which is why callers never construct URL paths themselves.
 */
export class Storage {
  constructor(private baseDir: string = config.uploadDir) {}

  save(file: Express.Multer.File, folder = ""): string {
    const filename = `${crypto.randomUUID().replace(/-/g, "")}-${sanitizeFilename(file.originalname)}`;
    const rel = path.join(folder, filename);
    const dest = path.join(this.baseDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    return "/uploads/" + rel.split(path.sep).join("/");
  }

  urlFor(key: string): string {
    return "/uploads/" + key.split(path.sep).join("/");
  }
}

export const storage = new Storage();
