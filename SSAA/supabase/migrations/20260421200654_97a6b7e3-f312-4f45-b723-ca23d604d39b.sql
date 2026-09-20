-- Add notification templates for company join requests
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, placeholder_variables, description, is_active)
VALUES
  (
    'company_join_request_submitted',
    'email',
    'New request to join {company_name}',
    '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
       <h2 style="color: #1a1a1a;">New Join Request</h2>
       <p style="color: #555; font-size: 15px; line-height: 1.5;">
         <strong>{requester_name}</strong> ({requester_email}) has requested to join <strong>{company_name}</strong> on SSAA.
       </p>
       <p style="color: #555; font-size: 15px; line-height: 1.5;">
         To approve or deny this request, sign in and go to:
       </p>
       <p style="color: #1a1a1a; font-size: 15px; margin: 12px 0; padding: 12px 16px; background: #f4f4f5; border-left: 4px solid #3b82f6; border-radius: 4px;">
         Manage My Company Account → Team → Pending Join Requests
       </p>
       <p style="margin: 24px 0; text-align: center;">
         <a href="https://ssaainc.com" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Open SSAA</a>
       </p>
       <p style="color: #888; font-size: 13px;">If you did not expect this request, you can safely deny it.</p>
     </div>',
    ARRAY['company_name','requester_name','requester_email'],
    'Sent to a company''s account holder when a new user requests to join their company',
    true
  ),
  (
    'company_join_request_submitted',
    'sms',
    '',
    '{requester_name} ({requester_email}) requested to join {company_name} on SSAA. Sign in to approve or deny.',
    ARRAY['company_name','requester_name','requester_email'],
    'SMS to a company''s account holder when a new user requests to join their company',
    false
  );

-- Enable realtime for company_join_requests so red-dot updates propagate immediately
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_join_requests;
ALTER TABLE public.company_join_requests REPLICA IDENTITY FULL;