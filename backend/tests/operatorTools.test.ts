import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { setUserIsAdmin, type OperatorLevel } from "../src/models/users.js";
import { fillPlaceholders } from "../src/notifications/templates.js";

const server = await startTestServer();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `tools-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `Pat ${tag}` });
  return { token: res.body.token as string, id: res.body.user.id as string, email: res.body.user.email as string };
}

async function operator(level: OperatorLevel = "main_operator") {
  const op = await signUp(level);
  await setUserIsAdmin(op.id, true, level);
  return op;
}

/** A sub owner with one approved member at `partial`. */
async function subWithMember() {
  const owner = await signUp("owner");
  const companyId = (await request(server).post("/companies").set(authed(owner.token)).send({ name: `Tools Sub ${n}`, companyType: "sub" })).body.company.id as string;
  const member = await signUp("member");
  const join = await request(server).post(`/companies/${companyId}/join-requests`).set(authed(member.token));
  await request(server)
    .post(`/companies/${companyId}/join-requests/${join.body.id}/approve`)
    .set(authed(owner.token))
    .send({ permissionLevel: "partial" });
  return { owner, member, companyId };
}

const log = async (token: string, query = "") => (await request(server).get(`/admin/correspondence${query}`).set(authed(token))).body.entries as {
  eventType: string;
  channel: string;
  status: string;
  recipientUserId: string | null;
  subject: string | null;
}[];

describe("operator levels", () => {
  it("lets a view-only operator look but not change, even while viewing as someone", async () => {
    const viewer = await operator("view_only");
    const { member } = await subWithMember();
    expect((await request(server).get("/admin/users").set(authed(viewer.token))).status).toBe(200);
    expect((await request(server).get("/admin/me").set(authed(viewer.token))).body).toMatchObject({ level: "view_only", canChange: false });

    const suspend = await request(server).post(`/admin/users/${member.id}/suspend`).set(authed(viewer.token)).send({ suspended: true });
    expect(suspend.status).toBe(403);

    const as = await request(server).post("/admin/view-as").set(authed(viewer.token)).send({ userId: member.id });
    expect(as.body.readOnly).toBe(true);
    expect((await request(server).get("/auth/me").set(authed(as.body.token))).body.viewingAs.readOnly).toBe(true);
    expect((await request(server).get("/projects").set(authed(as.body.token))).status).toBe(200);
    const write = await request(server).post("/projects").set(authed(as.body.token)).send({ name: "Nope" });
    expect(write.status).toBe(403);
    expect(write.body.error).toMatch(/view only/);
  });

  it("leaves operator management to the owner once there is one, and audits it", async () => {
    const owner = await operator("owner");
    const main = await operator("main_operator");
    const someone = await signUp("someone");

    const byMain = await request(server).post("/admin/operators").set(authed(main.token)).send({ email: someone.email, level: "view_only" });
    expect(byMain.status).toBe(403);

    const byOwner = await request(server).post("/admin/operators").set(authed(owner.token)).send({ email: someone.email, level: "view_only" });
    expect(byOwner.body).toMatchObject({ isAdmin: true, level: "view_only" });
    const list = (await request(server).get("/admin/operators").set(authed(main.token))).body;
    expect(list.canManage).toBe(false);
    expect(list.operators.find((o: { userId: string }) => o.userId === someone.id).level).toBe("view_only");

    const audit = (await request(server).get("/admin/audit-log").set(authed(owner.token))).body.entries;
    expect(audit[0]).toMatchObject({ operatorId: owner.id, action: "set_operator", targetId: someone.id });
  });
});

describe("support actions", () => {
  it("suspends an account (no sign-in, old sessions stop) and restores it", async () => {
    const op = await operator();
    const { member } = await subWithMember();

    expect((await request(server).post(`/admin/users/${member.id}/suspend`).set(authed(op.token)).send({ suspended: true })).body.suspended).toBe(true);
    expect((await request(server).get("/projects").set(authed(member.token))).status).toBe(401);
    const signin = await request(server).post("/auth/signin").send({ email: member.email, password: "hunter22" });
    expect(signin.status).toBe(403);
    expect(signin.body.error).toMatch(/suspended/);

    await request(server).post(`/admin/users/${member.id}/suspend`).set(authed(op.token)).send({ suspended: false });
    expect((await request(server).post("/auth/signin").send({ email: member.email, password: "hunter22" })).status).toBe(200);
  });

  it("sends a reset code, handing it to the operator when email isn't set up", async () => {
    const op = await operator();
    const { member } = await subWithMember();
    const res = await request(server).post(`/admin/users/${member.id}/password-reset`).set(authed(op.token));
    expect(res.body).toMatchObject({ emailed: false, expiresInMinutes: 15 });
    expect(res.body.code).toMatch(/^\d{6}$/);

    const reset = await request(server).post("/auth/verify-reset-code").send({ email: member.email, code: res.body.code, newPassword: "newpass99" });
    expect(reset.status).toBe(200);

    const entry = (await log(op.token, "?channel=email")).find((e) => e.recipientUserId === member.id && e.eventType === "password_reset");
    expect(entry).toMatchObject({ status: "skipped", subject: "Your Password Reset Code" });
  });

  it("changes a level and moves the account holder", async () => {
    const op = await operator();
    const { owner, member, companyId } = await subWithMember();

    expect((await request(server).patch(`/admin/users/${member.id}/level`).set(authed(op.token)).send({ permissionLevel: "full" })).status).toBe(200);
    expect((await request(server).patch(`/admin/users/${owner.id}/level`).set(authed(op.token)).send({ permissionLevel: "basic" })).status).toBe(400);

    expect((await request(server).post(`/admin/companies/${companyId}/account-holder`).set(authed(op.token)).send({ userId: member.id })).status).toBe(200);
    const detail = (await request(server).get(`/admin/companies/${companyId}`).set(authed(op.token))).body;
    const levels = Object.fromEntries(detail.members.map((m: { userId: string; permissionLevel: string }) => [m.userId, m.permissionLevel]));
    expect(levels).toEqual({ [member.id]: "account_holder", [owner.id]: "full" });
    expect(detail.audit[0].action).toBe("transfer_account_holder");
  });
});

describe("correspondence", () => {
  it("logs each bell notification and uses the template's push wording", async () => {
    const op = await operator();
    const templates = (await request(server).get("/admin/templates").set(authed(op.token))).body.templates as { id: string; eventType: string }[];
    const joinTpl = templates.find((t) => t.eventType === "join_request")!;
    await request(server).patch(`/admin/templates/${joinTpl.id}`).set(authed(op.token)).send({ pushTitle: "Knock knock: {requester_name}" });

    const owner = await signUp("owner2");
    const companyId = (await request(server).post("/companies").set(authed(owner.token)).send({ name: `Tools Sub B ${n}`, companyType: "sub" })).body.company.id;
    const asker = await signUp("asker");
    await request(server).post(`/companies/${companyId}/join-requests`).set(authed(asker.token));

    const bell = (await request(server).get("/notifications").set(authed(owner.token))).body.notifications;
    expect(bell[0].title).toBe("Knock knock: Pat asker");
    const entries = await log(op.token);
    expect(entries.find((e) => e.recipientUserId === owner.id && e.channel === "push")).toMatchObject({ eventType: "join_request", status: "sent" });
    expect(entries.find((e) => e.recipientUserId === owner.id && e.channel === "email")).toMatchObject({ status: "skipped" });
  });

  it("sends nothing on a channel whose template is switched off, and says so in the log", async () => {
    const op = await operator();
    const templates = (await request(server).get("/admin/templates").set(authed(op.token))).body.templates as { id: string; eventType: string }[];
    const approved = templates.find((t) => t.eventType === "join_approved")!;
    await request(server).patch(`/admin/templates/${approved.id}`).set(authed(op.token)).send({ pushActive: false });
    try {
      const { member } = await subWithMember();
      const bell = (await request(server).get("/notifications").set(authed(member.token))).body.notifications;
      expect(bell.find((b: { eventType: string }) => b.eventType === "join_approved")).toBeUndefined();
      expect((await log(op.token)).find((e) => e.recipientUserId === member.id && e.eventType === "join_approved" && e.channel === "push")?.status).toBe("off");
    } finally {
      await request(server).patch(`/admin/templates/${approved.id}`).set(authed(op.token)).send({ pushActive: true });
    }
  });

  it("refuses template edits from someone who isn't an operator", async () => {
    const someone = await signUp("nobody");
    const op = await operator();
    const id = (await request(server).get("/admin/templates").set(authed(op.token))).body.templates[0].id;
    expect((await request(server).patch(`/admin/templates/${id}`).set(authed(someone.token)).send({ subject: "x" })).status).toBe(403);
  });

  it("fills {name} and {{name}}, escapes values in HTML, and drops unknown placeholders", () => {
    expect(fillPlaceholders("Hi {name}, {{name}}! {missing}", { name: "Ana" })).toBe("Hi Ana, Ana! ");
    expect(fillPlaceholders("<b>{name}</b>", { name: "<script>" }, true)).toBe("<b>&lt;script&gt;</b>");
    expect(fillPlaceholders("p { color: red }", {})).toBe("p { color: red }");
  });
});
