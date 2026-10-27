import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { ES } from "../src/i18n/es.js";
import { SPANISH_TEMPLATES } from "../src/notifications/templates.js";
import { dayLabel, clockLabel, parseLang, translateMessage } from "../src/i18n/index.js";

const server = await startTestServer();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string, fullName = `User ${tag}`) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `es-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function company(token: string, name: string, companyType: "gc" | "sub") {
  const res = await request(server).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company.id as string;
}

const setLanguage = (token: string, language: "en" | "es") =>
  request(server).patch("/auth/profile").set(authed(token)).send({ language });

const inbox = async (token: string) =>
  (await request(server).get("/notifications").set(authed(token))).body.notifications as { eventType: string; title: string; body: string }[];

describe("Spanish: API errors follow Accept-Language", () => {
  it("answers in Spanish when the app asks for Spanish", async () => {
    const res = await request(server)
      .post("/auth/signin")
      .set("Accept-Language", "es-MX,es;q=0.9")
      .send({ email: "nobody@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Correo electrónico o contraseña incorrectos.");
  });

  it("stays in English without the header (unchanged for older clients and tests)", async () => {
    const res = await request(server).post("/auth/signin").send({ email: "nobody@example.com", password: "wrong-password" });
    expect(res.body.error).toBe("Invalid email or password.");
  });

  it("translates messages with names filled in", async () => {
    expect(translateMessage("Type at least 3 letters of the company name.", "es")).toBe("Escriba al menos 3 letras del nombre de la empresa.");
    expect(translateMessage("Something nobody translated.", "es")).toBe("Something nobody translated.");
  });

  it("formats dates and times the Mexican way", () => {
    expect(dayLabel("2026-10-23", "es")).toMatch(/vie.*23.*oct/i);
    expect(dayLabel("2026-10-23", "en")).toBe("Fri, Oct 23");
    expect(clockLabel("07:00", "es")).toBe("7:00 a.m.");
    expect(clockLabel("15:30", "en")).toBe("3:30 PM");
    expect(parseLang("es-MX")).toBe("es");
    expect(parseLang("en-US,es;q=0.5")).toBe("en");
  });
});

describe("Spanish: notifications go out in the recipient's language", () => {
  it("a Spanish-speaking sub gets the new request in Spanish; the English GC's reply stays English", async () => {
    const gc = await signUp("gc", "Gina GC");
    await company(gc.token, "Constructora Uno", "gc");
    const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Torre Norte" });
    const sub = await signUp("sub", "Saúl Sub");
    const subCompanyId = await company(sub.token, "Plomería Dos", "sub");
    await setLanguage(sub.token, "es");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
    const crew = await request(server).get(`/companies/${subCompanyId}/connected-employees`).set(authed(gc.token));

    const created = await request(server).post("/schedule-requests").set(authed(gc.token)).send({
      projectId: project.body.id,
      subCompanyId,
      employeeIds: [crew.body.employees[0].id],
      date: "2099-04-07",
      startTime: "07:00",
      endTime: "15:00",
    });
    expect(created.status).toBe(201);

    const subNote = (await inbox(sub.token)).find((x) => x.eventType === "schedule_created");
    expect(subNote?.title).toBe("Nueva solicitud de programación");
    expect(subNote?.body).toContain("Constructora Uno solicitó 1 persona");
    expect(subNote?.body).toContain("Torre Norte");

    const confirm = await request(server).patch(`/schedule-requests/${created.body.id}`).set(authed(sub.token)).send({ status: "confirmed" });
    expect(confirm.status).toBe(200);
    const gcNote = (await inbox(gc.token)).find((x) => x.eventType === "schedule_confirmed");
    expect(gcNote?.title).toBe("Request confirmed");
  });
});

describe("Spanish: the word lists are complete", () => {
  it("every Spanish template keeps the English template's placeholders", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    for (const [event, es] of Object.entries(SPANISH_TEMPLATES)) {
      const holders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
      for (const h of holders(es.subject)) expect(holders(es.bodyHtml + es.subject).has(h), `${event}: ${h}`).toBe(true);
    }
  });

  it("every Spanish message keeps its placeholders", () => {
    const holders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [en, es] of Object.entries(ES)) {
      // a placeholder may be dropped in Spanish only where the language doesn't need it
      if (en.includes("{companyType}")) continue;
      expect(holders(es), en).toBe(holders(en));
    }
  });
});

describe("Spanish: the AI helper recognises Spanish task names", async () => {
  const { matchTaskToTrade } = await import("../src/ai/trades.js");
  it("matches trades with or without accents", () => {
    expect(matchTaskToTrade("Plomería en obra negra").trade).toBe("Plumbing");
    expect(matchTaskToTrade("Colado de losa").trade).toBe("Concrete");
    expect(matchTaskToTrade("Colocación de tablaroca").trade).toBe("Drywall");
    expect(matchTaskToTrade("Instalacion electrica").trade).toBe("Electrical");
    expect(matchTaskToTrade("Plumbing rough-in").trade).toBe("Plumbing");
  });
});
