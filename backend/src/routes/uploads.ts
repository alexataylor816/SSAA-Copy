import { Router } from "express";
import { config } from "../config.js";

export const uploadsRouter = Router();

uploadsRouter.get("/uploads/*", (req, res) => {
  const filename = (req.params as Record<string, string>)[0];
  res.sendFile(filename, { root: config.uploadDir }, (err) => {
    if (err) res.status(404).end();
  });
});
