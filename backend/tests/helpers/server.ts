import type { AddressInfo } from "node:net";
import { afterAll } from "vitest";
import { createApp } from "../../src/app.js";

/**
 * Starts the app once for the calling test file and returns its base URL,
 * for `request(server)`. Closed again in afterAll.
 *
 * `request(app)` used to start a new server per request on a random port
 * bound to `::`. On macOS that bind can succeed on a port another process
 * (VS Code's helper, Notion) already holds on 127.0.0.1, so the request to
 * 127.0.0.1 reached that process instead of the app. Listening on 127.0.0.1
 * itself makes the OS pick a port that is actually free there.
 */
export async function startTestServer(): Promise<string> {
  const { httpServer, io } = await createApp();
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  afterAll(async () => {
    httpServer.closeAllConnections();
    // io.close() also closes the HTTP server it is attached to.
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  const { port } = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
