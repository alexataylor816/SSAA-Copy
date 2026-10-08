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

function route(handler: (...args: Parameters<RequestHandler>) => unknown): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
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
  route(async (req, res) => {
    res.json({ conversations: await listConversations(req.userId!) });
  }),
);

messagingRouter.get(
  "/conversations/:id/messages",
  requireAuth,
  route(async (req, res) => {
    res.json({ messages: await listMessages(req.userId!, req.params.id) });
  }),
);

messagingRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  route(async (req, res) => {
    const { message, recipientIds } = await sendMessage(req.userId!, req.params.id, req.body?.body);
    broadcast(message, recipientIds);
    res.status(201).json({ message });
  }),
);

messagingRouter.post(
  "/conversations/:id/read",
  requireAuth,
  route(async (req, res) => {
    await markRead(req.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

messagingRouter.post(
  "/conversations/group",
  requireAuth,
  route(async (req, res) => {
    const { conversationId, message, recipientIds } = await createGroup(req.userId!, req.body?.title, req.body?.userIds);
    broadcast(message, recipientIds);
    res.status(201).json({ conversationId });
  }),
);

messagingRouter.get(
  "/conversations/:id/participants",
  requireAuth,
  route(async (req, res) => {
    res.json({ participants: await listParticipants(req.userId!, req.params.id) });
  }),
);

messagingRouter.post(
  "/conversations/:id/participants",
  requireAuth,
  route(async (req, res) => {
    const { message, recipientIds } = await addGroupParticipant(req.userId!, req.params.id, req.body?.userId);
    broadcast(message, recipientIds);
    res.status(201).json({ message });
  }),
);

messagingRouter.post(
  "/conversations/dm",
  requireAuth,
  route(async (req, res) => {
    res.json({ conversationId: await getOrCreateDm(req.userId!, req.body?.userId) });
  }),
);

messagingRouter.get(
  "/messaging/contacts",
  requireAuth,
  route(async (req, res) => {
    res.json({ contacts: await listContacts(req.userId!) });
  }),
);
