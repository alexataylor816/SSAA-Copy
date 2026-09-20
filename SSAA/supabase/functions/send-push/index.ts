import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface PushRequest {
  event_type: string;
  recipient_user_ids?: string[];
  employee_ids?: string[];
  recipient_company_id?: string;
  project_id?: string;
  variables?: Record<string, string>;
  body_override?: string;
  title_override?: string;
  sender_user_id?: string;
  skip_message?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUUID = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

const stripHtml = (input: string) => input
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/p>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const isValidEmail = (email: unknown) => typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;

const fillTemplate = (text: string, variables: Record<string, string>) => {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return result;
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return response({ error: "Function configuration is incomplete." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);

    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return response({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const payload = await req.json() as PushRequest;
    const {
      event_type: eventType,
      recipient_user_ids: requestedUserIds = [],
      employee_ids: requestedEmployeeIds = [],
      recipient_company_id: recipientCompanyId,
      project_id: projectId,
      variables = {},
      body_override: bodyOverride,
      title_override: titleOverride,
      sender_user_id: requestedSenderId,
      skip_message: skipMessage = false,
    } = payload;

    if (typeof eventType !== "string" || eventType.length < 1 || eventType.length > 100) {
      return response({ error: "Invalid event_type" }, 400);
    }
    if (!Array.isArray(requestedUserIds) || !Array.isArray(requestedEmployeeIds)) {
      return response({ error: "Recipient ids must be arrays" }, 400);
    }
    if (requestedUserIds.length + requestedEmployeeIds.length === 0) {
      return response({ error: "At least one recipient is required" }, 400);
    }
    if (requestedUserIds.length + requestedEmployeeIds.length > 200) {
      return response({ error: "Recipient limit exceeded" }, 400);
    }
    if (requestedUserIds.some((id) => !isValidUUID(id)) || requestedEmployeeIds.some((id) => !isValidUUID(id))) {
      return response({ error: "Invalid recipient id" }, 400);
    }
    if (recipientCompanyId && !isValidUUID(recipientCompanyId)) return response({ error: "Invalid recipient_company_id" }, 400);
    if (projectId && !isValidUUID(projectId)) return response({ error: "Invalid project_id" }, 400);
    if (requestedSenderId && !isValidUUID(requestedSenderId)) return response({ error: "Invalid sender_user_id" }, 400);
    if (bodyOverride && (typeof bodyOverride !== "string" || bodyOverride.length > 4000)) return response({ error: "Invalid body_override" }, 400);

    // The caller may send as themselves. An explicit sender is honored only for an
    // authenticated operator (roster row or MOA profile) and must be a real user.
    // Anyone else silently falls back to sending as themselves — attribution is a
    // nicety and must never break notification delivery.
    let senderUserId = authData.user.id;
    if (requestedSenderId && requestedSenderId !== senderUserId) {
      const [{ data: operator }, { data: callerProfile }] = await Promise.all([
        admin.from("operators").select("user_id").eq("user_id", senderUserId).maybeSingle(),
        admin.from("profiles").select("role").eq("user_id", senderUserId).maybeSingle(),
      ]);
      const isOperator = !!operator || callerProfile?.role === "moa";
      if (isOperator) {
        const { data: senderProfile } = await admin.from("profiles").select("user_id").eq("user_id", requestedSenderId).maybeSingle();
        if (senderProfile) senderUserId = requestedSenderId;
        else console.warn("sender override ignored: sender profile not found", requestedSenderId);
      } else {
        console.warn("sender override ignored for non-operator caller", senderUserId);
      }
    }

    const { data: template } = await admin
      .from("notification_templates")
      .select("subject, body_html")
      .eq("event_type", eventType)
      .eq("channel", "push")
      .eq("is_active", true)
      .maybeSingle();
    if (!template && !bodyOverride) return response({ success: true, results: [] });

    const employeeIds = [...new Set(requestedEmployeeIds)];
    const { data: employeeRows, error: employeeError } = employeeIds.length
      ? await admin.from("employees").select("id, name, email, company_id, linked_user_id").in("id", employeeIds)
      : { data: [], error: null };
    if (employeeError) throw employeeError;

    const users = new Map<string, { id: string; name: string; email: string | null; employeeId: string | null; companyId: string | null }>();
    for (const id of requestedUserIds) users.set(id, { id, name: "there", email: null, employeeId: null, companyId: null });

    // Employee accounts are provisioned when the employee is created. This delivery
    // path only repairs the durable link; it never silently creates auth users.
    for (const employee of employeeRows || []) {
      const linkedUserId = employee.linked_user_id as string | null;
      const email = isValidEmail(employee.email) ? normalizeEmail(employee.email) : null;
      if (linkedUserId) {
        const { data: profile } = await admin.from("profiles").select("full_name, email").eq("user_id", linkedUserId).maybeSingle();
        users.set(linkedUserId, {
          id: linkedUserId,
          name: profile?.full_name || employee.name || "there",
          email: profile?.email || email,
          employeeId: employee.id,
          companyId: employee.company_id,
        });
      } else {
        console.error("Scheduled employee has no linked account; provisioning must be repaired from employee management", employee.id);
      }
    }

    // Resolve project display using the recipient company where available.
    const baseVariables: Record<string, string> = { ...variables };
    if (projectId && recipientCompanyId) {
      const { data: display } = await admin.rpc("resolve_project_display", {
        p_project_id: projectId,
        p_company_id: recipientCompanyId,
      });
      const row = Array.isArray(display) ? display[0] : display;
      if (row?.name) baseVariables.project_name = row.name;
      if (row?.address) baseVariables.project_address = row.address;
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@ssaainc.com";
    let webPushReady = false;
    if (vapidPublic && vapidPrivate) {
      try { webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate); webPushReady = true; } catch (error) { console.error("VAPID setup failed", error); }
    }

    const results: unknown[] = [];
    for (const recipient of users.values()) {
      const recipientVariables = { ...baseVariables, recipient_name: recipient.name };
      const messageBody = stripHtml(fillTemplate(bodyOverride || template?.body_html || "", recipientVariables));
      const pushTitle = fillTemplate(titleOverride || template?.subject || "Schedule update", recipientVariables);
      const pushBody = messageBody.length > 180 ? `${messageBody.slice(0, 177)}...` : messageBody;
      let conversationId: string | null = null;
      let messageCreated = false;

      try {
        if (!skipMessage && recipient.id !== senderUserId) {
          const { data: createdConversation, error: conversationError } = await admin.rpc("get_or_create_dm_conversation_between", {
            p_sender_user_id: senderUserId,
            p_recipient_user_id: recipient.id,
          });
          if (conversationError) throw conversationError;
          conversationId = createdConversation as string;
          const { error: messageError } = await admin.from("messages").insert({
            conversation_id: conversationId,
            sender_user_id: senderUserId,
            body: messageBody,
            // `messages_kind_check` only allows 'user' plus the system_* kinds.
            // Anything else (e.g. 'text') is rejected and the People message is lost.
            kind: "user",
            metadata: { source: "push_notification", event_type: eventType, project_id: projectId || null, employee_id: recipient.employeeId },
          });
          if (messageError) throw messageError;

          messageCreated = true;
        }

        const { error: notificationError } = await admin.from("user_notifications").insert({
          user_id: recipient.id,
          event_type: eventType,
          title: pushTitle,
          body: pushBody,
          conversation_id: conversationId,
          project_id: projectId || null,
          metadata: { variables: recipientVariables, employee_id: recipient.employeeId, sender_user_id: senderUserId },
        });
        if (notificationError) throw notificationError;

        let devicesSent = 0;
        if (webPushReady) {
          const { data: subscriptions } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", recipient.id);
          for (const subscription of subscriptions || []) {
            try {
              await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: pushTitle, body: pushBody, conversation_id: conversationId, event_type: eventType }));
              devicesSent += 1;
            } catch (pushError: any) {
              if (pushError?.statusCode === 404 || pushError?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", subscription.id);
              console.error("web push delivery failed", pushError?.statusCode, pushError?.message);
            }
          }
        }

        await admin.from("notification_log").insert({
          event_type: eventType,
          channel: "push",
          recipient_email: recipient.email || recipient.id,
          recipient_company_id: recipient.companyId || recipientCompanyId || null,
          subject: pushTitle,
          status: !skipMessage && !messageCreated ? "sent-no-message" : (recipient.employeeId && recipient.email ? "linked-and-sent" : "sent"),
          metadata: { employee_id: recipient.employeeId, user_id: recipient.id, conversation_id: conversationId, message_created: messageCreated, devices: devicesSent, sender_user_id: senderUserId, variables: recipientVariables },
        });
        results.push({ user_id: recipient.id, employee_id: recipient.employeeId, success: true, conversation_id: conversationId, devices: devicesSent });
      } catch (error: any) {
        console.error("personnel notification failed", recipient.id, error);
        await admin.from("notification_log").insert({
          event_type: eventType,
          channel: "push",
          recipient_email: recipient.email || recipient.id,
          recipient_company_id: recipient.companyId || recipientCompanyId || null,
          subject: pushTitle,
          status: "failed",
          error_message: error?.message || String(error),
          metadata: { employee_id: recipient.employeeId, user_id: recipient.id, conversation_id: conversationId, message_created: messageCreated, sender_user_id: senderUserId, variables: recipientVariables },
        });
        results.push({ user_id: recipient.id, employee_id: recipient.employeeId, success: false, error: error?.message || String(error) });
      }
    }

    return response({ success: true, results });
  } catch (error: any) {
    console.error("Error in send-push function", error);
    return response({ success: false, error: error?.message || "Notification delivery failed" }, 500);
  }
});
