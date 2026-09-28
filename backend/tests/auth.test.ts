import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("auth", () => {
  const { app } = createApp();

  it("signs up a new user and returns a token", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "person@example.com", password: "hunter22", fullName: "Person One" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("person@example.com");
    expect(res.body.user.fullName).toBe("Person One");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "dupe@example.com", password: "hunter22", fullName: "First" });

    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "dupe@example.com", password: "hunter22", fullName: "Second" });

    expect(res.status).toBe(409);
  });

  it("rejects a short password", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ email: "short@example.com", password: "123", fullName: "Short" });

    expect(res.status).toBe(400);
  });

  it("signs in with correct credentials and rejects wrong ones", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "signin@example.com", password: "correct-horse", fullName: "Sign In" });

    const ok = await request(app)
      .post("/auth/signin")
      .send({ email: "signin@example.com", password: "correct-horse" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTypeOf("string");

    const bad = await request(app)
      .post("/auth/signin")
      .send({ email: "signin@example.com", password: "wrong-password" });
    expect(bad.status).toBe(401);
  });

  it("returns the current user for /auth/me with a valid token", async () => {
    const signup = await request(app)
      .post("/auth/signup")
      .send({ email: "me@example.com", password: "hunter22", fullName: "Me" });

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${signup.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("me@example.com");
  });

  it("rejects /auth/me without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});
