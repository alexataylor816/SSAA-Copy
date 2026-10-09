import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { config } from "../src/config.js";

const server = await startTestServer();

describe("auth", () => {

  it("signs up a new user and returns a token", async () => {
    const res = await request(server)
      .post("/auth/signup")
      .send({ email: "person@example.com", password: "hunter22", fullName: "Person One" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("person@example.com");
    expect(res.body.user.fullName).toBe("Person One");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email", async () => {
    await request(server)
      .post("/auth/signup")
      .send({ email: "dupe@example.com", password: "hunter22", fullName: "First" });

    const res = await request(server)
      .post("/auth/signup")
      .send({ email: "dupe@example.com", password: "hunter22", fullName: "Second" });

    expect(res.status).toBe(409);
  });

  it("rejects a short password", async () => {
    const res = await request(server)
      .post("/auth/signup")
      .send({ email: "short@example.com", password: "123", fullName: "Short" });

    expect(res.status).toBe(400);
  });

  it("signs in with correct credentials and rejects wrong ones", async () => {
    await request(server)
      .post("/auth/signup")
      .send({ email: "signin@example.com", password: "correct-horse", fullName: "Sign In" });

    const ok = await request(server)
      .post("/auth/signin")
      .send({ email: "signin@example.com", password: "correct-horse" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTypeOf("string");

    const bad = await request(server)
      .post("/auth/signin")
      .send({ email: "signin@example.com", password: "wrong-password" });
    expect(bad.status).toBe(401);
  });

  it("returns the current user for /auth/me with a valid token", async () => {
    const signup = await request(server)
      .post("/auth/signup")
      .send({ email: "me@example.com", password: "hunter22", fullName: "Me" });

    const res = await request(server).get("/auth/me").set("Authorization", `Bearer ${signup.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("me@example.com");
  });

  it("rejects /auth/me without a token", async () => {
    const res = await request(server).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("resets a password with a valid code and rejects a wrong one", async () => {
    await request(server)
      .post("/auth/signup")
      .send({ email: "reset@example.com", password: "original1", fullName: "Reset Me" });

    const requested = await request(server)
      .post("/auth/request-password-reset")
      .send({ email: "reset@example.com" });
    expect(requested.status).toBe(200);
    expect(requested.body.devCode).toMatch(/^\d{6}$/);

    const wrongCode = await request(server)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: "000000", newPassword: "brandnew1" });
    expect(wrongCode.status).toBe(400);

    const verified = await request(server)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: requested.body.devCode, newPassword: "brandnew1" });
    expect(verified.status).toBe(200);

    const oldPasswordSignIn = await request(server)
      .post("/auth/signin")
      .send({ email: "reset@example.com", password: "original1" });
    expect(oldPasswordSignIn.status).toBe(401);

    const newPasswordSignIn = await request(server)
      .post("/auth/signin")
      .send({ email: "reset@example.com", password: "brandnew1" });
    expect(newPasswordSignIn.status).toBe(200);

    // codes are single-use
    const reused = await request(server)
      .post("/auth/verify-reset-code")
      .send({ email: "reset@example.com", code: requested.body.devCode, newPassword: "anotherone1" });
    expect(reused.status).toBe(400);
  });
  it("does not reveal whether an email is registered", async () => {
    const res = await request(server)
      .post("/auth/request-password-reset")
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.devCode).toBeUndefined();
  });

  it("changes the password with the right current one and rejects a wrong one", async () => {
    const signup = await request(server)
      .post("/auth/signup")
      .send({ email: "changeme@example.com", password: "original1", fullName: "Change Me" });
    const token = signup.body.token as string;

    const wrong = await request(server)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "not-the-password", newPassword: "brandnew1" });
    expect(wrong.status).toBe(401);

    const short = await request(server)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "original1", newPassword: "123" });
    expect(short.status).toBe(400);

    const same = await request(server)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "original1", newPassword: "original1" });
    expect(same.status).toBe(400);

    const ok = await request(server)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "original1", newPassword: "brandnew1" });
    expect(ok.status).toBe(200);

    const oldSignIn = await request(server)
      .post("/auth/signin")
      .send({ email: "changeme@example.com", password: "original1" });
    expect(oldSignIn.status).toBe(401);

    const newSignIn = await request(server)
      .post("/auth/signin")
      .send({ email: "changeme@example.com", password: "brandnew1" });
    expect(newSignIn.status).toBe(200);
  });

  it("rejects a password change without a token", async () => {
    const res = await request(server)
      .post("/auth/change-password")
      .send({ currentPassword: "whatever1", newPassword: "brandnew1" });
    expect(res.status).toBe(401);
  });

  describe("google sign-in", () => {
    const originalClientId = config.googleClientId;

    // Google's tokeninfo is a live network call, so stub it: the shape mirrors
    // the real response (`aud`, `email`, `email_verified`, `sub`, `name`).
    function stubTokeninfo(info: Record<string, unknown>, ok = true) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(info), { status: ok ? 200 : 400 })),
      );
      config.googleClientId = "test-google-client-id";
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      config.googleClientId = originalClientId;
    });

    it("says plainly when Google sign-in is not configured", async () => {
      config.googleClientId = undefined;
      const res = await request(server).post("/auth/google").send({ credential: "whatever" });
      expect(res.status).toBe(503);
    });

    it("creates an account from a valid Google credential that password sign-in cannot use", async () => {
      stubTokeninfo({
        aud: "test-google-client-id",
        email: "googler@example.com",
        email_verified: "true",
        sub: "google-sub-new-1",
        name: "Google R",
      });

      const res = await request(server).post("/auth/google").send({ credential: "id-token" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTypeOf("string");
      expect(res.body.user.email).toBe("googler@example.com");
      expect(res.body.user.fullName).toBe("Google R");
      expect(res.body.created).toBe(true);

      const again = await request(server).post("/auth/google").send({ credential: "id-token" });
      expect(again.status).toBe(200);
      expect(again.body.user.id).toBe(res.body.user.id);
      expect(again.body.created).toBe(false);

      const passwordBackdoor = await request(server)
        .post("/auth/signin")
        .send({ email: "googler@example.com", password: "anything-at-all" });
      expect(passwordBackdoor.status).toBe(401);
    });

    it("links an existing password account to its Google subject", async () => {
      const signup = await request(server)
        .post("/auth/signup")
        .send({ email: "linkme@example.com", password: "hunter22", fullName: "Link Me" });

      stubTokeninfo({
        aud: "test-google-client-id",
        email: "linkme@example.com",
        email_verified: true,
        sub: "google-sub-link-1",
        name: "Link Me",
      });

      const res = await request(server).post("/auth/google").send({ credential: "id-token" });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(signup.body.user.id);
      expect(res.body.created).toBe(false);

      // The original password still works afterwards.
      const stillThere = await request(server)
        .post("/auth/signin")
        .send({ email: "linkme@example.com", password: "hunter22" });
      expect(stillThere.status).toBe(200);
    });

    it("rejects a credential minted for a different audience", async () => {
      stubTokeninfo({
        aud: "someone-elses-client-id",
        email: "impostor@example.com",
        email_verified: "true",
        sub: "google-sub-evil-1",
      });

      const res = await request(server).post("/auth/google").send({ credential: "id-token" });
      expect(res.status).toBe(401);
    });

    it("rejects an unverified Google email", async () => {
      stubTokeninfo({
        aud: "test-google-client-id",
        email: "unverified@example.com",
        email_verified: "false",
        sub: "google-sub-unverified-1",
      });

      const res = await request(server).post("/auth/google").send({ credential: "id-token" });
      expect(res.status).toBe(401);
    });
  });
});
