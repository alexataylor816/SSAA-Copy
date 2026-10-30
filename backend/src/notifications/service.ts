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
import { asLang, clockLabel, dayLabel, requestedLang, say, type Lang } from "../i18n/index.js";
import { translateStoredNotification } from "./translateStored.js";

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
  // Spanish copy of each notification, so the bell follows the reader's current language.
  const columns = new Set((await database.all<{ name: string }>("PRAGMA table_info(user_notifications)")).map((c) => c.name));
  if (!columns.has("title_es")) await database.exec("ALTER TABLE user_notifications ADD COLUMN title_es TEXT");
  if (!columns.has("body_es")) await database.exec("ALTER TABLE user_notifications ADD COLUMN body_es TEXT");
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
  title_es?: string | null;
  body_es?: string | null;
  project_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const toNotification = (r: Row, lang: Lang): Notification => {
  // Spanish when the reader is in Spanish: the stored copy, or for notifications from before both
  // languages were kept, a translation rebuilt from the standard template.
  const es = lang === "es" ? (r.title_es ? { title: r.title_es, body: r.body_es ?? null } : translateStoredNotification(r.event_type, r.title, r.body)) : null;
  return {
  id: r.id,
  eventType: r.event_type,
  title: es?.title ?? r.title,
  body: es ? es.body : r.body,
  projectId: r.project_id,
  link: r.link,
  readAt: r.read_at,
  createdAt: r.created_at,
  };
};

/**
 * The reader's latest notifications, in the language the app asked for (its EN/ES toggle), or the
 * reader's saved language when the request didn't say.
 */
export async function listNotifications(userId: string, lang?: Lang): Promise<Notification[]> {
  lang ??= requestedLang() ?? (await languageOf(userId));
  const rows = await database.all<Row>(
    "SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30",
    [userId],
  );
  return rows.map((r) => toNotification(r, lang));
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
/** Placeholder values in a given language (dates, counts and fallback words differ). */
type VarsFor = (lang: Lang) => Vars;

/** Each recipient's language, looked up once per send. */
async function languageOf(userId: string | null | undefined, cache?: Map<string, Lang>): Promise<Lang> {
  if (!userId) return "en";
  if (cache?.has(userId)) return cache.get(userId)!;
  const lang = asLang((await findUserById(userId))?.language);
  cache?.set(userId, lang);
  return lang;
}

/**
 * Bell notifications from the event's push template (`fallback` if it has none), each in the
 * recipient's language. Returns false when the template's push is switched off, so nothing went out.
 */
async function notify(
  userIds: Iterable<string>,
  message: { eventType: string; vars: VarsFor; fallback: { title: string; body: string }; projectId?: string | null; link?: string | null; actorUserId?: string | null },
): Promise<boolean> {
  // Runs after the real action has succeeded; a failure here must not turn
  // that success into an error response.
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return false;
  try {
    let active = true;
    // Both languages are kept with each notification; the bell shows whichever the reader is using.
    const en = await renderPush(message.eventType, message.vars("en"), message.fallback, "en");
    const es = await renderPush(message.eventType, message.vars("es"), message.fallback, "es");
    for (const userId of recipients) {
      const lang = await languageOf(userId);
      const push = lang === "es" ? es : en;
      active = push.active;
      if (!push.active) {
        await logCorrespondence({ eventType: message.eventType, channel: "push", recipientUserId: userId, subject: push.title, body: push.body, status: "off", errorMessage: "Template is switched off.", actorUserId: message.actorUserId });
        continue;
      }
      const id = crypto.randomUUID();
      await database.run(
        `INSERT INTO user_notifications (id, user_id, event_type, title, body, title_es, body_es, project_id, link, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, message.eventType, en.title, en.body, es.title, es.body, message.projectId ?? null, message.link ?? null, new Date().toISOString()],
      );
      emit(EVENT.notificationCreated, { id }, ROOM.notifications, userId);
      await logCorrespondence({ eventType: message.eventType, channel: "push", recipientUserId: userId, subject: push.title, body: push.body, status: "sent", actorUserId: message.actorUserId });
    }
    return active;
  } catch (err) {
    console.error(`Failed to record "${message.eventType}" notification:`, err);
    return false;
  }
}

/** The same event by email to each of these users, in each one's language. True when at least one went out. */
async function emailUsers(userIds: Iterable<string>, eventType: string, vars: VarsFor, actorUserId?: string | null): Promise<boolean> {
  let any = false;
  try {
    for (const id of new Set(userIds)) {
      const user = await findUserById(id);
      if (!user?.email) continue;
      const lang = asLang(user.language);
      const status = await sendTemplatedEmail({
        eventType,
        to: user.email,
        vars: { user_name: user.fullName, ...vars(lang) },
        recipientUserId: user.id,
        recipientCompanyId: user.companyId,
        actorUserId,
        lang,
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

/** "07:00" -> "7:00 AM" / "7:00 a.m." */
const clock = (t: string, lang: Lang) => clockLabel(t, lang);

/** "3 people" / "3 personas" */
const people = (n: number, lang: Lang) => say(n === 1 ? "1 person" : "{count} people", { count: n }, lang);
/** "2 changes" / "2 cambios" */
const changes = (n: number, lang: Lang) => say(n === 1 ? "1 change" : "{count} changes", { count: n }, lang);

/** The placeholders every schedule template can use, in either language. */
async function requestVars(request: ScheduleRequest): Promise<VarsFor> {
  const project = await database.get<{ name: string; address: string | null }>("SELECT name, address FROM projects WHERE id = ?", [request.projectId]);
  const names: string[] = [];
  for (const id of request.employeeIds) {
    const emp = await findEmployeeById(id);
    if (emp) names.push(emp.name);
  }
  const requesting = (await findCompanyById(request.requestingCompanyId))?.name;
  const sub = (await findCompanyById(request.subCompanyId))?.name;
  return (lang) => ({
    project_name: project?.name ?? say("a project", undefined, lang),
    project_address: project?.address ?? "",
    requesting_company: requesting ?? say("The GC", undefined, lang),
    sub_company: sub ?? say("The subcontractor", undefined, lang),
    scheduled_date: dayLabel(request.date, lang),
    start_time: request.startTime ? clock(request.startTime, lang) : "",
    end_time: request.endTime ? clock(request.endTime, lang) : "",
    crew_count: people(request.employeeIds.length, lang),
    crew_names: names.join(", "),
    reason: request.statusReason ? say("Reason: {reason}", { reason: request.statusReason }, lang) : "",
  });
}

export async function notifyScheduleRequestCreated(actorUserId: string, request: ScheduleRequest) {
  const v = await requestVars(request);
  const en = v("en");
  const recipients = await projectRecipients(request.subCompanyId, [request.projectId], actorUserId);
  await notify(recipients, {
    eventType: "schedule_created",
    vars: v,
    fallback: { title: "New schedule request", body: `${en.requesting_company} requested ${en.crew_count} for ${en.scheduled_date} on ${en.project_name}.` },
    projectId: request.projectId,
    link: `/dashboard?day=${request.date}`,
    actorUserId,
  });
  await emailUsers(recipients, "schedule_created", v, actorUserId);
}

export async function notifyScheduleRequestUpdated(actorUserId: string, request: ScheduleRequest) {
  const v = await requestVars(request);
  const en = v("en");
  const link = `/dashboard?day=${request.date}`;
  if (request.status === "confirmed" || request.status === "rejected") {
    const eventType = request.status === "confirmed" ? "schedule_confirmed" : "schedule_rejected";
    const recipients = await projectRecipients(request.requestingCompanyId, [request.projectId], actorUserId);
    await notify(recipients, {
      eventType,
      vars: v,
      fallback: {
        title: request.status === "confirmed" ? "Request confirmed" : "Request declined",
        body: `${en.sub_company} ${request.status === "confirmed" ? "confirmed" : "declined"} ${en.scheduled_date} on ${en.project_name}. ${en.reason}`.trim(),
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
    const vars: VarsFor = (lang) => {
      const base = v(lang);
      return { ...base, cancelling_company: actorCompany === request.subCompanyId ? base.sub_company : base.requesting_company };
    };
    const enVars = vars("en");
    const recipients = await projectRecipients(other, [request.projectId], actorUserId);
    await notify(recipients, {
      eventType: "schedule_cancelled",
      vars,
      fallback: { title: "Request cancelled", body: `${enVars.cancelling_company} cancelled ${en.scheduled_date} on ${en.project_name}. ${en.reason}`.trim() },
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
  const actorName = (lang: Lang) => actor?.name ?? say("A contractor", undefined, lang);
  const actorIsSub = actor?.companyType === "sub";
  const projectName = new Map<string, string | undefined>();
  for (const r of requests) {
    if (!projectName.has(r.projectId)) {
      projectName.set(r.projectId, (await database.get<{ name: string }>("SELECT name FROM projects WHERE id = ?", [r.projectId]))?.name);
    }
  }
  const nameOf = (projectId: string, lang: Lang) => projectName.get(projectId) ?? say("a project", undefined, lang);

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
    const vars: VarsFor = (lang) => ({
      company_name: actorName(lang),
      change_count: changes(n, lang),
      project_names: projectIds.map((id) => nameOf(id, lang)).join(", "),
      dates: [...new Set(reqs.map((r) => r.date))].sort().map((d) => dayLabel(d, lang)).join(", "),
    });
    const en = vars("en");
    const fallback = {
      title: actorIsSub ? "Schedule edited" : "New schedule requests",
      body: `${en.company_name} ${actorIsSub ? "updated the schedule" : "sent schedule requests"}: ${en.change_count} on ${en.project_names} (${en.dates}).`,
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
      const base: VarsFor = (lang) => ({
        company_name: actorName(lang),
        project_name: nameOf(r.projectId, lang),
        project_address: address ? ` (${address})` : "",
        scheduled_date: dayLabel(r.date, lang),
        time_range: r.startTime && r.endTime ? `, ${clock(r.startTime, lang)}–${clock(r.endTime, lang)}` : "",
      });
      for (const employeeId of r.employeeIds) {
        const emp = await findEmployeeById(employeeId);
        if (!emp) continue;
        // Crew without an account get English; anyone signed up gets their own language.
        const lang = await languageOf(emp.linkedUserId);
        const vars: VarsFor = (l) => ({ ...base(l), employee_name: emp.name.split(" ")[0] });
        const en = vars("en");
        const fallback = {
          title: "You're on the schedule",
          body: `Hi ${en.employee_name}, you're scheduled at ${en.project_name}${en.project_address} on ${en.scheduled_date}${en.time_range}.`,
        };
        if (choice.toPersonnelPush && emp.linkedUserId) {
          const delivered = await notify([emp.linkedUserId], { eventType: "schedule_assigned", vars, fallback, projectId: r.projectId, link: `/dashboard?day=${r.date}`, actorUserId });
          if (delivered && emp.linkedUserId !== actorUserId) {
            // Lovable's push channel: the same text as a message in the person's People chat.
            const push = await renderPush("schedule_assigned", vars(lang), fallback, lang);
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
          const status = await sendTemplatedEmail({ eventType: "schedule_assigned", to: email, vars: vars(lang), recipientUserId: emp.linkedUserId, recipientCompanyId: emp.companyId, actorUserId, lang });
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
  const vars: VarsFor = (lang) => ({
    requester_name: requester?.fullName || requester?.email || say("Someone", undefined, lang),
    requester_email: requester?.email ?? "",
    company_name: company?.name ?? say("your company", undefined, lang),
  });
  const en = vars("en");
  const recipients = await approvers(companyId);
  await notify(recipients, {
    eventType: "join_request",
    vars,
    fallback: { title: "New join request", body: `${en.requester_name} asked to join ${en.company_name}.` },
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
  const vars: VarsFor = (lang) => ({ company_name: company?.name ?? say("The company", undefined, lang) });
  const en = vars("en");
  await notify([joinRequest.userId], {
    eventType,
    vars,
    fallback: {
      title: approved ? "You're in" : "Join request declined",
      body: approved ? `${en.company_name} approved your request. You can start scheduling now.` : `${en.company_name} declined your request to join.`,
    },
    link: "/dashboard",
  });
  await emailUsers([joinRequest.userId], eventType, vars);
}
