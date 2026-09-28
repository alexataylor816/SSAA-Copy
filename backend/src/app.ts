import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config.js";
import { ensureSchema } from "./models/index.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { uploadsRouter } from "./routes/uploads.js";

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

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

  return { app, httpServer, io };
}
