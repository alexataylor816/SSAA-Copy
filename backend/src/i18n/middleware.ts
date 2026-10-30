import type { NextFunction, Request, Response } from "express";
import { requestLang, translateMessage } from "./index.js";

/**
 * For Spanish requests, translates the `error` text of any JSON response (and the `reason` of a
 * refusal) on its way out, so every route answers in Spanish without each one handling it.
 */
export function localizeJsonErrors(_req: Request, res: Response, next: NextFunction): void {
  if (requestLang() !== "es") return next();
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const b = body as Record<string, unknown>;
      if (typeof b.error === "string") b.error = translateMessage(b.error);
      if (typeof b.reason === "string") b.reason = translateMessage(b.reason);
    }
    return json(body);
  };
  next();
}
