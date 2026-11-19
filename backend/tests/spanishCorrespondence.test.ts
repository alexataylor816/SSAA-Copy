import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { setUserIsAdmin, type OperatorLevel } from "../src/models/users.js";
import { SPANISH_TEMPLATES, findTemplate, seedNotificationTemplates } from "../src/notifications/templates.js";
import { renderEmail } from "../src/notifications/correspondence.js";
import { setTemplateTranslatorForTests, setTemplateTranslationConfiguredForTests } from "../src/notifications/templateTranslate.js";
import { setTranslatorForTests, setTranslationConfiguredForTests } from "../src/messaging/translate.js";

const server = await startTestServer();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string, fullName = `User ${tag}`) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `esc-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function operator(level: OperatorLevel = "main_operator") {
  const op = await signUp(level);
  await setUserIsAdmin(op.id, true, level);
  return op;
}

async function company(token: string, name: string, companyType: "gc" | "sub") {
  return (await request(server).post("/companies").set(authed(token)).send({ name, companyType })).body.company.id as string;
}

type Tpl = { id: string; eventType: string; subjectEs: string | null; pushTitleEs: string | null; pushBodyEs: string | null; spanishOutdated: boolean };
const templates = async (token: string) => (await request(server).get("/admin/templates").set(authed(token))).body.templates as Tpl[];
const auditLog = async (token: string) =>
  ((await request(server).get("/admin/audit-log").set(authed(token))).body.entries as { action: string; summary: string }[]).map((e) => e.summary);

/** GC sends a schedule request to a sub whose owner reads Spanish; returns the sub's bell entry. */
async function scheduleRequestToSpanishSub() {
  const gc = await signUp("gc", "Gina GC");
  await company(gc.token, `Constructora ${n}`, "gc");
  const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Torre Norte" });
  const sub = await signUp("sub", "Saúl Sub");
  const subCompanyId = await company(sub.token, `Plomería ${n}`, "sub");
  await request(server).patch("/auth/profile").set(authed(sub.token)).send({ language: "es" });
  await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
  const crew = await request(server).get(`/companies/${subCompanyId}/connected-employees`).set(authed(gc.token));
  await request(server).post("/schedule-requests").set(authed(gc.token)).send({
    projectId: project.body.id, subCompanyId, employeeIds: [crew.body.employees[0].id], date: "2099-04-07", startTime: "07:00", endTime: "15:00",
  });
  const bell = async (token: string, lang?: string) => {
    const req = request(server).get("/notifications").set(authed(token));
    if (lang) req.set("Accept-Language", lang);
    return ((await req).body.notifications as { eventType: string; title: string; body: string }[]).find((x) => x.eventType === "schedule_created")!;
  };
  return { sub, bell };
}

afterEach(() => {
  setTemplateTranslatorForTests(null);
  setTemplateTranslationConfiguredForTests(null);
  setTranslatorForTests(null);
  setTranslationConfiguredForTests(null);
});

describe("Spanish correspondence: saved in the database", () => {
  it("seeds the Spanish once and never overwrites an operator's edit", async () => {
    const seeded = await findTemplate("schedule_created");
    expect(seeded?.pushTitleEs).toBe(SPANISH_TEMPLATES.schedule_created.push?.title);
    expect(seeded?.subjectEs).toBe(SPANISH_TEMPLATES.schedule_created.subject);

    const op = await operator();
    const tpl = (await templates(op.token)).find((t) => t.eventType === "schedule_created")!;
    await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(op.token)).send({ pushTitleEs: "Solicitud nueva (editada)" });
    await seedNotificationTemplates(); // what every restart does
    expect((await findTemplate("schedule_created"))?.pushTitleEs).toBe("Solicitud nueva (editada)");
    expect((await auditLog(op.token)).some((s) => s.includes("Spanish push text"))).toBe(true);
  });

  it("a Spanish reader gets the operator's edited Spanish; English stays English", async () => {
    const op = await operator();
    const tpl = (await templates(op.token)).find((t) => t.eventType === "schedule_created")!;
    await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(op.token)).send({
      pushTitleEs: "¡Nueva solicitud, maestro!",
      pushBodyEs: "{requesting_company} pide gente para {project_name}.",
      subjectEs: "Solicitud de {requesting_company} (editada)",
    });

    const { sub, bell } = await scheduleRequestToSpanishSub();
    expect((await bell(sub.token)).title).toBe("¡Nueva solicitud, maestro!");
    expect((await bell(sub.token)).body).toMatch(/pide gente para Torre Norte\.$/);
    // the same notification, read with the app in English
    expect((await bell(sub.token, "en-US")).title).toBe("New schedule request");

    const es = await renderEmail("schedule_created", { requesting_company: "Terrapin" }, "es");
    expect(es?.subject).toBe("Solicitud de Terrapin (editada)");
    const en = await renderEmail("schedule_created", { requesting_company: "Terrapin" }, "en");
    expect(en?.subject).not.toContain("editada");
  });

  it("an empty Spanish field falls back to English instead of sending a blank", async () => {
    const op = await operator();
    const tpl = (await templates(op.token)).find((t) => t.eventType === "schedule_created")!;
    await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(op.token)).send({ pushTitleEs: "", pushBodyEs: "   ", subjectEs: "" });
    const saved = await findTemplate("schedule_created");
    expect(saved?.pushTitleEs).toBeNull();

    const { sub, bell } = await scheduleRequestToSpanishSub();
    const note = await bell(sub.token);
    expect(note.title).toBe(saved?.pushTitle);
    expect(note.body.length).toBeGreaterThan(0);
    const email = await renderEmail("schedule_created", { requesting_company: "Terrapin" }, "es");
    expect(email?.subject).toBe((await renderEmail("schedule_created", { requesting_company: "Terrapin" }, "en"))?.subject);
  });

  it("flags the Spanish as outdated after the English changes, until the Spanish is saved again", async () => {
    const op = await operator();
    const tpl = (await templates(op.token)).find((t) => t.eventType === "join_request")!;
    const afterEn = await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(op.token)).send({ pushTitle: "Someone wants in" });
    expect(afterEn.body.spanishOutdated).toBe(true);
    const afterEs = await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(op.token)).send({ pushTitleEs: "Alguien quiere unirse" });
    expect(afterEs.body.spanishOutdated).toBe(false);
  });
});

describe("Spanish correspondence: Translate to Spanish", () => {
  const draft = {
    subject: "New request from {requesting_company}",
    bodyHtml: "<p>Hi, {requesting_company} needs {crew_count} on <strong>{project_name}</strong>.</p>",
    pushTitle: "New request",
    pushBody: "{requesting_company} needs {crew_count}.",
  };

  it("translates the current English draft once, without saving, and flags a dropped placeholder", async () => {
    let calls = 0;
    setTemplateTranslationConfiguredForTests(() => true);
    setTemplateTranslatorForTests(async (en) => {
      calls++;
      expect(en.subject).toBe(draft.subject);
      return {
        subject: "Nueva solicitud de {requesting_company}",
        bodyHtml: "<p>Hola, {requesting_company} necesita gente en <strong>{project_name}</strong>.</p>", // {crew_count} dropped
        pushTitle: "Nueva solicitud",
        pushBody: "{requesting_company} necesita {crew_count}.",
      };
    });
    const op = await operator();
    const tpl = (await templates(op.token)).find((t) => t.eventType === "schedule_confirmed")!;
    const before = await findTemplate("schedule_confirmed");

    const res = await request(server).post(`/admin/templates/${tpl.id}/translate`).set(authed(op.token)).send(draft);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: "Nueva solicitud de {requesting_company}", pushTitle: "Nueva solicitud", missingPlaceholders: [] });

    const dropped = await request(server).post(`/admin/templates/${tpl.id}/translate`).set(authed(op.token)).send({ ...draft, pushBody: "" });
    expect(dropped.body.missingPlaceholders).toEqual(["crew_count"]);
    expect(dropped.body.pushBody).toBe(""); // empty English stays empty
    expect(calls).toBe(2);

    expect((await findTemplate("schedule_confirmed"))?.subjectEs).toBe(before?.subjectEs); // nothing saved
    expect((await auditLog(op.token)).some((s) => s.includes("to Spanish"))).toBe(true);
  });

  it("is refused for view-only operators and says so without an AI key", async () => {
    setTemplateTranslationConfiguredForTests(() => true);
    setTemplateTranslatorForTests(async () => ({ subject: "x", bodyHtml: "x", pushTitle: "x", pushBody: "x" }));
    const viewer = await operator("view_only");
    const tpl = (await templates(viewer.token))[0];
    expect((await request(server).post(`/admin/templates/${tpl.id}/translate`).set(authed(viewer.token)).send(draft)).status).toBe(403);
    expect((await request(server).patch(`/admin/templates/${tpl.id}`).set(authed(viewer.token)).send({ subjectEs: "x" })).status).toBe(403);

    setTemplateTranslationConfiguredForTests(() => false);
    const op = await operator();
    expect((await request(server).get("/admin/templates").set(authed(op.token))).body.translation).toBe(false);
    const res = await request(server).post(`/admin/templates/${tpl.id}/translate`).set(authed(op.token)).set("Accept-Language", "es").send(draft);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("La traducción aún no está configurada en este servidor.");
  });
});

describe("Message translation switch", () => {
  async function chatMessage() {
    const gc = await signUp("mgc", "Greg GC");
    await company(gc.token, `Switch GC ${n}`, "gc");
    const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Bridge Job" });
    const sub = await signUp("msub", "Steve Sub");
    await company(sub.token, `Switch Sub ${n}`, "sub");
    await request(server).patch("/auth/profile").set(authed(sub.token)).send({ language: "es" });
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
    const conv = ((await request(server).get("/conversations").set(authed(gc.token))).body.conversations as { id: string; projectId: string | null }[]).find(
      (c) => c.projectId === project.body.id,
    )!;
    const send = async (body: string) =>
      (await request(server).post(`/conversations/${conv.id}/messages`).set(authed(gc.token)).send({ body })).body.message.id as string;
    return { sub, messageId: await send("See you at 7"), other: await send("Bring the ladder") };
  }

  it("hides the button and blocks new translations when off; saved ones still show; audit-logged", async () => {
    setTranslationConfiguredForTests(() => true);
    setTranslatorForTests(async () => "Nos vemos a las 7");
    const op = await operator();
    const viewer = await operator("view_only");
    const { sub, messageId, other } = await chatMessage();

    expect((await request(server).get("/admin/settings").set(authed(op.token))).body.settings.messageTranslationEnabled).toBe(true);
    expect((await request(server).get("/messages/translation").set(authed(sub.token))).body.available).toBe(true);
    await request(server).post(`/messages/${messageId}/translate`).set(authed(sub.token)); // cached before switching off

    expect((await request(server).patch("/admin/settings").set(authed(viewer.token)).send({ messageTranslationEnabled: false })).status).toBe(403);
    const off = await request(server).patch("/admin/settings").set(authed(op.token)).send({ messageTranslationEnabled: false });
    expect(off.body.settings.messageTranslationEnabled).toBe(false);
    expect((await request(server).get("/messages/translation").set(authed(sub.token))).body.available).toBe(false);

    const blocked = await request(server).post(`/messages/${other}/translate`).set(authed(sub.token)).set("Accept-Language", "es");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("La traducción de mensajes está desactivada.");
    const cached = await request(server).post(`/messages/${messageId}/translate`).set(authed(sub.token));
    expect(cached.body).toMatchObject({ body: "Nos vemos a las 7", cached: true });

    await request(server).patch("/admin/settings").set(authed(op.token)).send({ messageTranslationEnabled: true });
    expect((await request(server).get("/messages/translation").set(authed(sub.token))).body.available).toBe(true);
    const log = await auditLog(op.token);
    expect(log).toContain("Turned message translation off");
    expect(log).toContain("Turned message translation on");
  });
});
