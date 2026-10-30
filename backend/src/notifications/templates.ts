import crypto from "node:crypto";
import { database } from "../db.js";
import { BadRequestError } from "../rbac/errors.js";

/**
 * Notification templates, ported from the Lovable `notification_templates` table and its Correspondence
 * screen (Manage SSAA → Correspondence). One row per event: the email (subject + HTML body) and the push
 * version (bell title + text, also used for the chat message to crew). Placeholders are written `{name}`
 * as in Lovable; `{{name}}` still works. Templates are platform-wide; only operators may change them.
 */

export interface NotificationTemplate {
  id: string;
  eventType: string;
  displayName: string | null;
  channel: string;
  subject: string;
  bodyHtml: string;
  description: string | null;
  isActive: boolean;
  /** Null when the event has no push version (password reset, username reminder). */
  pushTitle: string | null;
  pushBody: string | null;
  pushActive: boolean;
  placeholderVariables: string[];
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  event_type: string;
  display_name: string | null;
  channel: string;
  subject: string;
  body_html: string;
  description: string | null;
  is_active: number;
  push_title: string | null;
  push_body: string | null;
  push_active: number | null;
  placeholder_variables: string;
  created_at: string;
  updated_at: string;
}

interface Seed {
  eventType: string;
  displayName: string;
  description: string;
  subject: string;
  bodyHtml: string;
  push?: { title: string; body: string };
  vars: string[];
}

const SCHEDULE_VARS = ["project_name", "project_address", "requesting_company", "sub_company", "scheduled_date", "start_time", "end_time"];

const SEEDS: Seed[] = [
  {
    eventType: "schedule_created",
    displayName: "Schedule Requests",
    description: "Sent to the subcontractor when a GC requests crew for a day.",
    subject: "New Schedule Request: {project_name}",
    bodyHtml:
      "<h2>New Schedule Request</h2><p><strong>{requesting_company}</strong> requested <strong>{crew_count}</strong> for <strong>{project_name}</strong>.</p><p><strong>Date:</strong> {scheduled_date}<br/><strong>Time:</strong> {start_time} – {end_time}<br/><strong>Crew:</strong> {crew_names}</p><p>Open SSAA to confirm or decline.</p>",
    push: { title: "New schedule request", body: "{requesting_company} requested {crew_count} for {scheduled_date} on {project_name}." },
    vars: [...SCHEDULE_VARS, "crew_count", "crew_names"],
  },
  {
    eventType: "schedule_confirmed",
    displayName: "Schedule Confirmed",
    description: "Sent to the GC when the subcontractor confirms a request.",
    subject: "Schedule Confirmed: {project_name}",
    bodyHtml:
      "<h2>Schedule Confirmed</h2><p>The schedule for <strong>{project_name}</strong> on <strong>{scheduled_date}</strong> has been confirmed by <strong>{sub_company}</strong>.</p><p><strong>Time:</strong> {start_time} – {end_time}</p>",
    push: { title: "Request confirmed", body: "{sub_company} confirmed {scheduled_date} on {project_name}." },
    vars: SCHEDULE_VARS,
  },
  {
    eventType: "schedule_rejected",
    displayName: "Schedule Declined",
    description: "Sent to the GC when the subcontractor declines a request.",
    subject: "Schedule Declined: {project_name}",
    bodyHtml:
      "<h2>Schedule Declined</h2><p><strong>{sub_company}</strong> declined <strong>{scheduled_date}</strong> on <strong>{project_name}</strong>.</p><p>{reason}</p>",
    push: { title: "Request declined", body: "{sub_company} declined {scheduled_date} on {project_name}. {reason}" },
    vars: [...SCHEDULE_VARS, "reason"],
  },
  {
    eventType: "schedule_cancelled",
    displayName: "Schedule Cancelled",
    description: "Sent to the other company when either side cancels a request.",
    subject: "Schedule Cancelled: {project_name}",
    bodyHtml:
      "<h2>Schedule Cancelled</h2><p>The schedule for <strong>{project_name}</strong> on <strong>{scheduled_date}</strong> has been cancelled by <strong>{cancelling_company}</strong>.</p><p>{reason}</p>",
    push: { title: "Request cancelled", body: "{cancelling_company} cancelled {scheduled_date} on {project_name}. {reason}" },
    vars: [...SCHEDULE_VARS, "cancelling_company", "reason"],
  },
  {
    eventType: "schedule_edited",
    displayName: "Schedule Edited by Subcontractor",
    description: "Sent to the GC when a subcontractor publishes changes from the Weekly view.",
    subject: "Schedule Updated: {project_names}",
    bodyHtml:
      "<h2>Schedule Updated</h2><p><strong>{company_name}</strong> updated the schedule: {change_count} on <strong>{project_names}</strong> ({dates}).</p><p>Open SSAA to review the changes.</p>",
    push: { title: "Schedule edited", body: "{company_name} updated the schedule: {change_count} on {project_names} ({dates})." },
    vars: ["company_name", "change_count", "project_names", "dates"],
  },
  {
    eventType: "schedule_batch_sent",
    displayName: "Weekly Requests from GC",
    description: "Sent to the subcontractor when a GC sends requests from the Weekly view.",
    subject: "New Schedule Requests: {project_names}",
    bodyHtml:
      "<h2>New Schedule Requests</h2><p><strong>{company_name}</strong> sent schedule requests: {change_count} on <strong>{project_names}</strong> ({dates}).</p><p>Open SSAA to confirm or decline.</p>",
    push: { title: "New schedule requests", body: "{company_name} sent schedule requests: {change_count} on {project_names} ({dates})." },
    vars: ["company_name", "change_count", "project_names", "dates"],
  },
  {
    eventType: "schedule_assigned",
    displayName: "Personnel: You're on the Schedule",
    description: "Sent to each crew member placed on a job. The push version is also sent as a chat message.",
    subject: "You're scheduled at {project_name} on {scheduled_date}",
    bodyHtml:
      "<h2>You're on the schedule</h2><p>Hi {employee_name},</p><p><strong>{company_name}</strong> put you on <strong>{project_name}</strong>{project_address} for <strong>{scheduled_date}</strong>{time_range}.</p>",
    push: { title: "You're on the schedule", body: "Hi {employee_name}, you're scheduled at {project_name}{project_address} on {scheduled_date}{time_range}." },
    vars: ["employee_name", "company_name", "project_name", "project_address", "scheduled_date", "time_range"],
  },
  {
    eventType: "join_request",
    displayName: "Join Request Submitted",
    description: "Sent to the people who approve join requests at a company.",
    subject: "New request to join {company_name}",
    bodyHtml:
      "<h2>New Join Request</h2><p><strong>{requester_name}</strong> ({requester_email}) has requested to join <strong>{company_name}</strong> on SSAA.</p><p>Sign in to approve or decline.</p>",
    push: { title: "New join request", body: "{requester_name} asked to join {company_name}." },
    vars: ["requester_name", "requester_email", "company_name"],
  },
  {
    eventType: "join_approved",
    displayName: "Join Request Approved",
    description: "Sent to the person who asked to join, on approval.",
    subject: "You're in: {company_name}",
    bodyHtml: "<p>Hi {user_name},</p><p><strong>{company_name}</strong> approved your request. You can start scheduling now.</p>",
    push: { title: "You're in", body: "{company_name} approved your request. You can start scheduling now." },
    vars: ["user_name", "company_name"],
  },
  {
    eventType: "join_rejected",
    displayName: "Join Request Declined",
    description: "Sent to the person who asked to join, when declined.",
    subject: "Join request declined",
    bodyHtml: "<p>Hi {user_name},</p><p><strong>{company_name}</strong> declined your request to join.</p>",
    push: { title: "Join request declined", body: "{company_name} declined your request to join." },
    vars: ["user_name", "company_name"],
  },
  {
    eventType: "password_reset",
    displayName: "Password Reset Code",
    description: "Sent when someone asks to reset their password (or an operator sends them a reset). Contains a 6-digit code.",
    subject: "Your Password Reset Code",
    bodyHtml:
      "<p>Hi,</p><p>Your password reset verification code is: <strong style=\"font-size:20px;letter-spacing:2px\">{code}</strong></p><p>This code expires in 15 minutes. If you did not request a password reset, please ignore this email.</p>",
    vars: ["code", "email"],
  },
  {
    eventType: "username_reminder",
    displayName: "Username Reminder",
    description: "Sent from Forgot Username.",
    subject: "Your SSAA Username",
    bodyHtml: "<p>Hi {user_name},</p><p>Your SSAA username (the email you sign in with) is: <strong>{email}</strong></p><p>If you didn't request this, you can ignore this email.</p>",
    vars: ["user_name", "email"],
  },
];

/**
 * Default bodies from before templates drove anything. A row still holding one of these was never edited,
 * so it is safe to replace with the new default; an operator's own text is never touched.
 */
const OLD_DEFAULT_BODIES = new Set([
  "<p>{{gc_name}} requested {{crew}} for {{day}} on {{project_name}}.</p>",
  "<p>{{sub_name}} confirmed {{day}} on {{project_name}}.</p>",
  "<p>{{sub_name}} declined {{day}} on {{project_name}}.</p>",
  "<p>A request for {{day}} on {{project_name}} was cancelled.</p>",
  "<p>{{user_name}} asked to join {{company_name}}.</p>",
  "<p>{{company_name}} approved your request. You can start scheduling now.</p>",
  "<p>{{company_name}} declined your request to join.</p>",
]);

export async function ensureTemplateTables(): Promise<void> {
  await database.exec(`
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
  const columns = new Set((await database.all<{ name: string }>("PRAGMA table_info(notification_templates)")).map((c) => c.name));
  if (!columns.has("display_name")) await database.exec("ALTER TABLE notification_templates ADD COLUMN display_name TEXT");
  if (!columns.has("push_title")) await database.exec("ALTER TABLE notification_templates ADD COLUMN push_title TEXT");
  if (!columns.has("push_body")) await database.exec("ALTER TABLE notification_templates ADD COLUMN push_body TEXT");
  if (!columns.has("push_active")) await database.exec("ALTER TABLE notification_templates ADD COLUMN push_active INTEGER NOT NULL DEFAULT 1");
  await seedNotificationTemplates();
}

/**
 * Inserts any default template that isn't there yet and fills in what older rows lack (push text, names),
 * never overwriting an operator's edits. Runs on both databases: MySQL creates the table from schema.sql
 * but still needs these rows.
 */
export async function seedNotificationTemplates(): Promise<void> {
  const insertIgnore = database.dialect === "mysql" ? "INSERT IGNORE" : "INSERT OR IGNORE";
  for (const s of SEEDS) {
    await database.run(
      `${insertIgnore} INTO notification_templates
       (id, event_type, display_name, channel, subject, body_html, description, is_active, push_title, push_body, push_active, placeholder_variables)
       VALUES (?, ?, ?, 'email', ?, ?, ?, 1, ?, ?, 1, ?)`,
      [crypto.randomUUID(), s.eventType, s.displayName, s.subject, s.bodyHtml, s.description, s.push?.title ?? null, s.push?.body ?? null, JSON.stringify(s.vars)],
    );
    const row = await database.get<Row>("SELECT * FROM notification_templates WHERE event_type = ?", [s.eventType]);
    if (!row) continue;
    if (OLD_DEFAULT_BODIES.has(row.body_html)) {
      await database.run(
        "UPDATE notification_templates SET subject = ?, body_html = ?, description = ?, placeholder_variables = ? WHERE id = ?",
        [s.subject, s.bodyHtml, s.description, JSON.stringify(s.vars), row.id],
      );
    }
    if (row.display_name == null) await database.run("UPDATE notification_templates SET display_name = ? WHERE id = ?", [s.displayName, row.id]);
    if (row.push_title == null && s.push) {
      await database.run("UPDATE notification_templates SET push_title = ?, push_body = ? WHERE id = ?", [s.push.title, s.push.body, row.id]);
    }
  }
}

function mapRow(r: Row): NotificationTemplate {
  return {
    id: r.id,
    eventType: r.event_type,
    displayName: r.display_name,
    channel: r.channel,
    subject: r.subject,
    bodyHtml: r.body_html,
    description: r.description,
    isActive: Number(r.is_active) === 1,
    pushTitle: r.push_title,
    pushBody: r.push_body,
    pushActive: r.push_active == null ? true : Number(r.push_active) === 1,
    placeholderVariables: JSON.parse(r.placeholder_variables) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTemplates(): Promise<NotificationTemplate[]> {
  const rows = await database.all<Row>("SELECT * FROM notification_templates ORDER BY event_type");
  return rows.map(mapRow);
}

export async function findTemplate(eventType: string): Promise<NotificationTemplate | undefined> {
  const row = await database.get<Row>("SELECT * FROM notification_templates WHERE event_type = ?", [eventType]);
  return row ? mapRow(row) : undefined;
}

export async function findTemplateById(id: string): Promise<NotificationTemplate | undefined> {
  const row = await database.get<Row>("SELECT * FROM notification_templates WHERE id = ?", [id]);
  return row ? mapRow(row) : undefined;
}

export interface TemplateUpdate {
  displayName?: string | null;
  description?: string | null;
  subject?: string;
  bodyHtml?: string;
  channel?: string;
  isActive?: boolean;
  pushTitle?: string;
  pushBody?: string;
  pushActive?: boolean;
}

export async function updateTemplate(id: string, updates: TemplateUpdate): Promise<NotificationTemplate | undefined> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const text = (column: string, value: unknown, max: number, nullable = false) => {
    if (value === undefined) return;
    if (value === null && nullable) {
      sets.push(`${column} = ?`);
      values.push(null);
      return;
    }
    if (typeof value !== "string") throw new BadRequestError(`${column} must be text.`);
    if (value.length > max) throw new BadRequestError(`${column} is too long.`);
    sets.push(`${column} = ?`);
    values.push(nullable ? value.trim() || null : value);
  };
  text("display_name", updates.displayName, 120, true);
  text("description", updates.description, 1000, true);
  text("subject", updates.subject, 300);
  text("body_html", updates.bodyHtml, 50_000);
  text("push_title", updates.pushTitle, 120);
  text("push_body", updates.pushBody, 1600);
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
  if (updates.pushActive !== undefined) {
    sets.push("push_active = ?");
    values.push(updates.pushActive ? 1 : 0);
  }
  if (sets.length > 0) {
    values.push(database.now(), id);
    await database.run(`UPDATE notification_templates SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, values);
  }
  return findTemplateById(id);
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Fills `{name}` / `{{name}}` placeholders. Values are escaped in HTML; a placeholder with no value
 * becomes empty rather than showing its braces to a customer.
 */
export function fillPlaceholders(text: string, vars: Record<string, string | number | null | undefined>, html = false): string {
  return text.replace(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi, (_m, name: string) => {
    const value = vars[name];
    if (value == null) return "";
    return html ? escapeHtml(String(value)) : String(value);
  });
}

/**
 * Spanish versions of the default templates, used when the recipient's language is Spanish. The on/off
 * switches still come from the operator's template rows. (The Correspondence screen edits the English
 * text only for now; these are the Spanish wording until it gets a Spanish tab.)
 */
export const SPANISH_TEMPLATES: Record<string, { subject: string; bodyHtml: string; push?: { title: string; body: string } }> = {
  schedule_created: {
    subject: "Nueva solicitud de programación: {project_name}",
    bodyHtml:
      "<h2>Nueva solicitud de programación</h2><p><strong>{requesting_company}</strong> solicitó <strong>{crew_count}</strong> para <strong>{project_name}</strong>.</p><p><strong>Fecha:</strong> {scheduled_date}<br/><strong>Horario:</strong> {start_time} – {end_time}<br/><strong>Cuadrilla:</strong> {crew_names}</p><p>Abra SSAA para confirmar o rechazar.</p>",
    push: { title: "Nueva solicitud de programación", body: "{requesting_company} solicitó {crew_count} para el {scheduled_date} en {project_name}." },
  },
  schedule_confirmed: {
    subject: "Programa confirmado: {project_name}",
    bodyHtml:
      "<h2>Programa confirmado</h2><p><strong>{sub_company}</strong> confirmó el programa de <strong>{project_name}</strong> para el <strong>{scheduled_date}</strong>.</p><p><strong>Horario:</strong> {start_time} – {end_time}</p>",
    push: { title: "Solicitud confirmada", body: "{sub_company} confirmó el {scheduled_date} en {project_name}." },
  },
  schedule_rejected: {
    subject: "Programa rechazado: {project_name}",
    bodyHtml: "<h2>Programa rechazado</h2><p><strong>{sub_company}</strong> rechazó el <strong>{scheduled_date}</strong> en <strong>{project_name}</strong>.</p><p>{reason}</p>",
    push: { title: "Solicitud rechazada", body: "{sub_company} rechazó el {scheduled_date} en {project_name}. {reason}" },
  },
  schedule_cancelled: {
    subject: "Programa cancelado: {project_name}",
    bodyHtml:
      "<h2>Programa cancelado</h2><p><strong>{cancelling_company}</strong> canceló el programa de <strong>{project_name}</strong> para el <strong>{scheduled_date}</strong>.</p><p>{reason}</p>",
    push: { title: "Solicitud cancelada", body: "{cancelling_company} canceló el {scheduled_date} en {project_name}. {reason}" },
  },
  schedule_edited: {
    subject: "Programa actualizado: {project_names}",
    bodyHtml:
      "<h2>Programa actualizado</h2><p><strong>{company_name}</strong> actualizó el programa: {change_count} en <strong>{project_names}</strong> ({dates}).</p><p>Abra SSAA para revisar los cambios.</p>",
    push: { title: "Programa modificado", body: "{company_name} actualizó el programa: {change_count} en {project_names} ({dates})." },
  },
  schedule_batch_sent: {
    subject: "Nuevas solicitudes de programación: {project_names}",
    bodyHtml:
      "<h2>Nuevas solicitudes de programación</h2><p><strong>{company_name}</strong> envió solicitudes de programación: {change_count} en <strong>{project_names}</strong> ({dates}).</p><p>Abra SSAA para confirmar o rechazar.</p>",
    push: { title: "Nuevas solicitudes de programación", body: "{company_name} envió solicitudes de programación: {change_count} en {project_names} ({dates})." },
  },
  schedule_assigned: {
    subject: "Está programado en {project_name} el {scheduled_date}",
    bodyHtml:
      "<h2>Ya está en el programa</h2><p>Hola, {employee_name}:</p><p><strong>{company_name}</strong> lo programó en <strong>{project_name}</strong>{project_address} para el <strong>{scheduled_date}</strong>{time_range}.</p>",
    push: { title: "Ya está en el programa", body: "Hola, {employee_name}: está programado en {project_name}{project_address} el {scheduled_date}{time_range}." },
  },
  join_request: {
    subject: "Nueva solicitud para unirse a {company_name}",
    bodyHtml:
      "<h2>Nueva solicitud de ingreso</h2><p><strong>{requester_name}</strong> ({requester_email}) pidió unirse a <strong>{company_name}</strong> en SSAA.</p><p>Inicie sesión para aprobar o rechazar la solicitud.</p>",
    push: { title: "Nueva solicitud de ingreso", body: "{requester_name} pidió unirse a {company_name}." },
  },
  join_approved: {
    subject: "Ya forma parte de {company_name}",
    bodyHtml: "<p>Hola, {user_name}:</p><p><strong>{company_name}</strong> aprobó su solicitud. Ya puede empezar a programar.</p>",
    push: { title: "Ya forma parte del equipo", body: "{company_name} aprobó su solicitud. Ya puede empezar a programar." },
  },
  join_rejected: {
    subject: "Solicitud de ingreso rechazada",
    bodyHtml: "<p>Hola, {user_name}:</p><p><strong>{company_name}</strong> rechazó su solicitud para unirse.</p>",
    push: { title: "Solicitud de ingreso rechazada", body: "{company_name} rechazó su solicitud para unirse." },
  },
  password_reset: {
    subject: "Su código para restablecer la contraseña",
    bodyHtml:
      "<p>Hola:</p><p>Su código de verificación para restablecer la contraseña es: <strong style=\"font-size:20px;letter-spacing:2px\">{code}</strong></p><p>Este código vence en 15 minutos. Si usted no pidió restablecer su contraseña, ignore este correo.</p>",
  },
  username_reminder: {
    subject: "Su usuario de SSAA",
    bodyHtml:
      "<p>Hola, {user_name}:</p><p>Su usuario de SSAA (el correo con el que inicia sesión) es: <strong>{email}</strong></p><p>Si usted no lo pidió, puede ignorar este correo.</p>",
  },
};

/** The default English push (bell) wording per event, for translating notifications stored in English. */
export const ENGLISH_PUSH: Record<string, { title: string; body: string }> = Object.fromEntries(
  SEEDS.filter((s) => s.push).map((s) => [s.eventType, s.push!]),
);
