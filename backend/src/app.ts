import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config.js";
import { ensureSchema } from "./models/index.js";
import { rbacRouter } from "./rbac/routes.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { uploadsRouter } from "./routes/uploads.js";
import { queryRouter } from "./query/routes.js";
import { schedulingRouter } from "./scheduling/routes.js";
import { messagingRouter } from "./messaging/routes.js";
import { contractorsRouter } from "./contractors/routes.js";
import { adminRouter } from "./admin/routes.js";
import { notificationsRouter } from "./notifications/routes.js";
import { profileRouter } from "./routes/profile.js";
import { attachRealtime } from "./realtime/index.js";

export function createApp() {
  ensureSchema();

  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins === "*" ? "*" : config.corsOrigins.split(","),
    }),
  );
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ service: "ssaa-backend", status: "ok" });
  });

  app.use(healthRouter);
  app.use(uploadsRouter);
  app.use(authRouter);
  app.use(rbacRouter);
  app.use(messagingRouter);
  app.use(notificationsRouter);
  app.use(profileRouter);
  app.use(schedulingRouter);
  app.use(queryRouter);
  app.use(contractorsRouter);
  app.use(adminRouter);

  // Anything thrown that isn't an HttpError used to reach Express's default
  // HTML error page; the SPA can't read that, so always answer with JSON.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    if (res.headersSent) return;
    res.status(500).json({ error: message });
  });

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });
  attachRealtime(io);

  return { app, httpServer, io };
}
