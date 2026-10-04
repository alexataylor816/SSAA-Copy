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

  it("resets a password with a valid code and rejects a wrong one", async () => {
    await request(app)
      .post("/auth/signup")
      .send({ email: "reset@example.com", password: "original1", fullName: "Reset Me" });

    const requested = await request(app)
      .post("/auth/request-password-reset")
      .send({ email: "reset@example.com" });
    expect(requested.status).toBe(200);
    expect(requested.body.devCode).toMatch(/^\d{6}$/);

    const wrongCode = await request(app)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: "000000", newPassword: "brandnew1" });
    expect(wrongCode.status).toBe(400);

    const verified = await request(app)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: requested.body.devCode, newPassword: "brandnew1" });
    expect(verified.status).toBe(200);

    const oldPasswordSignIn = await request(app)
      .post("/auth/signin")
      .send({ email: "reset@example.com", password: "original1" });
    expect(oldPasswordSignIn.status).toBe(401);

    const newPasswordSignIn = await request(app)
      .post("/auth/signin")
      .send({ email: "reset@example.com", password: "brandnew1" });
    expect(newPasswordSignIn.status).toBe(200);

    // codes are single-use
    const reused = await request(app)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: requested.body.devCode, newPassword: "anotherone1" });
    expect(reused.status).toBe(400);
  });

  it("does not reveal whether an email is registered", async () => {
    const res = await request(app)
      .post("/auth/request-password-reset")
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.devCode).toBeUndefined();
  });
});
