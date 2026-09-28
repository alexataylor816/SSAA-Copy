import { createApp } from "./app.js";
import { config } from "./config.js";

const { httpServer } = createApp();

httpServer.listen(config.port, "127.0.0.1", () => {
  console.log(`SSAA backend listening on http://127.0.0.1:${config.port}`);
});
