import { supabase } from '@/integrations/supabase/client';

interface SendNotificationParams {
  eventType: string;
  recipientEmails: string[];
  /** Users who should receive a push notification plus a People message. */
  recipientUserIds?: string[];
  /** Employee ids are resolved server-side so every scheduled employee is included,
   * even when their account has not logged in yet or their link needs repair. */
  employeeIds?: string[];
  /** @deprecated SMS is retired — kept so legacy callers still compile. */
  recipientPhones?: string[];
  recipientCompanyId?: string;
  variables: Record<string, string>;
  projectId?: string;
  /** The user whose action caused the notification; validated server-side. */
  senderUserId?: string;
  /** When true the push is bell-only (the message already lives in a chat). */
  skipMessage?: boolean;
}


/**
 * Best-effort failure logger. Writes a row to `notification_log` so silent
 * client-side or edge-function invocation errors become visible to operators.
 * Never throws — logging itself failing must not break the caller.
 */
const logInvocationFailure = async (
  channel: 'email' | 'push',
  eventType: string,
  recipient: string,
  recipientCompanyId: string | undefined,
  message: string,
) => {
  try {
    await supabase.from('notification_log').insert({
      event_type: eventType,
      channel,
      recipient_email: recipient,
      recipient_company_id: recipientCompanyId || null,
      subject: null,
      status: 'failed',
      error_message: `client_invoke_failed: ${message}`,
      metadata: {},
    } as any);
  } catch (e) {
    console.warn('notification_log invocation-failure insert failed', e);
  }
};

export const sendNotification = async ({
  eventType,
  recipientEmails,
  recipientUserIds,
  employeeIds,
  recipientCompanyId,
  variables,
  projectId,
  senderUserId,
  skipMessage,
}: SendNotificationParams) => {
  const results: { email?: any; push?: any } = {};

  if (recipientEmails.length > 0) {
    try {
      const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
          event_type: eventType,
          recipient_emails: recipientEmails,
          recipient_company_id: recipientCompanyId,
          project_id: projectId,
          variables,
        },
      });
      if (error) {
        console.error('[sendNotification] email invoke error', eventType, error);
        await logInvocationFailure('email', eventType, recipientEmails.join(','), recipientCompanyId, error.message || String(error));
        results.email = { success: false, error: error.message };
      } else {
        results.email = { success: true, data };
      }
    } catch (err: any) {
      console.error('[sendNotification] email invoke threw', eventType, err);
      await logInvocationFailure('email', eventType, recipientEmails.join(','), recipientCompanyId, err?.message || String(err));
      results.email = { success: false, error: err?.message };
    }
  }

  const hasPushRecipients = (recipientUserIds?.length ?? 0) > 0 || (employeeIds?.length ?? 0) > 0;
  if (hasPushRecipients) {
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: {
          event_type: eventType,
          recipient_user_ids: recipientUserIds || [],
          employee_ids: employeeIds || [],
          recipient_company_id: recipientCompanyId,
          project_id: projectId,
          variables,
          sender_user_id: senderUserId,
          skip_message: skipMessage,
        },
      });
      if (error) {
        console.error('[sendNotification] push invoke error', eventType, error);
        await logInvocationFailure('push', eventType, [...(recipientUserIds || []), ...(employeeIds || [])].join(','), recipientCompanyId, error.message || String(error));
        results.push = { success: false, error: error.message };
      } else {
        results.push = { success: true, data };
      }
    } catch (err: any) {
      console.error('[sendNotification] push invoke threw', eventType, err);
      await logInvocationFailure('push', eventType, [...(recipientUserIds || []), ...(employeeIds || [])].join(','), recipientCompanyId, err?.message || String(err));
      results.push = { success: false, error: err?.message };
    }
  }

  return { success: true, results };
};
