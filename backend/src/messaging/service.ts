/**
 * Messaging, ported from the Lovable app's conversations/messages schema
 * (supabase/migrations/20260606185901, per-sub channels from 20260729235649).
 * A project has one private channel per connected sub (the GC's company + that
 * sub), plus 1:1 DMs. Group chats, contacts, the user directory and
 * attachments are not ported yet.
 */
import crypto from "node:crypto";
import { database } from "../db.js";
import { findUserById, type User } from "../models/users.js";
import { findUserRole } from "../rbac/models.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../rbac/errors.js";

const MAX_BODY = 4000;

export async function ensureMessagingTables(): Promise<void> {
  // A first cut had one shared channel per project. It was never released and
  // holds no data, but a dev SQLite database may still have that shape.
  // PRAGMA is SQLite-only; MySQL never had the old shape.
  if (database.dialect === "sqlite") {
    const cols = await database.all<{ name: string }>("PRAGMA table_info(conversations)");
    if (cols.length > 0 && !cols.some((c) => c.name === "sub_company_id")) {
      await database.exec(`
        DROP TABLE IF EXISTS message_reads;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversation_participants;
        DROP TABLE IF EXISTS conversations;
      `);
    }
  }

  await database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('project', 'dm', 'group')),
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      sub_company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
      title TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      UNIQUE (project_id, sub_company_id)
    );
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      company_id TEXT,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT,
      sender_company_id TEXT,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS message_reads (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      last_read_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );
  `);
}

// ISO with milliseconds, so message order and read cut-offs compare as strings.
const now = () => new Date().toISOString();

export interface ConversationSummary {
  id: string;
  type: "project" | "dm" | "group";
  projectId: string | null;
  subCompanyId: string | null;
  title: string;
  subtitle: string | null;
  lastMessageAt: string;
  lastMessage: { body: string; senderName: string | null; createdAt: string } | null;
  unreadCount: number;
  canPost: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderName: string | null;
  senderCompanyName: string | null;
  body: string;
  kind: string;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  type: "project" | "dm" | "group";
  project_id: string | null;
  sub_company_id: string | null;
  title: string | null;
  last_message_at: string;
}

async function requireUser(userId: string): Promise<User> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

/**
 * Insertion order for messages, to break ties between messages created in
 * the same millisecond: SQLite's implicit rowid, MySQL's AUTO_INCREMENT
 * `seq` column (MySQL has no rowid). Selected as `seq` but never returned.
 */
const SEQ = database.dialect === "sqlite" ? "m.rowid" : "m.seq";
const NEWEST_FIRST = `m.created_at DESC, ${SEQ} DESC`;

/** Records that the user has read the conversation up to `ts` (insert or update). */
async function upsertRead(conversationId: string, userId: string, ts: string) {
  const conflict =
    database.dialect === "mysql"
      ? "AS new ON DUPLICATE KEY UPDATE last_read_at = new.last_read_at"
      : "ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at";
  await database.run(
    `INSERT INTO message_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)
     ${conflict}`,
    [conversationId, userId, ts],
  );
}

async function visibleProjects(companyId: string): Promise<{ id: string; name: string; company_id: string }[]> {
  return database.all<{ id: string; name: string; company_id: string }>(
    `SELECT id, name, company_id FROM projects WHERE company_id = @c
     UNION
     SELECT p.id, p.name, p.company_id FROM projects p
       JOIN project_connections pc ON pc.project_id = p.id
      WHERE pc.sub_company_id = @c`,
    { c: companyId },
  );
}

/**
 * get_or_create_project_sub_conversation + its participant sync: the channel
 * holds everyone at the owning company plus everyone at this one sub, and
 * drops the sub's people if the sub is no longer connected.
 */
async function syncProjectSubConversation(projectId: string, subCompanyId: string, createdBy: string | null): Promise<string> {
  const project = await database.get<{ name: string; company_id: string }>(
    "SELECT name, company_id FROM projects WHERE id = ?",
    [projectId],
  );
  if (!project) throw new NotFoundError("Project not found.");

  let conv = await database.get<{ id: string }>(
    "SELECT id FROM conversations WHERE project_id = ? AND sub_company_id = ?",
    [projectId, subCompanyId],
  );
  if (!conv) {
    const id = crypto.randomUUID();
    const ts = now();
    await database.run(
      `INSERT INTO conversations (id, type, project_id, sub_company_id, title, created_by, created_at, last_message_at)
       VALUES (?, 'project', ?, ?, ?, ?, ?, ?)`,
      [id, projectId, subCompanyId, project.name, createdBy, ts, ts],
    );
    conv = { id };
  }

  const stillConnected = !!(await database.get(
    "SELECT 1 FROM project_connections WHERE project_id = ? AND sub_company_id = ?",
    [projectId, subCompanyId],
  ));
  const companies = stillConnected ? [project.company_id, subCompanyId] : [project.company_id];
  const eligible = await database.all<{ id: string; company_id: string }>(
    `SELECT id, company_id FROM users WHERE company_id IN (${companies.map(() => "?").join(", ")})`,
    companies,
  );

  const ts = now();
  const convId = conv.id;
  // Two requests can sync the same channel at once, so an existing row is skipped rather than an error.
  const insertIgnore = database.dialect === "mysql" ? "INSERT IGNORE" : "INSERT OR IGNORE";
  await database.transaction(async () => {
    const keep = new Set(eligible.map((u) => u.id));
    const current = await database.all<{ user_id: string }>(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = ?",
      [convId],
    );
    for (const row of current) {
      if (!keep.has(row.user_id)) {
        await database.run("DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?", [
          convId,
          row.user_id,
        ]);
      }
    }
    for (const u of eligible) {
      await database.run(
        `${insertIgnore} INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)`,
        [convId, u.id, u.company_id, ts],
      );
    }
  });
  return convId;
}

/** One channel per sub on projects this company owns; its own channel on projects it joined. */
async function syncChannelsFor(user: User) {
  if (!user.companyId) return;
  for (const project of await visibleProjects(user.companyId)) {
    if (project.company_id === user.companyId) {
      const subs = await database.all<{ sub_company_id: string }>(
        "SELECT sub_company_id FROM project_connections WHERE project_id = ?",
        [project.id],
      );
      for (const sub of subs) await syncProjectSubConversation(project.id, sub.sub_company_id, user.id);
    } else {
      await syncProjectSubConversation(project.id, user.companyId, user.id);
    }
  }
}

async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  return !!(await database.get(
    "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
    [conversationId, userId],
  ));
}

async function requireConversation(conversationId: string, user: User): Promise<ConversationRow> {
  const conv = await database.get<ConversationRow>("SELECT * FROM conversations WHERE id = ?", [conversationId]);
  if (!conv) throw new NotFoundError("Conversation not found.");
  if (conv.type === "project" && conv.project_id && conv.sub_company_id) {
    await syncProjectSubConversation(conv.project_id, conv.sub_company_id, null);
  }
  if (!(await isParticipant(conv.id, user.id))) throw new NotFoundError("Conversation not found.");
  return conv;
}

/** can_post_in_project_conversation: subs below partial read the channel but can't post. */
async function canPost(conv: ConversationRow, user: User): Promise<boolean> {
  if (user.isAdmin || conv.type !== "project" || !user.companyId) return true;
  const company = await database.get<{ company_type: string }>("SELECT company_type FROM companies WHERE id = ?", [
    user.companyId,
  ]);
  if (company?.company_type !== "sub") return true;
  const level = (await findUserRole(user.id, user.companyId))?.permissionLevel;
  return level !== "basic" && level !== "level_1";
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const user = await requireUser(userId);
  await syncChannelsFor(user);

  const rows = await database.all<ConversationRow>(
    `SELECT c.* FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE cp.user_id = ?
      ORDER BY c.last_message_at DESC`,
    [user.id],
  );

  return Promise.all(rows.map(async (conv): Promise<ConversationSummary> => {
    let title = conv.title ?? "Conversation";
    let subtitle: string | null = null;
    if (conv.type === "project" && conv.project_id) {
      const project = await database.get<{ name: string; company_id: string; gc_name: string; sub_name: string | null }>(
        `SELECT p.name, p.company_id, gc.name AS gc_name, sub.name AS sub_name FROM projects p
           JOIN companies gc ON gc.id = p.company_id
           LEFT JOIN companies sub ON sub.id = ?
          WHERE p.id = ?`,
        [conv.sub_company_id, conv.project_id],
      );
      title = project?.name ?? title;
      // Name whoever is on the other side of this channel.
      subtitle = (project?.company_id === user.companyId ? project?.sub_name : project?.gc_name) ?? null;
    } else if (conv.type === "dm") {
      const other = await database.get<{ full_name: string; email: string; company: string | null }>(
        `SELECT u.full_name, u.email, co.name AS company FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           LEFT JOIN companies co ON co.id = u.company_id
          WHERE cp.conversation_id = ? AND cp.user_id <> ?`,
        [conv.id, user.id],
      );
      title = other?.full_name || other?.email || "Direct message";
      subtitle = other?.company ?? null;
    } else if (conv.type === "group") {
      const count = (await database.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ?",
        [conv.id],
      ))!.n;
      subtitle = `${count} member${count === 1 ? "" : "s"}`;
    }

    const last = await database.get<{ body: string; created_at: string; full_name: string | null }>(
      `SELECT m.body, m.created_at, u.full_name FROM messages m LEFT JOIN users u ON u.id = m.sender_user_id
        WHERE m.conversation_id = ? ORDER BY ${NEWEST_FIRST} LIMIT 1`,
      [conv.id],
    );

    const readAt =
      (
        await database.get<{ last_read_at: string }>(
          "SELECT last_read_at FROM message_reads WHERE conversation_id = ? AND user_id = ?",
          [conv.id, user.id],
        )
      )?.last_read_at ?? "";
    const unread = (await database.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages
        WHERE conversation_id = ? AND created_at > ? AND (sender_user_id IS NULL OR sender_user_id <> ?)`,
      [conv.id, readAt, user.id],
    ))!.n;

    return {
      id: conv.id,
      type: conv.type,
      projectId: conv.project_id,
      subCompanyId: conv.sub_company_id,
      title,
      subtitle,
      lastMessageAt: conv.last_message_at,
      lastMessage: last ? { body: last.body, senderName: last.full_name, createdAt: last.created_at } : null,
      unreadCount: unread,
      canPost: await canPost(conv, user),
    };
  }));
}

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.sender_user_id, m.body, m.kind, m.created_at, ${SEQ} AS seq,
         u.full_name AS sender_name, co.name AS sender_company
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    LEFT JOIN companies co ON co.id = m.sender_company_id`;

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  body: string;
  kind: string;
  created_at: string;
  sender_name: string | null;
  sender_company: string | null;
}

const toView = (r: MessageRow): MessageView => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderUserId: r.sender_user_id,
  senderName: r.sender_name,
  senderCompanyName: r.sender_company,
  body: r.body,
  kind: r.kind,
  createdAt: r.created_at,
});

export async function listMessages(userId: string, conversationId: string): Promise<MessageView[]> {
  const user = await requireUser(userId);
  await requireConversation(conversationId, user);
  // MySQL requires an alias on a derived table; SQLite accepts one. The outer
  // sort needs the tie-breaker too, or same-instant messages come out reversed.
  const rows = await database.all<MessageRow>(
    `SELECT * FROM (${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY ${NEWEST_FIRST} LIMIT 300) AS recent
      ORDER BY created_at ASC, seq ASC`,
    [conversationId],
  );
  return rows.map(toView);
}

/** Returns the stored message plus who should be told about it. */
export async function sendMessage(
  userId: string,
  conversationId: string,
  body: unknown,
): Promise<{ message: MessageView; recipientIds: string[] }> {
  const user = await requireUser(userId);
  const conv = await requireConversation(conversationId, user);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new BadRequestError("Message can't be empty.");
  if (text.length > MAX_BODY) throw new BadRequestError(`Messages are limited to ${MAX_BODY} characters.`);
  if (!(await canPost(conv, user))) {
    throw new ForbiddenError("Your permission level can read this project channel but not post in it.");
  }

  const id = crypto.randomUUID();
  const ts = now();
  await database.transaction(async () => {
    await database.run(
      "INSERT INTO messages (id, conversation_id, sender_user_id, sender_company_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?)",
      [id, conv.id, user.id, user.companyId, text, ts],
    );
    await database.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [ts, conv.id]);
    // Sending implies you've read everything up to your own message.
    await upsertRead(conv.id, user.id, ts);
  });

  const message = toView((await database.get<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ?`, [id]))!);
  const recipientIds = (
    await database.all<{ user_id: string }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", [
      conv.id,
    ])
  ).map((r) => r.user_id);
  return { message, recipientIds };
}

/** A "Gina added Sam" line in the thread (the original's system_participant_added). */
async function postSystemMessage(
  conversationId: string,
  actor: User,
  text: string,
): Promise<{ message: MessageView; recipientIds: string[] }> {
  const id = crypto.randomUUID();
  const ts = now();
  await database.transaction(async () => {
    await database.run(
      "INSERT INTO messages (id, conversation_id, sender_user_id, sender_company_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, 'system', ?)",
      [id, conversationId, actor.id, actor.companyId, text, ts],
    );
    await database.run("UPDATE conversations SET last_message_at = ? WHERE id = ?", [ts, conversationId]);
  });
  const message = toView((await database.get<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ?`, [id]))!);
  const recipientIds = (
    await database.all<{ user_id: string }>("SELECT user_id FROM conversation_participants WHERE conversation_id = ?", [
      conversationId,
    ])
  ).map((r) => r.user_id);
  return { message, recipientIds };
}

const displayName = (u: User) => u.fullName || u.email;

/** Group members must be people you could DM: your company or a shared project. */
async function requireContacts(user: User, userIds: string[]): Promise<User[]> {
  const allowed = new Set((await listContacts(user.id)).map((c) => c.userId));
  return Promise.all(
    userIds.map(async (id) => {
      const other = await findUserById(id);
      if (!other || (!user.isAdmin && !allowed.has(id))) {
        throw new ForbiddenError("You can only add people in your company or on a shared project.");
      }
      return other;
    }),
  );
}

/** create_group_conversation: a titled chat with you plus the people you pick. */
export async function createGroup(
  userId: string,
  title: unknown,
  userIds: unknown,
): Promise<{ conversationId: string; message: MessageView; recipientIds: string[] }> {
  const user = await requireUser(userId);
  const name = typeof title === "string" ? title.trim() : "";
  if (!name) throw new BadRequestError("Give the group a name.");
  if (name.length > 80) throw new BadRequestError("Group names are limited to 80 characters.");
  const ids = Array.isArray(userIds) ? [...new Set(userIds.filter((id): id is string => typeof id === "string" && id !== user.id))] : [];
  if (ids.length === 0) throw new BadRequestError("Pick at least one person to add.");
  const members = await requireContacts(user, ids);

  const id = crypto.randomUUID();
  const ts = now();
  await database.transaction(async () => {
    await database.run(
      "INSERT INTO conversations (id, type, title, created_by, created_at, last_message_at) VALUES (?, 'group', ?, ?, ?, ?)",
      [id, name, user.id, ts, ts],
    );
    const insert = "INSERT INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)";
    await database.run(insert, [id, user.id, user.companyId, ts]);
    for (const m of members) await database.run(insert, [id, m.id, m.companyId, ts]);
  });
  const announced = await postSystemMessage(id, user, `${displayName(user)} created the group "${name}"`);
  return { conversationId: id, ...announced };
}

export async function listParticipants(userId: string, conversationId: string): Promise<Contact[]> {
  const user = await requireUser(userId);
  await requireConversation(conversationId, user);
  const rows = await database.all<{ id: string; full_name: string; email: string; company: string | null }>(
    `SELECT u.id, u.full_name, u.email, co.name AS company FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id LEFT JOIN companies co ON co.id = u.company_id
      WHERE cp.conversation_id = ? ORDER BY u.full_name`,
    [conversationId],
  );
  return rows.map((r) => ({ userId: r.id, fullName: r.full_name, email: r.email, companyName: r.company }));
}

/** GroupAddParticipantModal: any member can add one of their contacts to a group. */
export async function addGroupParticipant(
  userId: string,
  conversationId: string,
  targetUserId: unknown,
): Promise<{ message: MessageView; recipientIds: string[] }> {
  const user = await requireUser(userId);
  const conv = await requireConversation(conversationId, user);
  if (conv.type !== "group") throw new BadRequestError("People can only be added to group chats.");
  if (typeof targetUserId !== "string" || !targetUserId) throw new BadRequestError("userId is required.");
  if (await isParticipant(conv.id, targetUserId)) throw new BadRequestError("They're already in this group.");
  const [target] = await requireContacts(user, [targetUserId]);
  await database.run(
    "INSERT INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)",
    [conv.id, target.id, target.companyId, now()],
  );
  return postSystemMessage(conv.id, user, `${displayName(user)} added ${displayName(target)}`);
}

export async function markRead(userId: string, conversationId: string): Promise<void> {
  const user = await requireUser(userId);
  await requireConversation(conversationId, user);
  await upsertRead(conversationId, user.id, now());
}

export interface Contact {
  userId: string;
  fullName: string;
  email: string;
  companyName: string | null;
}

/** People you work with: your own company, plus companies you share a project with. */
export async function listContacts(userId: string): Promise<Contact[]> {
  const user = await requireUser(userId);
  if (!user.companyId) return [];
  const companyIds = new Set<string>([user.companyId]);
  for (const project of await visibleProjects(user.companyId)) {
    companyIds.add(project.company_id);
    const subs = await database.all<{ sub_company_id: string }>(
      "SELECT sub_company_id FROM project_connections WHERE project_id = ?",
      [project.id],
    );
    for (const s of subs) companyIds.add(s.sub_company_id);
  }
  const ids = [...companyIds];
  const rows = await database.all<{ id: string; full_name: string; email: string; company: string | null }>(
    `SELECT u.id, u.full_name, u.email, co.name AS company FROM users u
       LEFT JOIN companies co ON co.id = u.company_id
      WHERE u.company_id IN (${ids.map(() => "?").join(", ")}) AND u.id <> ?
      ORDER BY co.name, u.full_name`,
    [...ids, user.id],
  );
  return rows.map((r) => ({ userId: r.id, fullName: r.full_name, email: r.email, companyName: r.company }));
}

/** get_or_create_dm_conversation, limited to people you actually work with. */
export async function getOrCreateDm(userId: string, otherUserId: unknown): Promise<string> {
  const user = await requireUser(userId);
  if (typeof otherUserId !== "string" || !otherUserId) throw new BadRequestError("userId is required.");
  if (otherUserId === user.id) throw new BadRequestError("You can't message yourself.");
  const other = await findUserById(otherUserId);
  if (!other || (!user.isAdmin && !(await listContacts(user.id)).some((c) => c.userId === other.id))) {
    throw new ForbiddenError("You can only message people in your company or on a shared project.");
  }

  const existing = await database.get<{ id: string }>(
    `SELECT c.id FROM conversations c
      WHERE c.type = 'dm'
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = @me)
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = @other)
        AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
      LIMIT 1`,
    { me: user.id, other: other.id },
  );
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const ts = now();
  await database.transaction(async () => {
    await database.run(
      "INSERT INTO conversations (id, type, created_by, created_at, last_message_at) VALUES (?, 'dm', ?, ?, ?)",
      [id, user.id, ts, ts],
    );
    const insert = "INSERT INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)";
    await database.run(insert, [id, user.id, user.companyId, ts]);
    await database.run(insert, [id, other.id, other.companyId, ts]);
  });
  return id;
}
