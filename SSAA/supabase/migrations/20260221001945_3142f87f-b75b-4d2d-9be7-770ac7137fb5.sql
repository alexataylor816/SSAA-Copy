
-- 1. Add is_guest column to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- 2. Create guest_gc_links table
CREATE TABLE public.guest_gc_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE DEFAULT "substring"(md5((random())::text), 1, 16),
  connection_code text NOT NULL DEFAULT upper("substring"(md5((random())::text), 1, 8)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_gc_links ENABLE ROW LEVEL SECURITY;

-- Subs can read/create their own links
CREATE POLICY "Subs can read own links" ON public.guest_gc_links
  FOR SELECT USING (is_moa() OR sub_company_id = get_user_company_id());

CREATE POLICY "Subs can create own links" ON public.guest_gc_links
  FOR INSERT WITH CHECK (is_moa() OR sub_company_id = get_user_company_id());

-- Anyone authenticated can read by token (for invite flow)
CREATE POLICY "Authenticated can read by token" ON public.guest_gc_links
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "MOA can delete links" ON public.guest_gc_links
  FOR DELETE USING (is_moa());

-- 3. Create guest_project_connections table
CREATE TABLE public.guest_project_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sub_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guest_company_id, sub_company_id)
);

ALTER TABLE public.guest_project_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guest GCs can read own connections" ON public.guest_project_connections
  FOR SELECT USING (is_moa() OR guest_company_id = get_user_company_id());

CREATE POLICY "Subs can read connections to them" ON public.guest_project_connections
  FOR SELECT USING (sub_company_id = get_user_company_id());

CREATE POLICY "Authenticated can insert connections" ON public.guest_project_connections
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "MOA can update connections" ON public.guest_project_connections
  FOR UPDATE USING (is_moa());

CREATE POLICY "MOA can delete connections" ON public.guest_project_connections
  FOR DELETE USING (is_moa() OR guest_company_id = get_user_company_id());

-- 4. Add guest fields to schedule_requests
ALTER TABLE public.schedule_requests 
  ADD COLUMN IF NOT EXISTS guest_gc_company_name text,
  ADD COLUMN IF NOT EXISTS guest_gc_project_name text;

-- 5. Insert gc_invite_to_saaa notification template
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, description, placeholder_variables, is_active)
VALUES (
  'gc_invite_to_saaa',
  'email',
  'Join SAAA Network - Invitation from {sub_company_name}',
  '<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #1e3a5f; margin-bottom: 24px;">You''ve Been Invited to SAAA!</h1>
    
    <p style="font-size: 16px; color: #333; line-height: 1.6;">
      <strong>{sub_company_name}</strong> has invited you to join the SAAA Network to coordinate scheduling.
    </p>
    
    <div style="background-color: #e8f5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #2e7d32; margin-top: 0;">Option 1: Create a Full Company Account (Recommended)</h3>
      <ul style="color: #333; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>See <strong>all subcontractors</strong> on one project</li>
        <li>Schedule all subs in one place at one time</li>
        <li>No need to input project info for every request</li>
        <li>Full access to scheduling, availability, and project management</li>
      </ul>
    </div>
    
    <div style="background-color: #fff3e0; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #e65100; margin-top: 0;">Option 2: Create a Guest Account (Quick &amp; Free)</h3>
      <ul style="color: #333; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>Only schedule the specific sub who invited you</li>
        <li>Must input your project information with each schedule request</li>
        <li>Free to use — no subscription required</li>
        <li>Perfect for superintendents or project managers who just need to schedule one sub</li>
      </ul>
    </div>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="{invite_url}" style="background-color: #1e3a5f; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; display: inline-block;">Get Started</a>
    </div>
    
    <div style="background-color: #f4f4f4; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
      <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">Or use this Connection Code after creating your account:</p>
      <p style="font-size: 28px; font-weight: bold; color: #1e3a5f; letter-spacing: 4px; margin: 0; font-family: monospace;">{connection_code}</p>
    </div>
    
    <p style="font-size: 14px; color: #888; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">
      If you didn''t expect this invitation, you can safely ignore this email.
    </p>
    
    <p style="font-size: 12px; color: #aaa; margin-top: 24px;">— The SAAA Team</p>
  </div>',
  'Email sent to GCs when a subcontractor invites them to join SAAA. Explains the difference between full company account and guest account.',
  ARRAY['{sub_company_name}', '{invite_url}', '{connection_code}'],
  true
);

-- 6. Create trigger to auto-create "For GC''s With No Company Account" project for new sub companies
CREATE OR REPLACE FUNCTION public.auto_create_guest_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_type = 'sub' THEN
    INSERT INTO public.projects (company_id, name, address)
    VALUES (NEW.id, 'For GC''s With No Company Account', NEW.address);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER create_guest_project_for_sub
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_guest_project();
