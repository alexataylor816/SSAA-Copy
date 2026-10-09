import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();

describe("health", () => {

  it("GET / returns service info", async () => {
    const res = await request(server).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("ssaa-backend");
  });

  it("GET /health returns ok", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("sqlite ok");
  });
});
