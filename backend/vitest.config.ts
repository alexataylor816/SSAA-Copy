import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_PATH: ":memory:",
      // Force the devCode fallback path — tests shouldn't depend on a real
      // Resend key or network access.
      RESEND_API_KEY: "",
    },
  },
});
