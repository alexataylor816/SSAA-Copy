/**
 * Messaging, ported from the Lovable app's conversations/messages schema
 * (supabase/migrations/20260606185901, per-sub channels from 20260729235649).
 * A project has one private channel per connected sub (the GC's company + that
 * sub), plus 1:1 DMs. Group chats, contacts, the user directory and
 * attachments are not ported yet.
 */
import crypto from "node:crypto";
import { db } from "../db.js";
import { findUserById, type User } from "../models/users.js";
import { findUserRole } from "../rbac/models.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../rbac/errors.js";

const MAX_BODY = 4000;

export function ensureMessagingTables() {
  // A first cut had one shared channel per project. It was never released and
  // holds no data, but a dev database may still have that shape.
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "sub_company_id")) {
    db.exec(`
      DROP TABLE IF EXISTS message_reads;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversation_participants;
      DROP TABLE IF EXISTS conversations;
    `);
  }

  db.exec(`
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

function requireUser(userId: string): User {
  const user = findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

function visibleProjects(companyId: string): { id: string; name: string; company_id: string }[] {
  return db
    .prepare(
      `SELECT id, name, company_id FROM projects WHERE company_id = @c
       UNION
       SELECT p.id, p.name, p.company_id FROM projects p
         JOIN project_connections pc ON pc.project_id = p.id
        WHERE pc.sub_company_id = @c`,
    )
    .all({ c: companyId }) as { id: string; name: string; company_id: string }[];
}

/**
 * get_or_create_project_sub_conversation + its participant sync: the channel
 * holds everyone at the owning company plus everyone at this one sub, and
 * drops the sub's people if the sub is no longer connected.
 */
function syncProjectSubConversation(projectId: string, subCompanyId: string, createdBy: string | null): string {
  const project = db.prepare("SELECT name, company_id FROM projects WHERE id = ?").get(projectId) as
    | { name: string; company_id: string }
    | undefined;
  if (!project) throw new NotFoundError("Project not found.");

  let conv = db
    .prepare("SELECT id FROM conversations WHERE project_id = ? AND sub_company_id = ?")
    .get(projectId, subCompanyId) as { id: string } | undefined;
  if (!conv) {
    const id = crypto.randomUUID();
    const ts = now();
    db.prepare(
      `INSERT INTO conversations (id, type, project_id, sub_company_id, title, created_by, created_at, last_message_at)
       VALUES (?, 'project', ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, subCompanyId, project.name, createdBy, ts, ts);
    conv = { id };
  }

  const stillConnected = !!db
    .prepare("SELECT 1 FROM project_connections WHERE project_id = ? AND sub_company_id = ?")
    .get(projectId, subCompanyId);
  const companies = stillConnected ? [project.company_id, subCompanyId] : [project.company_id];
  const eligible = db
    .prepare(`SELECT id, company_id FROM users WHERE company_id IN (${companies.map(() => "?").join(", ")})`)
    .all(...companies) as { id: string; company_id: string }[];

  const ts = now();
  const convId = conv.id;
  db.transaction(() => {
    const keep = new Set(eligible.map((u) => u.id));
    const current = db
      .prepare("SELECT user_id FROM conversation_participants WHERE conversation_id = ?")
      .all(convId) as { user_id: string }[];
    const remove = db.prepare("DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?");
    for (const row of current) if (!keep.has(row.user_id)) remove.run(convId, row.user_id);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)",
    );
    for (const u of eligible) insert.run(convId, u.id, u.company_id, ts);
  })();
  return convId;
}

/** One channel per sub on projects this company owns; its own channel on projects it joined. */
function syncChannelsFor(user: User) {
  if (!user.companyId) return;
  for (const project of visibleProjects(user.companyId)) {
    if (project.company_id === user.companyId) {
      const subs = db.prepare("SELECT sub_company_id FROM project_connections WHERE project_id = ?").all(project.id) as {
        sub_company_id: string;
      }[];
      for (const sub of subs) syncProjectSubConversation(project.id, sub.sub_company_id, user.id);
    } else {
      syncProjectSubConversation(project.id, user.companyId, user.id);
    }
  }
}

function isParticipant(conversationId: string, userId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?")
    .get(conversationId, userId);
}

function requireConversation(conversationId: string, user: User): ConversationRow {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as
    | ConversationRow
    | undefined;
  if (!conv) throw new NotFoundError("Conversation not found.");
  if (conv.type === "project" && conv.project_id && conv.sub_company_id) {
    syncProjectSubConversation(conv.project_id, conv.sub_company_id, null);
  }
  if (!isParticipant(conv.id, user.id)) throw new NotFoundError("Conversation not found.");
  return conv;
}

/** can_post_in_project_conversation: subs below partial read the channel but can't post. */
function canPost(conv: ConversationRow, user: User): boolean {
  if (user.isAdmin || conv.type !== "project" || !user.companyId) return true;
  const company = db.prepare("SELECT company_type FROM companies WHERE id = ?").get(user.companyId) as
    | { company_type: string }
    | undefined;
  if (company?.company_type !== "sub") return true;
  const level = findUserRole(user.id, user.companyId)?.permissionLevel;
  return level !== "basic" && level !== "level_1";
}

export function listConversations(userId: string): ConversationSummary[] {
  const user = requireUser(userId);
  syncChannelsFor(user);

  const rows = db
    .prepare(
      `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON cp.conversation_id = c.id
        WHERE cp.user_id = ?
        ORDER BY c.last_message_at DESC`,
    )
    .all(user.id) as ConversationRow[];

  return rows.map((conv) => {
    let title = conv.title ?? "Conversation";
    let subtitle: string | null = null;
    if (conv.type === "project" && conv.project_id) {
      const project = db
        .prepare(
          `SELECT p.name, p.company_id, gc.name AS gc_name, sub.name AS sub_name FROM projects p
             JOIN companies gc ON gc.id = p.company_id
             LEFT JOIN companies sub ON sub.id = ?
            WHERE p.id = ?`,
        )
        .get(conv.sub_company_id, conv.project_id) as
        | { name: string; company_id: string; gc_name: string; sub_name: string | null }
        | undefined;
      title = project?.name ?? title;
      // Name whoever is on the other side of this channel.
      subtitle = (project?.company_id === user.companyId ? project?.sub_name : project?.gc_name) ?? null;
    } else if (conv.type === "dm") {
      const other = db
        .prepare(
          `SELECT u.full_name, u.email, co.name AS company FROM conversation_participants cp
             JOIN users u ON u.id = cp.user_id
             LEFT JOIN companies co ON co.id = u.company_id
            WHERE cp.conversation_id = ? AND cp.user_id <> ?`,
        )
        .get(conv.id, user.id) as { full_name: string; email: string; company: string | null } | undefined;
      title = other?.full_name || other?.email || "Direct message";
      subtitle = other?.company ?? null;
    }

    const last = db
      .prepare(
        `SELECT m.body, m.created_at, u.full_name FROM messages m LEFT JOIN users u ON u.id = m.sender_user_id
          WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`,
      )
      .get(conv.id) as { body: string; created_at: string; full_name: string | null } | undefined;

    const readAt =
      (
        db.prepare("SELECT last_read_at FROM message_reads WHERE conversation_id = ? AND user_id = ?").get(conv.id, user.id) as
          | { last_read_at: string }
          | undefined
      )?.last_read_at ?? "";
    const unread = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM messages
            WHERE conversation_id = ? AND created_at > ? AND (sender_user_id IS NULL OR sender_user_id <> ?)`,
        )
        .get(conv.id, readAt, user.id) as { n: number }
    ).n;

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
      canPost: canPost(conv, user),
    };
  });
}

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.sender_user_id, m.body, m.kind, m.created_at,
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

export function listMessages(userId: string, conversationId: string): MessageView[] {
  const user = requireUser(userId);
  requireConversation(conversationId, user);
  const rows = db
    .prepare(
      `SELECT * FROM (${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.rowid DESC LIMIT 300)
        ORDER BY created_at ASC`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(toView);
}

/** Returns the stored message plus who should be told about it. */
export function sendMessage(
  userId: string,
  conversationId: string,
  body: unknown,
): { message: MessageView; recipientIds: string[] } {
  const user = requireUser(userId);
  const conv = requireConversation(conversationId, user);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new BadRequestError("Message can't be empty.");
  if (text.length > MAX_BODY) throw new BadRequestError(`Messages are limited to ${MAX_BODY} characters.`);
  if (!canPost(conv, user)) {
    throw new ForbiddenError("Your permission level can read this project channel but not post in it.");
  }

  const id = crypto.randomUUID();
  const ts = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_user_id, sender_company_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?)",
    ).run(id, conv.id, user.id, user.companyId, text, ts);
    db.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").run(ts, conv.id);
    // Sending implies you've read everything up to your own message.
    db.prepare(
      `INSERT INTO message_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    ).run(conv.id, user.id, ts);
  })();

  const message = toView(db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) as MessageRow);
  const recipientIds = (
    db.prepare("SELECT user_id FROM conversation_participants WHERE conversation_id = ?").all(conv.id) as {
      user_id: string;
    }[]
  ).map((r) => r.user_id);
  return { message, recipientIds };
}

export function markRead(userId: string, conversationId: string): void {
  const user = requireUser(userId);
  requireConversation(conversationId, user);
  db.prepare(
    `INSERT INTO message_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
  ).run(conversationId, user.id, now());
}

export interface Contact {
  userId: string;
  fullName: string;
  email: string;
  companyName: string | null;
}

/** People you work with: your own company, plus companies you share a project with. */
export function listContacts(userId: string): Contact[] {
  const user = requireUser(userId);
  if (!user.companyId) return [];
  const companyIds = new Set<string>([user.companyId]);
  for (const project of visibleProjects(user.companyId)) {
    companyIds.add(project.company_id);
    const subs = db.prepare("SELECT sub_company_id FROM project_connections WHERE project_id = ?").all(project.id) as {
      sub_company_id: string;
    }[];
    for (const s of subs) companyIds.add(s.sub_company_id);
  }
  const ids = [...companyIds];
  const rows = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, co.name AS company FROM users u
         LEFT JOIN companies co ON co.id = u.company_id
        WHERE u.company_id IN (${ids.map(() => "?").join(", ")}) AND u.id <> ?
        ORDER BY co.name, u.full_name`,
    )
    .all(...ids, user.id) as { id: string; full_name: string; email: string; company: string | null }[];
  return rows.map((r) => ({ userId: r.id, fullName: r.full_name, email: r.email, companyName: r.company }));
}

/** get_or_create_dm_conversation, limited to people you actually work with. */
export function getOrCreateDm(userId: string, otherUserId: unknown): string {
  const user = requireUser(userId);
  if (typeof otherUserId !== "string" || !otherUserId) throw new BadRequestError("userId is required.");
  if (otherUserId === user.id) throw new BadRequestError("You can't message yourself.");
  const other = findUserById(otherUserId);
  if (!other || (!user.isAdmin && !listContacts(user.id).some((c) => c.userId === other.id))) {
    throw new ForbiddenError("You can only message people in your company or on a shared project.");
  }

  const existing = db
    .prepare(
      `SELECT c.id FROM conversations c
        WHERE c.type = 'dm'
          AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = @me)
          AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = @other)
          AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
        LIMIT 1`,
    )
    .get({ me: user.id, other: other.id }) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const ts = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO conversations (id, type, created_by, created_at, last_message_at) VALUES (?, 'dm', ?, ?, ?)",
    ).run(id, user.id, ts, ts);
    const insert = db.prepare(
      "INSERT INTO conversation_participants (conversation_id, user_id, company_id, joined_at) VALUES (?, ?, ?, ?)",
    );
    insert.run(id, user.id, user.companyId, ts);
    insert.run(id, other.id, other.companyId, ts);
  })();
  return id;
}
