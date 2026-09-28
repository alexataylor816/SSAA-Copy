/**
 * Socket.IO room map.
 *
 * Mirrors every Supabase realtime channel the old frontend subscribed to.
 * Consumers land in Phase 3 (scheduling) and Phase 4 (chat). When a handler
 * emits, it emits to the room listed here so the mobile client can subscribe
 * to the same rooms.
 *
 * Supabase channel                         -> Socket.IO room                        -> phase
 * --------------------------------------------------------------------------------------------------
 * schedule-requests-changes                -> company:{company_id}:schedule_requests -> 3
 * availability-changes                     -> company:{company_id}:availability      -> 3
 * project_connections_changes              -> company:{company_id}:project_connections -> 3
 * messaging-global-{userId}                -> user:{user_id}:messages                -> 4
 * conv-{conversationId}                    -> conversation:{conversation_id}         -> 4
 * profile-operator-changes                 -> user:{user_id}:profile                 -> 1
 * cancellation-requests-count              -> company:{company_id}:cancellations     -> 2
 * cc-tab                                   -> company:{company_id}:contractor_connections -> 2/3
 * join-requests-{company_id}               -> company:{company_id}:join_requests     -> 2
 * user_notifications_{userId}              -> user:{user_id}:notifications           -> 4
 *
 * Client hooks: mobile/src/hooks/useSocket.ts says 'connect' and joins these on
 * login, keyed off the RTK auth slice.
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
