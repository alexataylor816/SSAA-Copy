
-- =============================================
-- PHASE 1: Notification System Tables
-- =============================================

-- notification_templates: Editable email/notification templates
CREATE TABLE public.notification_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  placeholder_variables TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read templates"
  ON public.notification_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "MOA can insert templates"
  ON public.notification_templates FOR INSERT
  WITH CHECK (is_moa());

CREATE POLICY "MOA can update templates"
  ON public.notification_templates FOR UPDATE
  USING (is_moa());

CREATE POLICY "MOA can delete templates"
  ON public.notification_templates FOR DELETE
  USING (is_moa());

CREATE TRIGGER update_notification_templates_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default email templates
INSERT INTO public.notification_templates (event_type, channel, subject, body_html, description, placeholder_variables) VALUES
  ('schedule_created', 'email', 'New Schedule Request: {project_name}', '<h2>New Schedule Request</h2><p>You have been scheduled by <strong>{requesting_company}</strong> for project <strong>{project_name}</strong>.</p><p><strong>Date:</strong> {scheduled_date}</p><p><strong>Time:</strong> {start_time} - {end_time}</p><p><strong>Description:</strong> {description}</p>', 'Sent when a GC creates a new schedule request for a sub', '{project_name,requesting_company,sub_company,scheduled_date,start_time,end_time,description}'),
  ('schedule_confirmed', 'email', 'Schedule Confirmed: {project_name}', '<h2>Schedule Confirmed</h2><p>The schedule for project <strong>{project_name}</strong> on <strong>{scheduled_date}</strong> has been confirmed by <strong>{confirming_company}</strong>.</p><p><strong>Time:</strong> {start_time} - {end_time}</p>', 'Sent when a sub confirms a schedule request', '{project_name,requesting_company,sub_company,confirming_company,scheduled_date,start_time,end_time}'),
  ('schedule_cancelled', 'email', 'Schedule Cancelled: {project_name}', '<h2>Schedule Cancelled</h2><p>The schedule for project <strong>{project_name}</strong> on <strong>{scheduled_date}</strong> has been cancelled by <strong>{cancelling_company}</strong>.</p>', 'Sent when either party cancels a schedule', '{project_name,requesting_company,sub_company,cancelling_company,scheduled_date,start_time,end_time}'),
  ('schedule_edited', 'email', 'Schedule Updated: {project_name}', '<h2>Schedule Updated</h2><p>The schedule for project <strong>{project_name}</strong> on <strong>{scheduled_date}</strong> has been edited by <strong>{editing_company}</strong>.</p><p><strong>New Time:</strong> {start_time} - {end_time}</p>', 'Sent when either party edits a confirmed schedule', '{project_name,requesting_company,sub_company,editing_company,scheduled_date,start_time,end_time}'),
  ('availability_set', 'email', 'Availability Updated: {employee_name}', '<h2>Availability Updated</h2><p><strong>{employee_name}</strong> from <strong>{sub_company}</strong> has updated their availability.</p>', 'Sent when a sub sets availability for an employee', '{employee_name,sub_company,project_name}');

-- notification_preferences: Per-company toggles for which events send emails
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(company_id, event_type, channel)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own company preferences"
  ON public.notification_preferences FOR SELECT
  USING (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "Users can insert own company preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "Users can update own company preferences"
  ON public.notification_preferences FOR UPDATE
  USING (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "MOA can delete preferences"
  ON public.notification_preferences FOR DELETE
  USING (is_moa());

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- notification_log: Record of all sent notifications
CREATE TABLE public.notification_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient_email TEXT,
  recipient_company_id UUID REFERENCES public.companies(id),
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MOA can read all logs"
  ON public.notification_log FOR SELECT
  USING (is_moa());

CREATE POLICY "Companies can read own logs"
  ON public.notification_log FOR SELECT
  USING (recipient_company_id = get_user_company_id());

CREATE POLICY "System can insert logs"
  ON public.notification_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL OR true);

-- =============================================
-- PHASE 3: Subscription Management Tables
-- =============================================

-- subscription_plans: Available subscription tiers
CREATE TABLE public.subscription_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_price_per_month NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_projects INTEGER NOT NULL DEFAULT 25,
  max_users INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  features JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plans"
  ON public.subscription_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "MOA can insert plans"
  ON public.subscription_plans FOR INSERT
  WITH CHECK (is_moa());

CREATE POLICY "MOA can update plans"
  ON public.subscription_plans FOR UPDATE
  USING (is_moa());

CREATE POLICY "MOA can delete plans"
  ON public.subscription_plans FOR DELETE
  USING (is_moa());

CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed subscription plans
INSERT INTO public.subscription_plans (name, display_name, monthly_price, annual_price_per_month, max_projects, max_users, sort_order) VALUES
  ('free_trial', 'Free Trial', 0, 0, 25, 30, 0),
  ('tier_1', 'Tier 1', 65, 60, 25, 30, 1),
  ('tier_2', 'Tier 2', 80, 75, 50, 100, 2),
  ('tier_3', 'Tier 3', 120, 100, 100, 250, 3),
  ('custom', 'Custom', 0, 0, 0, 0, 4);

-- discount_codes: Promo/discount codes
CREATE TABLE public.discount_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_percent NUMERIC(5,2),
  discount_amount NUMERIC(10,2),
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE,
  max_uses INTEGER,
  current_uses INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MOA can manage discount codes"
  ON public.discount_codes FOR ALL
  USING (is_moa());

CREATE POLICY "Authenticated users can read active codes"
  ON public.discount_codes FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = true);

CREATE TRIGGER update_discount_codes_updated_at
  BEFORE UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- company_subscriptions: Which plan each company is on
CREATE TABLE public.company_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  discount_code_id UUID REFERENCES public.discount_codes(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Companies can read own subscription"
  ON public.company_subscriptions FOR SELECT
  USING (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "MOA can insert subscriptions"
  ON public.company_subscriptions FOR INSERT
  WITH CHECK (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "MOA can update subscriptions"
  ON public.company_subscriptions FOR UPDATE
  USING (is_moa() OR company_id = get_user_company_id());

CREATE POLICY "MOA can delete subscriptions"
  ON public.company_subscriptions FOR DELETE
  USING (is_moa());

CREATE TRIGGER update_company_subscriptions_updated_at
  BEFORE UPDATE ON public.company_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
