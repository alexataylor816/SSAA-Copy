---
name: Push notifications replace text messages
description: Outbound SMS is retired — former texts now send a push notification plus a message in the recipient's People chat
type: feature
---

- No outbound SMS. Every notification that used to be a text now goes out as:
  1. A push notification (in-app bell via `user_notifications` + web push via `push_subscriptions`).
  2. A message posted in the recipient's People (direct) chat, attributed to the actual sender.
- Backed by the `send-push` edge function; `sendNotification({ recipientUserIds })` replaces `recipientPhones`.
  `skipMessage: true` sends bell/web-push only (used when the message already exists in a chat).
- Recipient resolution: `get_project_notification_user_ids`, `get_scheduled_personnel_user_ids`.
- Correspondence tab: Push templates (`channel = 'push'`) are editable; the Text tab and Text Response Log
  remain in code but are hidden. SMS functions, templates, consent copy, privacy/terms language stay in place, dormant.
- UI wording: every former Text/SMS toggle reads "Push notification and message".
