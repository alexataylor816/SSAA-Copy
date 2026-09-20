---
name: Project chats split per subcontractor
description: Each project has one chat per connected company; GC/Guest see project dropdown with sub list, subs see only their own chat
type: feature
---

- `conversations.sub_company_id` makes project chats unique per (project_id, sub_company_id). Legacy rows with null sub_company_id are owner-only leftovers.
- `get_or_create_project_sub_conversation(p_project_id, p_sub_company_id)` creates/opens a chat; participants = project owner company + that one counterpart company (`sync_project_sub_conversation_participants`).
- `emit_schedule_request_system_message` routes every schedule request/confirm/edit/reject/cancel message into the chat of the counterpart company involved, so subs never see other subs' traffic.
- Messages UI: project owners (GC/Guest) get an expandable project row listing connected subs; non-owners see a single row for their own chat.
- Posting rights in project chats: sub-company users at `basic` are read-only; `level_1` (Foreman) and above can post. GC/Guest and MOA always can.
- Deleting a project cascades and removes all of its project chats and messages (DM/group chats untouched).
