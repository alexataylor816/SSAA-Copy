import { createApp } from "./app.js";
import { config } from "./config.js";

// `io` used to be dropped here, which is why realtime never worked. attachRealtime
// inside createApp() now registers it with the emitter the routes call.
const { httpServer } = createApp();

httpServer.listen(config.port, "127.0.0.1", () => {
  console.log(`SSAA backend listening on http://127.0.0.1:${config.port}`);
});