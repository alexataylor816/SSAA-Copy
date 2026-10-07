import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = createApp();
let n = 0;
const unique = (tag: string) => `msg-${tag}-${Date.now()}-${n++}@example.com`;

async function signUp(tag: string, fullName = `User ${tag}`) {
  const res = await request(app).post("/auth/signup").send({ email: unique(tag), password: "hunter22", fullName });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function company(token: string, name: string, companyType: "gc" | "sub") {
  const res = await request(app).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company.id as string;
}

/** A GC with a project, and a sub connected to it. */
async function connectedPair() {
  const gc = await signUp("gc", "Gina GC");
  await company(gc.token, "Msg GC", "gc");
  const project = await request(app).post("/projects").set(authed(gc.token)).send({ name: "Msg Tower" });
  const sub = await signUp("sub", "Sam Sub");
  const subCompanyId = await company(sub.token, "Msg Sub", "sub");
  await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
  return { gc, sub, subCompanyId, projectId: project.body.id as string };
}

async function projectConversation(token: string, projectId: string) {
  const res = await request(app).get("/conversations").set(authed(token));
  expect(res.status).toBe(200);
  return (res.body.conversations as { id: string; projectId: string | null; unreadCount: number; canPost: boolean }[]).find(
    (c) => c.projectId === projectId,
  );
}

describe("messaging: project channels", () => {
  it("gives the GC and the connected sub the same project channel", async () => {
    const { gc, sub, projectId } = await connectedPair();
    const forGc = await projectConversation(gc.token, projectId);
    const forSub = await projectConversation(sub.token, projectId);
    expect(forGc).toBeTruthy();
    expect(forSub?.id).toBe(forGc?.id);
  });

  it("delivers a message and tracks unread until read", async () => {
    const { gc, sub, projectId } = await connectedPair();
    const conv = (await projectConversation(gc.token, projectId))!;

    const sent = await request(app)
      .post(`/conversations/${conv.id}/messages`)
      .set(authed(gc.token))
      .send({ body: "  Crew needed Thursday  " });
    expect(sent.status).toBe(201);
    expect(sent.body.message.body).toBe("Crew needed Thursday");
    expect(sent.body.message.senderName).toBe("Gina GC");

    const thread = await request(app).get(`/conversations/${conv.id}/messages`).set(authed(sub.token));
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(["Crew needed Thursday"]);

    expect((await projectConversation(sub.token, projectId))!.unreadCount).toBe(1);
    expect((await projectConversation(gc.token, projectId))!.unreadCount).toBe(0);

    await request(app).post(`/conversations/${conv.id}/read`).set(authed(sub.token));
    expect((await projectConversation(sub.token, projectId))!.unreadCount).toBe(0);
  });

  it("hides the channel from a company that isn't on the project", async () => {
    const { gc, projectId } = await connectedPair();
    const conv = (await projectConversation(gc.token, projectId))!;
    const outsider = await signUp("out");
    await company(outsider.token, "Outsider Co", "sub");

    const read = await request(app).get(`/conversations/${conv.id}/messages`).set(authed(outsider.token));
    expect(read.status).toBe(404);
    const post = await request(app)
      .post(`/conversations/${conv.id}/messages`)
      .set(authed(outsider.token))
      .send({ body: "hi" });
    expect(post.status).toBe(404);
  });

  it("keeps each sub's channel private from the other subs on the project", async () => {
    const { gc, sub, projectId } = await connectedPair();
    const project = await request(app).get("/projects").set(authed(gc.token));
    const code = project.body.projects.find((p: { id: string }) => p.id === projectId).connectionCode;
    const rival = await signUp("rival");
    await company(rival.token, "Rival Sub", "sub");
    await request(app).post("/projects/connect").set(authed(rival.token)).send({ code });

    const gcList = await request(app).get("/conversations").set(authed(gc.token));
    const gcChannels = gcList.body.conversations.filter((c: { projectId: string }) => c.projectId === projectId);
    expect(gcChannels.map((c: { subtitle: string }) => c.subtitle).sort()).toEqual(["Msg Sub", "Rival Sub"]);

    const subChannel = (await projectConversation(sub.token, projectId))!;
    const rivalChannel = (await projectConversation(rival.token, projectId))!;
    expect(rivalChannel.id).not.toBe(subChannel.id);

    await request(app).post(`/conversations/${subChannel.id}/messages`).set(authed(sub.token)).send({ body: "our rate" });
    const peek = await request(app).get(`/conversations/${subChannel.id}/messages`).set(authed(rival.token));
    expect(peek.status).toBe(404);
  });

  it("refuses empty messages", async () => {
    const { gc, projectId } = await connectedPair();
    const conv = (await projectConversation(gc.token, projectId))!;
    const res = await request(app).post(`/conversations/${conv.id}/messages`).set(authed(gc.token)).send({ body: "   " });
    expect(res.status).toBe(400);
  });

  it("lets a basic sub member read the channel but not post", async () => {
    const { gc, sub, subCompanyId, projectId } = await connectedPair();
    const basic = await signUp("basic");
    await request(app).post(`/companies/${subCompanyId}/join-requests`).set(authed(basic.token));
    const listed = await request(app).get(`/companies/${subCompanyId}/join-requests`).set(authed(sub.token));
    await request(app)
      .post(`/companies/${subCompanyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(sub.token))
      .send({ permissionLevel: "basic" });

    const conv = (await projectConversation(basic.token, projectId))!;
    expect(conv.canPost).toBe(false);
    await request(app).post(`/conversations/${conv.id}/messages`).set(authed(gc.token)).send({ body: "hello all" });
    const read = await request(app).get(`/conversations/${conv.id}/messages`).set(authed(basic.token));
    expect(read.status).toBe(200);
    expect(read.body.messages).toHaveLength(1);

    const post = await request(app).post(`/conversations/${conv.id}/messages`).set(authed(basic.token)).send({ body: "me too" });
    expect(post.status).toBe(403);
  });
});

describe("messaging: group chats", () => {
  it("creates a group with the people you pick and lets them talk", async () => {
    const { gc, sub } = await connectedPair();
    const created = await request(app)
      .post("/conversations/group")
      .set(authed(gc.token))
      .send({ title: "Level 2 crew", userIds: [sub.id] });
    expect(created.status).toBe(201);
    const id = created.body.conversationId as string;

    const subList = await request(app).get("/conversations").set(authed(sub.token));
    const group = subList.body.conversations.find((c: { id: string }) => c.id === id);
    expect(group.type).toBe("group");
    expect(group.title).toBe("Level 2 crew");
    expect(group.subtitle).toBe("2 members");

    const thread = await request(app).get(`/conversations/${id}/messages`).set(authed(sub.token));
    expect(thread.body.messages[0].kind).toBe("system");
    expect(thread.body.messages[0].body).toContain("created the group");

    const reply = await request(app).post(`/conversations/${id}/messages`).set(authed(sub.token)).send({ body: "On it" });
    expect(reply.status).toBe(201);
  });

  it("lets a member add a contact, and refuses strangers and duplicates", async () => {
    const { gc, sub } = await connectedPair();
    const teammate = await signUp("teammate", "Tia Teammate");
    // Join the GC's company so they're a contact of the GC.
    const me = await request(app).post("/query").set(authed(gc.token)).send({
      table: "users",
      operation: "select",
      filters: [{ op: "eq", column: "id", value: gc.id }],
    });
    const gcCompanyId = me.body.data[0].company_id as string;
    await request(app).post(`/companies/${gcCompanyId}/join-requests`).set(authed(teammate.token));
    const listed = await request(app).get(`/companies/${gcCompanyId}/join-requests`).set(authed(gc.token));
    await request(app)
      .post(`/companies/${gcCompanyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(gc.token))
      .send({ permissionLevel: "partial" });

    const created = await request(app).post("/conversations/group").set(authed(gc.token)).send({ title: "Team", userIds: [sub.id] });
    const id = created.body.conversationId as string;

    const added = await request(app).post(`/conversations/${id}/participants`).set(authed(gc.token)).send({ userId: teammate.id });
    expect(added.status).toBe(201);
    expect(added.body.message.body).toContain("added Tia Teammate");
    const members = await request(app).get(`/conversations/${id}/participants`).set(authed(teammate.token));
    expect(members.body.participants).toHaveLength(3);

    const again = await request(app).post(`/conversations/${id}/participants`).set(authed(gc.token)).send({ userId: teammate.id });
    expect(again.status).toBe(400);

    const stranger = await signUp("groupstranger");
    await company(stranger.token, "Stranger Group Co", "gc");
    const refused = await request(app).post(`/conversations/${id}/participants`).set(authed(gc.token)).send({ userId: stranger.id });
    expect(refused.status).toBe(403);
    const outsiderRead = await request(app).get(`/conversations/${id}/messages`).set(authed(stranger.token));
    expect(outsiderRead.status).toBe(404);
  });

  it("needs a name and at least one other person", async () => {
    const { gc, sub } = await connectedPair();
    const noName = await request(app).post("/conversations/group").set(authed(gc.token)).send({ title: " ", userIds: [sub.id] });
    expect(noName.status).toBe(400);
    const nobody = await request(app).post("/conversations/group").set(authed(gc.token)).send({ title: "Solo", userIds: [] });
    expect(nobody.status).toBe(400);
  });
});

describe("messaging: direct messages", () => {
  it("opens one DM between people on a shared project and reuses it", async () => {
    const { gc, sub } = await connectedPair();
    const contacts = await request(app).get("/messaging/contacts").set(authed(gc.token));
    expect(contacts.body.contacts.map((c: { userId: string }) => c.userId)).toContain(sub.id);

    const first = await request(app).post("/conversations/dm").set(authed(gc.token)).send({ userId: sub.id });
    const again = await request(app).post("/conversations/dm").set(authed(sub.token)).send({ userId: gc.id });
    expect(first.status).toBe(200);
    expect(again.body.conversationId).toBe(first.body.conversationId);

    await request(app)
      .post(`/conversations/${first.body.conversationId}/messages`)
      .set(authed(sub.token))
      .send({ body: "Got it" });
    const list = await request(app).get("/conversations").set(authed(gc.token));
    const dm = list.body.conversations.find((c: { id: string }) => c.id === first.body.conversationId);
    expect(dm.title).toBe("Sam Sub");
    expect(dm.unreadCount).toBe(1);
  });

  it("refuses a DM to someone you don't work with", async () => {
    const { gc } = await connectedPair();
    const stranger = await signUp("stranger");
    await company(stranger.token, "Stranger Co", "gc");
    const res = await request(app).post("/conversations/dm").set(authed(gc.token)).send({ userId: stranger.id });
    expect(res.status).toBe(403);
  });
});
