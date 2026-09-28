import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_DIR = path.resolve(__dirname, "..");

export const config = {
  secretKey: process.env.SECRET_KEY ?? "dev-secret-change-me",
  jwtSecretKey: process.env.JWT_SECRET_KEY ?? "dev-jwt-secret-change-me",
  databasePath: process.env.DATABASE_PATH ?? path.join(BASE_DIR, "ssaa.db"),
  corsOrigins: process.env.CORS_ORIGINS ?? "*",
  uploadDir: process.env.UPLOAD_DIR ?? path.join(BASE_DIR, "uploads"),
  port: Number(process.env.PORT ?? 8000),
};
