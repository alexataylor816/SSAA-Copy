import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
