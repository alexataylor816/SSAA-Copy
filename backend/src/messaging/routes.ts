import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { emit } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import {
  addGroupParticipant,
  createGroup,
  getOrCreateDm,
  listContacts,
  listConversations,
  listMessages,
  listParticipants,
  markRead,
  sendMessage,
  type MessageView,
} from "./service.js";

/** Every participant hears about a new message in their own room. */
function broadcast(message: MessageView, recipientIds: string[]) {
  for (const userId of recipientIds) emit(EVENT.messageCreated, { message }, ROOM.user_messages, userId);
}

export const messagingRouter = Router();

function route(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  };
}

messagingRouter.get(
  "/conversations",
  requireAuth,
  route((req, res) => {
    res.json({ conversations: listConversations(req.userId!) });
  }),
);

messagingRouter.get(
  "/conversations/:id/messages",
  requireAuth,
  route((req, res) => {
    res.json({ messages: listMessages(req.userId!, req.params.id) });
  }),
);

messagingRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  route((req, res) => {
    const { message, recipientIds } = sendMessage(req.userId!, req.params.id, req.body?.body);
    broadcast(message, recipientIds);
    res.status(201).json({ message });
  }),
);

messagingRouter.post(
  "/conversations/:id/read",
  requireAuth,
  route((req, res) => {
    markRead(req.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

messagingRouter.post(
  "/conversations/group",
  requireAuth,
  route((req, res) => {
    const { conversationId, message, recipientIds } = createGroup(req.userId!, req.body?.title, req.body?.userIds);
    broadcast(message, recipientIds);
    res.status(201).json({ conversationId });
  }),
);

messagingRouter.get(
  "/conversations/:id/participants",
  requireAuth,
  route((req, res) => {
    res.json({ participants: listParticipants(req.userId!, req.params.id) });
  }),
);

messagingRouter.post(
  "/conversations/:id/participants",
  requireAuth,
  route((req, res) => {
    const { message, recipientIds } = addGroupParticipant(req.userId!, req.params.id, req.body?.userId);
    broadcast(message, recipientIds);
    res.status(201).json({ message });
  }),
);

messagingRouter.post(
  "/conversations/dm",
  requireAuth,
  route((req, res) => {
    res.json({ conversationId: getOrCreateDm(req.userId!, req.body?.userId) });
  }),
);

messagingRouter.get(
  "/messaging/contacts",
  requireAuth,
  route((req, res) => {
    res.json({ contacts: listContacts(req.userId!) });
  }),
);
