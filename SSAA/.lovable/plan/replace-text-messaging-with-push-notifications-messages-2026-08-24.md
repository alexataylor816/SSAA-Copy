# Replace Text Messaging with Push Notifications + Messages

Retire text messaging as an outbound channel. Everything that used to be sent as a text now goes out two ways:

1. A push notification to the recipient (in-app bell immediately, browser web push for users who opt in).
2. A message in the People section of the recipient's Messages tab, sent from whoever triggered it.

SMS code, templates, consent copy, and privacy/legal language stay in place but go dormant and hidden.

## 1. Correspondence tab (Operator Dashboard > Manage SSAA > Correspondence)

- Copy every existing text template into the Push section: same event types, same body text, same placeholder tokens, stored as `channel = 'push'`, skipping any that already exist so the copy can be re-run safely.
- Replace the current "Push notifications will be available in a future update" placeholder with a real editable template list, mirroring the existing text editor (body editing, placeholder insertion, save/undo, live preview).
- The Text tab and Text Response Log stay in the code but are hidden from the UI. Templates and the inbound log are untouched.
- Push templates carry both a short push title/body and the longer message body used for the People chat message.

## 2. Sending pipeline

- New `send-push` backend function. For each recipient it: writes a notification row (feeds the bell), sends a web push to any registered device, opens/reuses the recipient's People (direct) chat with the sender, and posts the message there.
- Reuses the existing direct-conversation helper so the message lands in the recipient's People list attributed to the actual sender, not "system".
- The shared notification helper switches its phone list to a recipient-user-id list and calls `send-push` instead of the SMS function. Email behavior is unchanged.
- Every current caller passing phone numbers (dashboard schedule requests/assignments, resource matrix, message broadcast) is updated to pass recipient users instead. The SMS function stays deployed but is no longer called.

## 3. Push infrastructure

- New tables for device push subscriptions and in-app notifications, each user limited to their own rows.
- Service worker plus VAPID key setup for browser push. A permission prompt appears once per user; users who decline still get the bell and the People message.
- Notification bell in the dashboard header showing unread push notifications, clicking through to the relevant chat.

## 4. UI wording

- Everywhere a "Text" / "SMS" toggle or label exists (send-channel prompt in Messages, notify-on-assign dialog, profile correspondence preferences, resource matrix and dashboard prompts, translations for English and Spanish), the text option becomes "Send push notification and message".
- The Email option keeps its own separate toggle. Nothing else about those dialogs changes.
- Consent dialog, privacy policy, terms, and all legal SMS language stay exactly as-is.

## Technical notes

Files touched: `src/hooks/useNotification.ts`, `ManageCorrespondenceModal.tsx`, `SendChannelPromptDialog.tsx`, `NotifyOnAssignDialog.tsx`, `ConversationThread.tsx`, `Dashboard.tsx`, `ResourceMatrix.tsx`, `ManageProfileModal.tsx`, `ProfilesModal.tsx`, `translations.ts`, plus a new `supabase/functions/send-push` and a service worker.

Database work: `push_subscriptions` and `user_notifications` tables with row-level security and grants, a data migration copying text templates to push templates, and a helper function to resolve or create the direct conversation for a sender/recipient pair.

Web push requires VAPID keys stored as backend secrets; these will be generated and requested during implementation.

## Verification

After implementation, an end-to-end browser check: trigger a schedule request, confirm the push row, bell entry, and People chat message all appear, then delete any test data created.
