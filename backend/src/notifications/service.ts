/**
 * In-app notifications, ported from the Lovable app's `user_notifications`
 * table and NotificationBell. Each row belongs to one user; the bell lists the
 * latest ones and marks them read when opened. Push/SMS/email delivery of the
 * same events is not ported.
 */
import crypto from "node:crypto";
import { db } from "../db.js";
import { emit } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import { findUserById } from "../models/users.js";
import { findCompanyById, findJoinRequestById } from "../rbac/models.js";
import type { ScheduleRequest } from "../scheduling/types.js";

export function ensureNotificationTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      project_id TEXT,
      link TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, created_at);
  `);
}

export interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  projectId: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  project_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const toNotification = (r: Row): Notification => ({
  id: r.id,
  eventType: r.event_type,
  title: r.title,
  body: r.body,
  projectId: r.project_id,
  link: r.link,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export function listNotifications(userId: string): Notification[] {
  const rows = db
    .prepare("SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30")
    .all(userId) as Row[];
  return rows.map(toNotification);
}

/** Marks the given ids (or everything unread when none are given) as read — only ever the caller's own. */
export function markNotificationsRead(userId: string, ids?: unknown): void {
  const now = new Date().toISOString();
  if (Array.isArray(ids) && ids.length > 0) {
    const clean = ids.filter((id): id is string => typeof id === "string");
    if (clean.length === 0) return;
    db.prepare(
      `UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${clean.map(() => "?").join(", ")})`,
    ).run(now, userId, ...clean);
    return;
  }
  db.prepare("UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now, userId);
}

function notify(
  userIds: Iterable<string>,
  message: { eventType: string; title: string; body: string; projectId?: string | null; link?: string | null },
) {
  // Runs after the real action has succeeded; a failure here must not turn
  // that success into an error response.
  try {
    const insert = db.prepare(
      `INSERT INTO user_notifications (id, user_id, event_type, title, body, project_id, link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const userId of new Set(userIds)) {
      const id = crypto.randomUUID();
      insert.run(id, userId, message.eventType, message.title, message.body, message.projectId ?? null, message.link ?? null, new Date().toISOString());
      emit(EVENT.notificationCreated, { id }, ROOM.notifications, userId);
    }
  } catch (err) {
    console.error(`Failed to record "${message.eventType}" notification:`, err);
  }
}

/** People who can act on schedule requests for a company: partial and up (the creator always counts). */
function schedulers(companyId: string, exceptUserId: string): string[] {
  const rows = db
    .prepare(
      `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.company_id = u.company_id
        WHERE u.company_id = ? AND (r.permission_level IN ('partial', 'full', 'account_holder') OR r.is_company_creator = 1)`,
    )
    .all(companyId) as { id: string }[];
  return rows.map((r) => r.id).filter((id) => id !== exceptUserId);
}

/** Who may approve join requests: account holders, plus full-level for sub companies (rbac/permissions). */
async function approvers(companyId: string): Promise<string[]> {
  const company = await findCompanyById(companyId);
  const levels = company?.companyType === "sub" ? "('full', 'account_holder')" : "('account_holder')";
  const rows = db
    .prepare(
      `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.company_id = u.company_id
        WHERE u.company_id = ? AND (r.permission_level IN ${levels} OR r.is_company_creator = 1)`,
    )
    .all(companyId) as { id: string }[];
  return rows.map((r) => r.id);
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

async function requestContext(request: ScheduleRequest) {
  const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(request.projectId) as { name: string } | undefined;
  return {
    projectName: project?.name ?? "a project",
    gcName: (await findCompanyById(request.requestingCompanyId))?.name ?? "The GC",
    subName: (await findCompanyById(request.subCompanyId))?.name ?? "The subcontractor",
    day: dayLabel(request.date),
    link: `/dashboard?day=${request.date}`,
  };
}

export async function notifyScheduleRequestCreated(actorUserId: string, request: ScheduleRequest) {
  const c = await requestContext(request);
  const crew = request.employeeIds.length;
  notify(schedulers(request.subCompanyId, actorUserId), {
    eventType: "schedule_created",
    title: "New schedule request",
    body: `${c.gcName} requested ${crew} ${crew === 1 ? "person" : "people"} for ${c.day} on ${c.projectName}.`,
    projectId: request.projectId,
    link: c.link,
  });
}

export async function notifyScheduleRequestUpdated(actorUserId: string, request: ScheduleRequest) {
  const c = await requestContext(request);
  const reason = request.statusReason ? ` Reason: ${request.statusReason}` : "";
  if (request.status === "confirmed" || request.status === "rejected") {
    notify(schedulers(request.requestingCompanyId, actorUserId), {
      eventType: request.status === "confirmed" ? "schedule_confirmed" : "schedule_rejected",
      title: request.status === "confirmed" ? "Request confirmed" : "Request declined",
      body: `${c.subName} ${request.status === "confirmed" ? "confirmed" : "declined"} ${c.day} on ${c.projectName}.${reason}`,
      projectId: request.projectId,
      link: c.link,
    });
  } else if (request.status === "cancelled") {
    // Whoever didn't cancel it needs to know.
    const actorCompany = (await findUserById(actorUserId))?.companyId;
    const other = actorCompany === request.subCompanyId ? request.requestingCompanyId : request.subCompanyId;
    const by = actorCompany === request.subCompanyId ? c.subName : c.gcName;
    notify(schedulers(other, actorUserId), {
      eventType: "schedule_cancelled",
      title: "Request cancelled",
      body: `${by} cancelled ${c.day} on ${c.projectName}.${reason}`,
      projectId: request.projectId,
      link: c.link,
    });
  }
}

export async function notifyJoinRequestCreated(requesterUserId: string, companyId: string) {
  const requester = await findUserById(requesterUserId);
  const company = await findCompanyById(companyId);
  notify(await approvers(companyId), {
    eventType: "join_request",
    title: "New join request",
    body: `${requester?.fullName || requester?.email || "Someone"} asked to join ${company?.name ?? "your company"}.`,
    link: "/dashboard",
  });
}

export async function notifyJoinRequestResolved(requestId: string, approved: boolean) {
  const joinRequest = await findJoinRequestById(requestId);
  if (!joinRequest) return;
  const company = await findCompanyById(joinRequest.companyId);
  notify([joinRequest.userId], {
    eventType: approved ? "join_approved" : "join_rejected",
    title: approved ? "You're in" : "Join request declined",
    body: approved
      ? `${company?.name ?? "The company"} approved your request. You can start scheduling now.`
      : `${company?.name ?? "The company"} declined your request to join.`,
    link: "/dashboard",
  });
}
