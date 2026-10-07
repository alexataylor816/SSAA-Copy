import crypto from "node:crypto";
import { db } from "../db.js";
import { BadRequestError } from "../rbac/errors.js";

/**
 * Notification templates, ported from the Lovable `notification_templates`
 * table (compose-only in this phase: CRUD + preview, no send path yet).
 * Templates are platform-global and keyed by event type; only admins may
 * change them, any signed-in user may read them.
 */

export interface NotificationTemplate {
  id: string;
  eventType: string;
  channel: string;
  subject: string;
  bodyHtml: string;
  description: string | null;
  isActive: boolean;
  placeholderVariables: string[];
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  event_type: string;
  channel: string;
  subject: string;
  body_html: string;
  description: string | null;
  is_active: number;
  placeholder_variables: string;
  created_at: string;
  updated_at: string;
}

const SEEDS: { eventType: string; channel: string; subject: string; bodyHtml: string; description: string; vars: string[] }[] = [
  {
    eventType: "schedule_created",
    channel: "email",
    subject: "New schedule request for {{date}}",
    bodyHtml: "<p>{{gc_name}} requested {{crew}} for {{day}} on {{project_name}}.</p>",
    description: "Sent when a GC requests crew from a sub.",
    vars: ["gc_name", "crew", "day", "project_name", "date"],
  },
  {
    eventType: "schedule_confirmed",
    channel: "email",
    subject: "Request confirmed for {{date}}",
    bodyHtml: "<p>{{sub_name}} confirmed {{day}} on {{project_name}}.</p>",
    description: "Sent when a sub confirms a request.",
    vars: ["sub_name", "day", "project_name", "date"],
  },
  {
    eventType: "schedule_rejected",
    channel: "email",
    subject: "Request declined for {{date}}",
    bodyHtml: "<p>{{sub_name}} declined {{day}} on {{project_name}}.</p>",
    description: "Sent when a sub declines a request.",
    vars: ["sub_name", "day", "project_name", "date"],
  },
  {
    eventType: "schedule_cancelled",
    channel: "email",
    subject: "Request cancelled for {{date}}",
    bodyHtml: "<p>A request for {{day}} on {{project_name}} was cancelled.</p>",
    description: "Sent when either side cancels.",
    vars: ["day", "project_name", "date"],
  },
  {
    eventType: "join_request",
    channel: "email",
    subject: "New join request",
    bodyHtml: "<p>{{user_name}} asked to join {{company_name}}.</p>",
    description: "Sent to approvers on a new join request.",
    vars: ["user_name", "company_name"],
  },
  {
    eventType: "join_approved",
    channel: "email",
    subject: "You're in",
    bodyHtml: "<p>{{company_name}} approved your request. You can start scheduling now.</p>",
    description: "Sent to the requester on approval.",
    vars: ["company_name"],
  },
  {
    eventType: "join_rejected",
    channel: "email",
    subject: "Join request declined",
    bodyHtml: "<p>{{company_name}} declined your request to join.</p>",
    description: "Sent to the requester on rejection.",
    vars: ["company_name"],
  },
];

export function ensureTemplateTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_templates (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'email',
      subject TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      placeholder_variables TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notification_templates
     (id, event_type, channel, subject, body_html, description, is_active, placeholder_variables)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  for (const s of SEEDS) {
    insert.run(crypto.randomUUID(), s.eventType, s.channel, s.subject, s.bodyHtml, s.description, JSON.stringify(s.vars));
  }
}

function mapRow(r: Row): NotificationTemplate {
  return {
    id: r.id,
    eventType: r.event_type,
    channel: r.channel,
    subject: r.subject,
    bodyHtml: r.body_html,
    description: r.description,
    isActive: r.is_active === 1,
    placeholderVariables: JSON.parse(r.placeholder_variables) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTemplates(): NotificationTemplate[] {
  const rows = db.prepare("SELECT * FROM notification_templates ORDER BY event_type").all() as Row[];
  return rows.map(mapRow);
}

export function updateTemplate(
  id: string,
  updates: { subject?: string; bodyHtml?: string; channel?: string; isActive?: boolean },
): NotificationTemplate | undefined {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.subject !== undefined) {
    sets.push("subject = ?");
    values.push(updates.subject);
  }
  if (updates.bodyHtml !== undefined) {
    sets.push("body_html = ?");
    values.push(updates.bodyHtml);
  }
  if (updates.channel !== undefined) {
    if (updates.channel !== "email" && updates.channel !== "sms" && updates.channel !== "bell") {
      throw new BadRequestError("channel must be email, sms, or bell.");
    }
    sets.push("channel = ?");
    values.push(updates.channel);
  }
  if (updates.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(updates.isActive ? 1 : 0);
  }
  if (sets.length === 0) {
    const row = db.prepare("SELECT * FROM notification_templates WHERE id = ?").get(id) as Row | undefined;
    return row ? mapRow(row) : undefined;
  }
  values.push(id);
  db.prepare(`UPDATE notification_templates SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(
    ...values,
  );
  const row = db.prepare("SELECT * FROM notification_templates WHERE id = ?").get(id) as Row | undefined;
  return row ? mapRow(row) : undefined;
}
