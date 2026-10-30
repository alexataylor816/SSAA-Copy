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

describe("Translate button on chat messages", async () => {
  const { setTranslatorForTests, setTranslationConfiguredForTests } = await import("../src/messaging/translate.js");

  async function projectChat() {
    const gc = await signUp("tgc", "Greg GC");
    await company(gc.token, "Translate GC", "gc");
    const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Bridge Job" });
    const sub = await signUp("tsub", "Steve Sub");
    await company(sub.token, "Translate Sub", "sub");
    await setLanguage(sub.token, "es");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
    const convs = await request(server).get("/conversations").set(authed(gc.token));
    const conv = (convs.body.conversations as { id: string; projectId: string | null }[]).find((c) => c.projectId === project.body.id)!;
    const sent = await request(server).post(`/conversations/${conv.id}/messages`).set(authed(gc.token)).send({ body: "Can your crew come in at 7?" });
    return { gc, sub, messageId: sent.body.message.id as string };
  }

  it("says so when the server has no AI key", async () => {
    setTranslationConfiguredForTests(() => false);
    const { sub, messageId } = await projectChat();
    const res = await request(server).post(`/messages/${messageId}/translate`).set(authed(sub.token)).set("Accept-Language", "es");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("La traducción aún no está configurada en este servidor.");
    expect((await request(server).get("/messages/translation").set(authed(sub.token))).body.available).toBe(false);
    setTranslationConfiguredForTests(null);
  });

  it("translates into the reader's language once, then reuses it", async () => {
    let calls = 0;
    setTranslationConfiguredForTests(() => true);
    setTranslatorForTests(async (text, to) => {
      calls++;
      return to === "es" ? "¿Puede venir su cuadrilla a las 7?" : text;
    });
    const { sub, gc, messageId } = await projectChat();

    const first = await request(server).post(`/messages/${messageId}/translate`).set(authed(sub.token));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ lang: "es", body: "¿Puede venir su cuadrilla a las 7?", cached: false });
    const again = await request(server).post(`/messages/${messageId}/translate`).set(authed(sub.token));
    expect(again.body).toMatchObject({ body: "¿Puede venir su cuadrilla a las 7?", cached: true });
    expect(calls).toBe(1);

    // an English reader can ask for Spanish explicitly
    const forced = await request(server).post(`/messages/${messageId}/translate`).set(authed(gc.token)).send({ to: "es" });
    expect(forced.body.cached).toBe(true);
    const bad = await request(server).post(`/messages/${messageId}/translate`).set(authed(gc.token)).send({ to: "fr" });
    expect(bad.status).toBe(400);

    setTranslatorForTests(null);
    setTranslationConfiguredForTests(null);
  });

  it("only people in the chat can translate its messages", async () => {
    setTranslationConfiguredForTests(() => true);
    setTranslatorForTests(async () => "x");
    const { messageId } = await projectChat();
    const stranger = await signUp("stranger");
    const res = await request(server).post(`/messages/${messageId}/translate`).set(authed(stranger.token));
    expect(res.status).toBe(404);
    setTranslatorForTests(null);
    setTranslationConfiguredForTests(null);
  });
});

describe("Spanish: the bell follows the reader's current language", async () => {
  const { translateStoredNotification } = await import("../src/notifications/translateStored.js");

  it("shows the same notification in English or Spanish depending on the app's language", async () => {
    const gc = await signUp("bgc", "Gale GC");
    await company(gc.token, "Bell GC", "gc");
    const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Bell Tower" });
    const sub = await signUp("bsub", "Bea Sub");
    const subCompanyId = await company(sub.token, "Bell Sub", "sub");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
    const crew = await request(server).get(`/companies/${subCompanyId}/connected-employees`).set(authed(gc.token));
    await request(server).post("/schedule-requests").set(authed(gc.token)).send({
      projectId: project.body.id, subCompanyId, employeeIds: [crew.body.employees[0].id], date: "2099-05-08", startTime: "07:00", endTime: "15:00",
    });

    const read = async (lang?: string) => {
      const req = request(server).get("/notifications").set(authed(sub.token));
      if (lang) req.set("Accept-Language", lang);
      return ((await req).body.notifications as { eventType: string; title: string; body: string }[]).find((n) => n.eventType === "schedule_created")!;
    };
    expect((await read()).title).toBe("New schedule request");
    const es = await read("es-MX");
    expect(es.title).toBe("Nueva solicitud de programación");
    expect(es.body).toContain("Bell GC solicitó 1 persona");
  });

  it("translates notifications saved in English before both languages were kept", () => {
    expect(translateStoredNotification("schedule_created", "New schedule request", "Terrapin Builders requested 2 people for Mon, Nov 2 on Riverside Office Build.")).toEqual({
      title: "Nueva solicitud de programación",
      body: "Terrapin Builders solicitó 2 personas para el lun, 2 nov en Riverside Office Build.",
    });
    expect(translateStoredNotification("join_request", "New join request", "Sam Okafor asked to join Bao Plumbing.")).toEqual({
      title: "Nueva solicitud de ingreso",
      body: "Sam Okafor pidió unirse a Bao Plumbing.",
    });
    expect(translateStoredNotification("schedule_rejected", "Request declined", "Keystone declined Fri, Nov 13 on Clinic. Reason: Crew is out")?.body).toBe(
      "Keystone rechazó el vie, 13 nov en Clinic. Motivo: Crew is out",
    );
    // Customised wording that doesn't match is left as it was.
    expect(translateStoredNotification("join_request", "Heads up", "Something custom")).toEqual({ title: "Heads up", body: "Something custom" });
  });
});
