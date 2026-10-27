/**
 * Correspondence: every email, bell (push) notification and automatic chat message the platform sends,
 * rendered from the operator's templates and recorded in `notification_log` (Lovable's Correspondence →
 * Log tab). A message that couldn't go out is recorded too, with why, so the operator can see that email
 * isn't set up or that a template is switched off.
 */
import crypto from "node:crypto";
import { database } from "../db.js";
import { emailTransportName, sendEmail, styledHtml } from "../services/email.js";
import { fillPlaceholders, findTemplate } from "./templates.js";

export type Channel = "email" | "push" | "chat";
/** sent; failed (the provider refused it); skipped (no email set up); off (template switched off). */
export type DeliveryStatus = "sent" | "failed" | "skipped" | "off";

export async function ensureCorrespondenceTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient_user_id TEXT,
      recipient_email TEXT,
      recipient_company_id TEXT,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      actor_user_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);
  `);
}

export interface LogEntry {
  eventType: string;
  channel: Channel;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientCompanyId?: string | null;
  subject?: string | null;
  body?: string | null;
  status: DeliveryStatus;
  errorMessage?: string | null;
  actorUserId?: string | null;
}

/** Never throws: a log failure must not undo the thing being logged. */
export async function logCorrespondence(entry: LogEntry): Promise<void> {
  try {
    await database.run(
      `INSERT INTO notification_log (id, event_type, channel, recipient_user_id, recipient_email, recipient_company_id, subject, body, status, error_message, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        entry.eventType,
        entry.channel,
        entry.recipientUserId ?? null,
        entry.recipientEmail ?? null,
        entry.recipientCompanyId ?? null,
        entry.subject?.slice(0, 300) ?? null,
        entry.body?.slice(0, 2000) ?? null,
        entry.status,
        entry.errorMessage ?? null,
        entry.actorUserId ?? null,
        new Date().toISOString(),
      ],
    );
  } catch (err) {
    console.error(`Couldn't record "${entry.eventType}" in the correspondence log:`, err);
  }
}

type Vars = Record<string, string | number | null | undefined>;

/** The push (bell / chat) text for an event, from its template; `fallback` when it has none. */
export async function renderPush(eventType: string, vars: Vars, fallback: { title: string; body: string }) {
  const t = await findTemplate(eventType);
  if (!t || t.pushTitle == null) return { ...fallback, active: true };
  return {
    title: fillPlaceholders(t.pushTitle, vars).trim() || fallback.title,
    body: fillPlaceholders(t.pushBody ?? "", vars).replace(/\s+/g, " ").trim() || fallback.body,
    active: t.pushActive,
  };
}

export async function renderEmail(eventType: string, vars: Vars) {
  const t = await findTemplate(eventType);
  if (!t) return undefined;
  return { subject: fillPlaceholders(t.subject, vars), html: fillPlaceholders(t.bodyHtml, vars, true), active: t.isActive };
}

const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Sends one templated email and records it. Returns the status, so callers that need to know (password
 * reset, the Weekly view's "email isn't set up" note) can say so.
 */
export async function sendTemplatedEmail(params: {
  eventType: string;
  to: string;
  vars: Vars;
  recipientUserId?: string | null;
  recipientCompanyId?: string | null;
  actorUserId?: string | null;
  /** Used only if the template row is missing (it is seeded at startup, so normally never). */
  fallback?: { subject: string; text: string };
}): Promise<DeliveryStatus> {
  const rendered = await renderEmail(params.eventType, params.vars);
  const subject = rendered?.subject ?? params.fallback?.subject ?? params.eventType;
  const html = rendered ? styledHtml(rendered.html) : styledHtml(escapeText(params.fallback?.text ?? ""));
  const text = `${htmlToText(rendered?.html ?? params.fallback?.text ?? "")}\n\n— The SSAA Team`;
  const base = {
    eventType: params.eventType,
    channel: "email" as const,
    recipientUserId: params.recipientUserId,
    recipientEmail: params.to,
    recipientCompanyId: params.recipientCompanyId,
    subject,
    body: htmlToText(rendered?.html ?? params.fallback?.text ?? ""),
    actorUserId: params.actorUserId,
  };
  if (rendered && !rendered.active) {
    await logCorrespondence({ ...base, status: "off", errorMessage: "Template is switched off." });
    return "off";
  }
  if (emailTransportName() === "none") {
    await logCorrespondence({ ...base, status: "skipped", errorMessage: "Email isn't set up on this server." });
    return "skipped";
  }
  const result = await sendEmail({ to: params.to, subject, html, text });
  await logCorrespondence({ ...base, status: result.ok ? "sent" : "failed", errorMessage: result.error ?? null });
  return result.ok ? "sent" : "failed";
}

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");

export interface LogRow {
  id: string;
  eventType: string;
  channel: Channel;
  recipientUserId: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  recipientCompanyId: string | null;
  subject: string | null;
  body: string | null;
  status: DeliveryStatus;
  errorMessage: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export async function listCorrespondence(filter: {
  channel?: string;
  status?: string;
  q?: string;
  userId?: string;
  companyId?: string;
  limit?: number;
}): Promise<LogRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.channel) {
    where.push("l.channel = ?");
    values.push(filter.channel);
  }
  if (filter.status) {
    where.push("l.status = ?");
    values.push(filter.status);
  }
  if (filter.userId) {
    where.push("(l.recipient_user_id = ? OR l.actor_user_id = ?)");
    values.push(filter.userId, filter.userId);
  }
  if (filter.companyId) {
    where.push("(l.recipient_company_id = ? OR u.company_id = ?)");
    values.push(filter.companyId, filter.companyId);
  }
  if (filter.q) {
    const like = `%${filter.q.toLowerCase()}%`;
    where.push("(LOWER(COALESCE(l.recipient_email, '')) LIKE ? OR LOWER(COALESCE(u.full_name, '')) LIKE ? OR LOWER(COALESCE(l.subject, '')) LIKE ? OR LOWER(l.event_type) LIKE ?)");
    values.push(like, like, like, like);
  }
  const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 500);
  const rows = await database.all<{
    id: string;
    event_type: string;
    channel: Channel;
    recipient_user_id: string | null;
    recipient_email: string | null;
    full_name: string | null;
    user_email: string | null;
    recipient_company_id: string | null;
    subject: string | null;
    body: string | null;
    status: DeliveryStatus;
    error_message: string | null;
    actor_user_id: string | null;
    created_at: string;
  }>(
    `SELECT l.*, u.full_name, u.email AS user_email FROM notification_log l
       LEFT JOIN users u ON u.id = l.recipient_user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY l.created_at DESC LIMIT ${limit}`,
    values,
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    channel: r.channel,
    recipientUserId: r.recipient_user_id,
    recipientEmail: r.recipient_email ?? r.user_email,
    recipientName: r.full_name,
    recipientCompanyId: r.recipient_company_id,
    subject: r.subject,
    body: r.body,
    status: r.status,
    errorMessage: r.error_message,
    actorUserId: r.actor_user_id,
    createdAt: r.created_at,
  }));
}
