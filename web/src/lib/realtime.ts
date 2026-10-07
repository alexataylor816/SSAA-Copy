/**
 * Mirrors backend/src/realtime/events.ts's EVENT names so page components
 * don't hand-type the strings (and drift from the server's actual emits).
 *
 * Note on rooms: the server auto-joins every authenticated socket to its
 * company's rooms on connect (backend/src/realtime/index.ts's `roomsFor`),
 * including connected companies' project rooms. A page only needs to
 * register `.on(EVENT.x, handler)` *before* calling `.subscribe()` — the
 * `supabase.channel(name)` name itself is just a label here, not something
 * that has to match a server room string, except for conversation rooms
 * (chat), which aren't wired yet.
 */
export const EVENT = {
  scheduleRequestCreated: "schedule_request:created",
  scheduleRequestUpdated: "schedule_request:updated",
  availabilityChanged: "availability:changed",
  projectConnectionChanged: "project_connection:changed",
  joinRequestCreated: "join_request:created",
  joinRequestResolved: "join_request:resolved",
  taskChanged: "task:changed",
  messageCreated: "message:created",
  notificationCreated: "notification:created",
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];
