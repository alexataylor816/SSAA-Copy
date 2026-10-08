import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();

async function signUp(email: string) {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName: "Profile User" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("self profile", () => {
  it("updates name, phone, language, and photo", async () => {
    const { token, id } = await signUp(`prof-${Date.now()}@example.com`);

    const uploaded = await request(app)
      .post("/uploads")
      .set(authed(token))
      .field("folder", "avatars")
      .attach("photo", png, { filename: "me.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.url).toMatch(/^\/uploads\/avatars\//);

    const res = await request(app)
      .patch("/auth/profile")
      .set(authed(token))
      .send({ fullName: "New Name", phone: "301-555-0100", language: "es", profilePictureUrl: uploaded.body.url });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id,
      fullName: "New Name",
      phone: "301-555-0100",
      language: "es",
      profilePictureUrl: uploaded.body.url,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects bad language, remote photo URLs, empty bodies, and missing tokens", async () => {
    const { token } = await signUp(`prof-bad-${Date.now()}@example.com`);

    const lang = await request(app).patch("/auth/profile").set(authed(token)).send({ language: "fr" });
    expect(lang.status).toBe(400);

    const remote = await request(app)
      .patch("/auth/profile")
      .set(authed(token))
      .send({ profilePictureUrl: "https://evil.example/me.png" });
    expect(remote.status).toBe(400);

    const emptyName = await request(app).patch("/auth/profile").set(authed(token)).send({ fullName: "  " });
    expect(emptyName.status).toBe(400);

    const empty = await request(app).patch("/auth/profile").set(authed(token)).send({});
    expect(empty.status).toBe(400);

    const anon = await request(app).patch("/auth/profile").send({ fullName: "Nobody" });
    expect(anon.status).toBe(401);
  });

  it("rejects upload folders outside the allowlist", async () => {
    const { token } = await signUp(`prof-folder-${Date.now()}@example.com`);
    const res = await request(app)
      .post("/uploads")
      .set(authed(token))
      .field("folder", "../../etc")
      .attach("photo", png, { filename: "me.png", contentType: "image/png" });
    // Falls back to the default folder rather than honoring the traversal.
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/schedule-requests\//);
  });
});
