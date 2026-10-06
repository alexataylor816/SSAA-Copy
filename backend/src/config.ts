import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE_DIR = path.resolve(__dirname, "..");

export const config = {
  secretKey: process.env.SECRET_KEY ?? "dev-secret-change-me",
  jwtSecretKey: process.env.JWT_SECRET_KEY ?? "dev-jwt-secret-change-me",
  // Which database to use: "sqlite" (default, what the team runs today) or "mysql".
  // Flip to "mysql" only after every file uses the async `sql` helper from db.ts.
  dbClient: (process.env.DB_CLIENT === "mysql" ? "mysql" : "sqlite") as "sqlite" | "mysql",
  databasePath: process.env.DATABASE_PATH ?? path.join(BASE_DIR, "ssaa.db"),
  mysql: {
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "ssaa_dev",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "ssaa",
  },
  corsOrigins: process.env.CORS_ORIGINS ?? "*",
  // `||` not `??`: an empty UPLOAD_DIR in .env means "use the default".
  uploadDir: process.env.UPLOAD_DIR || path.join(BASE_DIR, "uploads"),
  port: Number(process.env.PORT ?? 8000),
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? "SSAA <onboarding@resend.dev>",
};
