/**
 * Realtime wiring.
 *
 * This used to not exist: `createApp` built a SocketIOServer and threw it
 * away in server.ts, there was no `io.on("connection")` anywhere, and
 * frontend/src/hooks/useSocket.ts was dead code. A second browser session saw
 * nothing happen when the first one acted.
 *
 * Now a socket authenticates with the same JWT the REST API uses, joins the
 * rooms its identity entitles it to, and every mutation emits to those rooms
 * so the client can invalidate its cache.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import { database } from "../db.js";
import { verifyToken } from "../services/tokens.js";
import { findUserById } from "../models/users.js";
import { room, ROOM, type RoomTemplate } from "./events.js";

interface Session {
  userId: string;
  companyId: string | null;
  isAdmin: boolean;
}

let activeIo: SocketIOServer | null = null;

/**
 * Emit to a room. Safe to call from anywhere — no-ops when no server is
 * attached, which is what lets the route tests run without a socket layer.
 */
export function emit(event: string, payload: unknown, template: RoomTemplate, id: string): void {
  activeIo?.to(room(template, id)).emit(event, payload);
}

/** Fan a schedule/availability change out to everyone who can see the project. */
export function emitProject(event: string, payload: unknown, projectId: string, companyIds: string[]): void {
  for (const companyId of new Set([projectId, ...companyIds])) {
    emit(event, payload, ROOM.schedule_requests, companyId);
    emit(event, payload, ROOM.availability, companyId);
  }
}

/**
 * Auto-join on connect: a client never has to ask for the rooms it is already
 * entitled to, so a plain `io()` gets a working live feed.
 */
async function roomsFor(session: Session): Promise<string[]> {
  const rooms: string[] = [
    room(ROOM.user_profile, session.userId),
    room(ROOM.user_messages, session.userId),
    room(ROOM.notifications, session.userId),
  ];
  if (!session.companyId) return rooms;

  const { companyId } = session;
  rooms.push(
    room(ROOM.schedule_requests, companyId),
    room(ROOM.availability, companyId),
    room(ROOM.project_connections, companyId),
    room(ROOM.join_requests, companyId),
    room(ROOM.cancellations, companyId),
    room(ROOM.contractor_connections, companyId),
  );

  // Being connected to someone else's project means their schedule changes
  // are relevant to you too.
  const connected = await database.all<{ project_id: string }>(
    "SELECT project_id FROM project_connections WHERE sub_company_id = ?",
    [companyId],
  );
  for (const row of connected) {
    rooms.push(room(ROOM.schedule_requests, row.project_id));
    rooms.push(room(ROOM.availability, row.project_id));
  }

  // Own projects are addressable by project id as well as company id.
  const owned = await database.all<{ id: string }>("SELECT id FROM projects WHERE company_id = ?", [companyId]);
  for (const row of owned) {
    rooms.push(room(ROOM.project_connections, row.id));
  }

  return [...new Set(rooms)];
}

export function attachRealtime(io: SocketIOServer) {
  activeIo = io;
  io.use(async (socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      (typeof socket.handshake.headers.authorization === "string"
        ? socket.handshake.headers.authorization.replace(/^Bearer /, "")
        : undefined);

    if (!token) return next(new Error("Missing token."));

    try {
      const payload = verifyToken(token);
      const user = await findUserById(payload.sub);
      if (!user) return next(new Error("Unknown user."));
      (socket.data as Session).userId = user.id;
      (socket.data as Session).companyId = user.companyId ?? null;
      (socket.data as Session).isAdmin = user.isAdmin;
      next();
    } catch {
      next(new Error("Invalid or expired token."));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const session = socket.data as Session;

    // Explicit joins for conversation rooms, which cannot be derived up front.
    // Registered before the room lookup below so an early "join" isn't dropped.
    socket.on("join", (payload: { conversationId?: string; room?: string }) => {
      if (payload?.conversationId) {
        void socket.join(room(ROOM.conversation, payload.conversationId));
      } else if (payload?.room) {
        void socket.join(payload.room);
      }
    });

    socket.on("leave", (payload: { conversationId?: string; room?: string }) => {
      if (payload?.conversationId) {
        void socket.leave(room(ROOM.conversation, payload.conversationId));
      } else if (payload?.room) {
        void socket.leave(payload.room);
      }
    });

    try {
      for (const name of await roomsFor(session)) {
        void socket.join(name);
      }
    } catch (err) {
      console.error("Failed to resolve realtime rooms:", err);
      socket.disconnect(true);
      return;
    }
    socket.emit("ready", { userId: session.userId, companyId: session.companyId });
  });
}