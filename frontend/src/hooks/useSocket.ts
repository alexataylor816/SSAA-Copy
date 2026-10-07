import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';

import { API_URL } from '@/config';

/**
 * Socket.IO client stub (Phase 0).
 *
 * Realtime consumers land in Phase 3 (scheduling) and Phase 4 (chat). The room
 * scheme must mirror the backend map in backend/app/realtime/events.py.
 *
 * Supabase channel           -> Socket.IO room                        -> phase
 * ---------------------------------------------------------------------------------
 * schedule-requests-changes  -> company:{company_id}:schedule_requests -> 3
 * availability-changes       -> company:{company_id}:availability      -> 3
 * project_connections_changes-> company:{company_id}:project_connections -> 3
 * messaging-global-{userId}  -> user:{user_id}:messages                -> 4
 * conv-{conversationId}      -> conversation:{conversation_id}         -> 4
 * user_notifications_{userId}-> user:{user_id}:notifications           -> 4
 *
 * On login (Phase 1) the client calls `joinRooms([...])` after authenticating;
 * the auth slice in RTK provides user_id + company_id for room keys.
 */

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function joinRooms(rooms: string[]) {
  socket?.emit('join', { rooms });
}

export function leaveRooms(rooms: string[]) {
  socket?.emit('leave', { rooms });
}

/** Connect once. Call from a screen mounted for the app's lifetime. */
export function useSocket(connect = false) {
  useEffect(() => {
    if (!connect) return;
    if (!socket) {
      socket = io(API_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
      });
    }
    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [connect]);
}