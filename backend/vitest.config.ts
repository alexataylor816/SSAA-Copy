import { defineConfig } from "vitest/config";

const onMysql = process.env.DB_CLIENT === "mysql";

export default defineConfig({
  test: {
    // Empties the MySQL test database before each file (does nothing on SQLite).
    setupFiles: ["tests/setup/mysqlReset.ts"],
    // SQLite gives every file its own in-memory database; MySQL test files
    // share one database, so they must run one at a time.
    fileParallelism: !onMysql,
    env: {
      DATABASE_PATH: ":memory:",
      // Force the devCode fallback path — tests shouldn't depend on a real
      // mail provider or network access, or send real mail to example.com.
      RESEND_API_KEY: "",
      SMTP_USER: "",
      SMTP_PASS: "",
    },
  },
});
