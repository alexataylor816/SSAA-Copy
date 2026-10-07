/**
 * Socket.IO room map.
 *
 * Mirrors every Supabase realtime channel the old frontend subscribed to, so
 * the Lovable components and the Expo client can share one vocabulary.
 *
 * Supabase channel                         -> Socket.IO room
 * --------------------------------------------------------------------------------------------------
 * schedule-requests-changes                -> company:{company_id}:schedule_requests
 * availability-changes                     -> company:{company_id}:availability
 * project_connections_changes              -> company:{company_id}:project_connections
 * messaging-global-{userId}                -> user:{user_id}:messages
 * conv-{conversationId}                    -> conversation:{conversation_id}
 * profile-operator-changes                 -> user:{user_id}:profile
 * cancellation-requests-count              -> company:{company_id}:cancellations
 * cc-tab                                   -> company:{company_id}:contractor_connections
 * join-requests-{company_id}               -> company:{company_id}:join_requests
 * user_notifications_{userId}              -> user:{user_id}:notifications
 */
export const ROOM = {
  schedule_requests: "company:{company_id}:schedule_requests",
  availability: "company:{company_id}:availability",
  project_connections: "company:{company_id}:project_connections",
  user_messages: "user:{user_id}:messages",
  conversation: "conversation:{conversation_id}",
  user_profile: "user:{user_id}:profile",
  cancellations: "company:{company_id}:cancellations",
  contractor_connections: "company:{company_id}:contractor_connections",
  join_requests: "company:{company_id}:join_requests",
  notifications: "user:{user_id}:notifications",
} as const;

export type RoomTemplate = (typeof ROOM)[keyof typeof ROOM];

export function room(template: RoomTemplate, id: string): string {
  return template.replace("{company_id}", id).replace("{user_id}", id).replace("{conversation_id}", id);
}

/** Event names the server emits. Clients subscribe by name and refetch. */
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