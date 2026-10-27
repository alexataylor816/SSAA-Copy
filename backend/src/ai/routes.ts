import { Router, type RequestHandler } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { claudeConfigured, readScheduleFile } from "./claude.js";
import { recommend, saveTradeAnswers } from "./recommender.js";
import { colorForTrade, matchTaskToTrade } from "./trades.js";

/** AI schedule recommender and Upload Schedule (docs/AI_SCHEDULE_RECOMMENDER.md). Nothing here writes schedule data. */
export const aiRouter = Router();
aiRouter.use("/ai", requireAuth);

function route(handler: (...args: Parameters<RequestHandler>) => unknown): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  };
}

aiRouter.get(
  "/ai/status",
  route(async (_req, res) => {
    res.json({ claude: claudeConfigured() });
  }),
);

aiRouter.post(
  "/ai/recommendations",
  route(async (req, res) => {
    res.json(await recommend(req.userId!, { projectId: req.body?.projectId, weeks: req.body?.weeks }));
  }),
);

aiRouter.post(
  "/ai/trade-answers",
  route(async (req, res) => {
    res.json(await saveTradeAnswers(req.userId!, req.body?.projectId, req.body?.answers));
  }),
);

const SCHEDULE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

aiRouter.post(
  "/ai/schedule-upload",
  upload.single("file"),
  route(async (req, res) => {
    if (!claudeConfigured()) {
      throw new HttpError(503, "Reading schedules needs the AI helper, which isn't set up on this server yet.");
    }
    const file = req.file;
    if (!file || !SCHEDULE_TYPES.has(file.mimetype)) throw new HttpError(400, "Upload a PNG, JPEG, WebP or GIF image, or a PDF.");
    const read = await readScheduleFile(file.buffer, file.mimetype, new Date().toISOString().slice(0, 10));
    if (!read) throw new HttpError(422, "Couldn't read a schedule from that file. Try a clearer screenshot.");
    const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    res.json({
      notes: read.notes,
      // Each task gets its trade from the lookup list and that trade's fixed colour.
      tasks: read.tasks
        .filter((t) => t.name.trim() && isDate(t.start_date) && isDate(t.end_date))
        .map((t) => {
          const m = matchTaskToTrade(t.name);
          const [start, end] = t.start_date <= t.end_date ? [t.start_date, t.end_date] : [t.end_date, t.start_date];
          return { name: t.name.trim(), startDate: start, endDate: end, trade: m.trade, sure: m.confidence === "lookup", color: colorForTrade(m.trade) };
        }),
    });
  }),
);
