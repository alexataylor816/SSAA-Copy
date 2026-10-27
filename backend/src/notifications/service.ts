/**
 * In-app notifications, ported from the Lovable app's `user_notifications` table and NotificationBell,
 * plus the emails for the same events. Each bell row belongs to one user; the bell lists the latest ones
 * and marks them read when opened. All wording comes from the operator's templates (templates.ts) and
 * every message is recorded in the correspondence log (correspondence.ts).
 */
import crypto from "node:crypto";
import { database } from "../db.js";
import { emit } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import { findUserById } from "../models/users.js";
import { findCompanyById, findEmployeeById, findJoinRequestById } from "../rbac/models.js";
import { logCorrespondence, renderPush, sendTemplatedEmail } from "./correspondence.js";
import type { ScheduleRequest } from "../scheduling/types.js";

export async function ensureNotificationTables(): Promise<void> {
  await database.exec(`
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

export async function listNotifications(userId: string): Promise<Notification[]> {
  const rows = await database.all<Row>(
    "SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
    [userId],
  );
  return rows.map(toNotification);
}

/** Marks the given ids (or everything unread when none are given) as read — only ever the caller's own. */
export async function markNotificationsRead(userId: string, ids?: unknown): Promise<void> {
  const now = new Date().toISOString();
  if (Array.isArray(ids) && ids.length > 0) {
    const clean = ids.filter((id): id is string => typeof id === "string");
    if (clean.length === 0) return;
    await database.run(
      `UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${clean.map(() => "?").join(", ")})`,
      [now, userId, ...clean],
    );
    return;
  }
  await database.run("UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [now, userId]);
}

type Vars = Record<string, string | number | null | undefined>;

/**
 * Bell notifications from the event's push template (`fallback` if it has none). Returns false when the
 * template's push is switched off, so nothing went out.
 */
async function notify(
  userIds: Iterable<string>,
  message: { eventType: string; vars: Vars; fallback: { title: string; body: string }; projectId?: string | null; link?: string | null; actorUserId?: string | null },
): Promise<boolean> {
  // Runs after the real action has succeeded; a failure here must not turn
  // that success into an error response.
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return false;
  try {
    const push = await renderPush(message.eventType, message.vars, message.fallback);
    for (const userId of recipients) {
      if (!push.active) {
        await logCorrespondence({ eventType: message.eventType, channel: "push", recipientUserId: userId, subject: push.title, body: push.body, status: "off", errorMessage: "Template is switched off.", actorUserId: message.actorUserId });
        continue;
      }
      const id = crypto.randomUUID();
      await database.run(
        `INSERT INTO user_notifications (id, user_id, event_type, title, body, project_id, link, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, message.eventType, push.title, push.body, message.projectId ?? null, message.link ?? null, new Date().toISOString()],
      );
      emit(EVENT.notificationCreated, { id }, ROOM.notifications, userId);
      await logCorrespondence({ eventType: message.eventType, channel: "push", recipientUserId: userId, subject: push.title, body: push.body, status: "sent", actorUserId: message.actorUserId });
    }
    return push.active;
  } catch (err) {
    console.error(`Failed to record "${message.eventType}" notification:`, err);
    return false;
  }
}

/** The same event by email to each of these users. True when at least one went out. */
async function emailUsers(userIds: Iterable<string>, eventType: string, vars: Vars, actorUserId?: string | null): Promise<boolean> {
  let any = false;
  try {
    for (const id of new Set(userIds)) {
      const user = await findUserById(id);
      if (!user?.email) continue;
      const status = await sendTemplatedEmail({
        eventType,
        to: user.email,
        vars: { user_name: user.fullName, ...vars },
        recipientUserId: user.id,
        recipientCompanyId: user.companyId,
        actorUserId,
      });
      if (status === "sent") any = true;
    }
  } catch (err) {
    console.error(`Failed to email "${eventType}":`, err);
  }
  return any;
}

/** People who can act on schedule requests for a company: partial and up (the creator always counts). */
async function schedulers(companyId: string, exceptUserId: string): Promise<string[]> {
  const rows = await database.all<{ id: string }>(
    `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.company_id = u.company_id
      WHERE u.company_id = ? AND (r.permission_level IN ('partial', 'full', 'account_holder') OR r.is_company_creator = 1)`,
    [companyId],
  );
  return rows.map((r) => r.id).filter((id) => id !== exceptUserId);
}

/**
 * Who hears about a project at a company (Luke's rule: "project assignment decides who gets emails"):
 * its schedulers, narrowed to the people assigned to that project on the Team page when anyone is.
 * An owner whose PM does the scheduling unassigns themselves to stop the emails.
 */
async function projectRecipients(companyId: string, projectIds: string[], exceptUserId: string): Promise<string[]> {
  const everyone = await schedulers(companyId, exceptUserId);
  if (projectIds.length === 0) return everyone;
  const assigned = new Set(
    (
      await database.all<{ user_id: string }>(
        `SELECT user_id FROM user_project_assignments WHERE company_id = ? AND project_id IN (${projectIds.map(() => "?").join(", ")})`,
        [companyId, ...projectIds],
      )
    ).map((r) => r.user_id),
  );
  return assigned.size > 0 ? everyone.filter((id) => assigned.has(id)) : everyone;
}

/** Who may approve join requests: account holders, plus full-level for sub companies (rbac/permissions). */
async function approvers(companyId: string): Promise<string[]> {
  const company = await findCompanyById(companyId);
  const levels = company?.companyType === "sub" ? "('full', 'account_holder')" : "('account_holder')";
  const rows = await database.all<{ id: string }>(
    `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.company_id = u.company_id
      WHERE u.company_id = ? AND (r.permission_level IN ${levels} OR r.is_company_creator = 1)`,
    [companyId],
  );
  return rows.map((r) => r.id);
}

/** "07:00" -> "7:00 AM" */
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/** The placeholders every schedule template can use. */
async function requestVars(request: ScheduleRequest) {
  const project = await database.get<{ name: string; address: string | null }>("SELECT name, address FROM projects WHERE id = ?", [request.projectId]);
  const names: string[] = [];
  for (const id of request.employeeIds) {
    const emp = await findEmployeeById(id);
    if (emp) names.push(emp.name);
  }
  const crew = request.employeeIds.length;
  return {
    project_name: project?.name ?? "a project",
    project_address: project?.address ?? "",
    requesting_company: (await findCompanyById(request.requestingCompanyId))?.name ?? "The GC",
    sub_company: (await findCompanyById(request.subCompanyId))?.name ?? "The subcontractor",
    scheduled_date: dayLabel(request.date),
    start_time: request.startTime ? clock(request.startTime) : "",
    end_time: request.endTime ? clock(request.endTime) : "",
    crew_count: `${crew} ${crew === 1 ? "person" : "people"}`,
    crew_names: names.join(", "),
    reason: request.statusReason ? `Reason: ${request.statusReason}` : "",
  };
}

export async function notifyScheduleRequestCreated(actorUserId: string, request: ScheduleRequest) {
  const v = await requestVars(request);
  const recipients = await projectRecipients(request.subCompanyId, [request.projectId], actorUserId);
  await notify(recipients, {
    eventType: "schedule_created",
    vars: v,
    fallback: { title: "New schedule request", body: `${v.requesting_company} requested ${v.crew_count} for ${v.scheduled_date} on ${v.project_name}.` },
    projectId: request.projectId,
    link: `/dashboard?day=${request.date}`,
    actorUserId,
  });
  await emailUsers(recipients, "schedule_created", v, actorUserId);
}

export async function notifyScheduleRequestUpdated(actorUserId: string, request: ScheduleRequest) {
  const v = await requestVars(request);
  const link = `/dashboard?day=${request.date}`;
  if (request.status === "confirmed" || request.status === "rejected") {
    const eventType = request.status === "confirmed" ? "schedule_confirmed" : "schedule_rejected";
    const recipients = await projectRecipients(request.requestingCompanyId, [request.projectId], actorUserId);
    await notify(recipients, {
      eventType,
      vars: v,
      fallback: {
        title: request.status === "confirmed" ? "Request confirmed" : "Request declined",
        body: `${v.sub_company} ${request.status === "confirmed" ? "confirmed" : "declined"} ${v.scheduled_date} on ${v.project_name}. ${v.reason}`.trim(),
      },
      projectId: request.projectId,
      link,
      actorUserId,
    });
    await emailUsers(recipients, eventType, v, actorUserId);
  } else if (request.status === "cancelled") {
    // Whoever didn't cancel it needs to know.
    const actorCompany = (await findUserById(actorUserId))?.companyId;
    const other = actorCompany === request.subCompanyId ? request.requestingCompanyId : request.subCompanyId;
    const vars = { ...v, cancelling_company: actorCompany === request.subCompanyId ? v.sub_company : v.requesting_company };
    const recipients = await projectRecipients(other, [request.projectId], actorUserId);
    await notify(recipients, {
      eventType: "schedule_cancelled",
      vars,
      fallback: { title: "Request cancelled", body: `${vars.cancelling_company} cancelled ${v.scheduled_date} on ${v.project_name}. ${v.reason}`.trim() },
      projectId: request.projectId,
      link,
      actorUserId,
    });
    await emailUsers(recipients, "schedule_cancelled", vars, actorUserId);
  }
}

/**
 * One Weekly-view publish, told once per company rather than once per request.
 *
 * `toCompany` is the other side of each request (the GC when a sub publishes, the sub when a GC sends):
 * its schedulers get a bell notification (`push`) and/or an email. If anyone there is assigned to the
 * projects involved (Team page), only they hear about it. `toPersonnel` reaches the people placed.
 * Returns what actually went out, so the screen can say when email isn't set up.
 */
export async function notifyMatrixPublish(
  actorUserId: string,
  actorCompanyId: string,
  requests: ScheduleRequest[],
  choice: { toCompanyEmail: boolean; toCompanyPush: boolean; toPersonnelEmail: boolean; toPersonnelPush: boolean },
): Promise<{ email: boolean; push: boolean }> {
  const sent = { email: false, push: false };
  if (requests.length === 0) return sent;
  const actor = await findCompanyById(actorCompanyId);
  const actorName = actor?.name ?? "A contractor";
  const actorIsSub = actor?.companyType === "sub";
  const projectName = new Map<string, string>();
  for (const r of requests) {
    if (!projectName.has(r.projectId)) {
      projectName.set(r.projectId, (await database.get<{ name: string }>("SELECT name FROM projects WHERE id = ?", [r.projectId]))?.name ?? "a project");
    }
  }

  const byCompany = new Map<string, ScheduleRequest[]>();
  for (const r of requests) {
    const other = r.subCompanyId === actorCompanyId ? r.requestingCompanyId : r.subCompanyId;
    if (other === actorCompanyId) continue;
    byCompany.set(other, [...(byCompany.get(other) ?? []), r]);
  }

  for (const [companyId, reqs] of byCompany) {
    if (!choice.toCompanyEmail && !choice.toCompanyPush) break;
    const projectIds = [...new Set(reqs.map((r) => r.projectId))];
    const n = reqs.length;
    const eventType = actorIsSub ? "schedule_edited" : "schedule_batch_sent";
    const vars = {
      company_name: actorName,
      change_count: `${n} change${n === 1 ? "" : "s"}`,
      project_names: projectIds.map((id) => projectName.get(id)).join(", "),
      dates: [...new Set(reqs.map((r) => r.date))].sort().map(dayLabel).join(", "),
    };
    const fallback = {
      title: actorIsSub ? "Schedule edited" : "New schedule requests",
      body: `${actorName} ${actorIsSub ? "updated the schedule" : "sent schedule requests"}: ${vars.change_count} on ${vars.project_names} (${vars.dates}).`,
    };

    const recipients = await projectRecipients(companyId, projectIds, actorUserId);

    if (choice.toCompanyPush && recipients.length > 0) {
      if (await notify(recipients, { eventType, vars, fallback, projectId: projectIds[0], link: `/dashboard?day=${reqs[0].date}`, actorUserId })) {
        sent.push = true;
      }
    }
    if (choice.toCompanyEmail && (await emailUsers(recipients, eventType, vars, actorUserId))) sent.email = true;
  }

  if (choice.toPersonnelEmail || choice.toPersonnelPush) {
    // Luke: "each person gets an email and a chat message saying where they're going and when".
    const { getOrCreateDm, sendMessage } = await import("../messaging/service.js");
    for (const r of requests.filter((r) => r.status === "pending" || r.status === "confirmed")) {
      const address = (await database.get<{ address: string | null }>("SELECT address FROM projects WHERE id = ?", [r.projectId]))?.address;
      const base = {
        company_name: actorName,
        project_name: projectName.get(r.projectId),
        project_address: address ? ` (${address})` : "",
        scheduled_date: dayLabel(r.date),
        time_range: r.startTime && r.endTime ? `, ${clock(r.startTime)}–${clock(r.endTime)}` : "",
      };
      for (const employeeId of r.employeeIds) {
        const emp = await findEmployeeById(employeeId);
        if (!emp) continue;
        const vars = { ...base, employee_name: emp.name.split(" ")[0] };
        const fallback = {
          title: "You're on the schedule",
          body: `Hi ${vars.employee_name}, you're scheduled at ${base.project_name}${base.project_address} on ${base.scheduled_date}${base.time_range}.`,
        };
        if (choice.toPersonnelPush && emp.linkedUserId) {
          const delivered = await notify([emp.linkedUserId], { eventType: "schedule_assigned", vars, fallback, projectId: r.projectId, link: `/dashboard?day=${r.date}`, actorUserId });
          if (delivered && emp.linkedUserId !== actorUserId) {
            // Lovable's push channel: the same text as a message in the person's People chat.
            const push = await renderPush("schedule_assigned", vars, fallback);
            try {
              const dm = await getOrCreateDm(actorUserId, emp.linkedUserId);
              const { message, recipientIds } = await sendMessage(actorUserId, dm, push.body);
              for (const userId of recipientIds) emit(EVENT.messageCreated, { message }, ROOM.user_messages, userId);
              await logCorrespondence({ eventType: "schedule_assigned", channel: "chat", recipientUserId: emp.linkedUserId, body: push.body, status: "sent", actorUserId });
            } catch (err) {
              console.error("Couldn't send the schedule chat message:", err);
              await logCorrespondence({
                eventType: "schedule_assigned",
                channel: "chat",
                recipientUserId: emp.linkedUserId,
                body: push.body,
                status: "failed",
                errorMessage: err instanceof Error ? err.message : "chat error",
                actorUserId,
              });
            }
          }
          if (delivered) sent.push = true;
        }
        const email = emp.email ?? (emp.linkedUserId ? (await findUserById(emp.linkedUserId))?.email : null);
        if (choice.toPersonnelEmail && email) {
          const status = await sendTemplatedEmail({ eventType: "schedule_assigned", to: email, vars, recipientUserId: emp.linkedUserId, recipientCompanyId: emp.companyId, actorUserId });
          if (status === "sent") sent.email = true;
        }
      }
    }
  }
  return sent;
}

export async function notifyJoinRequestCreated(requesterUserId: string, companyId: string) {
  const requester = await findUserById(requesterUserId);
  const company = await findCompanyById(companyId);
  const vars = {
    requester_name: requester?.fullName || requester?.email || "Someone",
    requester_email: requester?.email ?? "",
    company_name: company?.name ?? "your company",
  };
  const recipients = await approvers(companyId);
  await notify(recipients, {
    eventType: "join_request",
    vars,
    fallback: { title: "New join request", body: `${vars.requester_name} asked to join ${vars.company_name}.` },
    link: "/dashboard",
    actorUserId: requesterUserId,
  });
  await emailUsers(recipients, "join_request", vars, requesterUserId);
}

export async function notifyJoinRequestResolved(requestId: string, approved: boolean) {
  const joinRequest = await findJoinRequestById(requestId);
  if (!joinRequest) return;
  const company = await findCompanyById(joinRequest.companyId);
  const eventType = approved ? "join_approved" : "join_rejected";
  const vars = { company_name: company?.name ?? "The company" };
  await notify([joinRequest.userId], {
    eventType,
    vars,
    fallback: {
      title: approved ? "You're in" : "Join request declined",
      body: approved ? `${vars.company_name} approved your request. You can start scheduling now.` : `${vars.company_name} declined your request to join.`,
    },
    link: "/dashboard",
  });
  await emailUsers([joinRequest.userId], eventType, vars);
}
