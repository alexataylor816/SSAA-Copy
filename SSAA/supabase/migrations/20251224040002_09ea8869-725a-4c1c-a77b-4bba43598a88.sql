-- Create permission level enum
CREATE TYPE public.permission_level AS ENUM ('standard', 'partial', 'full', 'account_holder');

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  permission_level public.permission_level NOT NULL DEFAULT 'standard',
  is_company_creator BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, company_id)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Add phone column to profiles
ALTER TABLE public.profiles ADD COLUMN phone TEXT;

-- Security definer function to check if user is account holder for a company
CREATE OR REPLACE FUNCTION public.is_account_holder(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND permission_level = 'account_holder'
  )
$$;

-- Security definer function to get user's permission level for their company
CREATE OR REPLACE FUNCTION public.get_user_permission_level()
RETURNS public.permission_level
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT permission_level FROM public.user_roles
  WHERE user_id = auth.uid()
  AND company_id = get_user_company_id()
  LIMIT 1
$$;

-- Security definer function to check if user has at least partial permissions
CREATE OR REPLACE FUNCTION public.has_partial_or_higher()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND company_id = get_user_company_id()
      AND permission_level IN ('partial', 'full', 'account_holder')
  ) OR is_moa()
$$;

-- Security definer function to check if user has a specific permission level
CREATE OR REPLACE FUNCTION public.has_permission_level(p_user_id UUID, p_level public.permission_level)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND permission_level = p_level
  )
$$;

-- RLS Policies for user_roles table
-- Users can view their own role or roles in their company (for account holders)
CREATE POLICY "Users can view own roles or MOA can view all" 
ON public.user_roles 
FOR SELECT 
USING (
  user_id = auth.uid() 
  OR is_moa()
  OR (
    company_id = get_user_company_id() 
    AND (is_account_holder(company_id) OR has_partial_or_higher())
  )
);

-- Only account holders or MOA can insert roles
CREATE POLICY "Account holders or MOA can insert roles" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (
  is_moa() 
  OR user_id = auth.uid()
  OR is_account_holder(company_id)
);

-- Only account holders, full permission users, or MOA can update roles
CREATE POLICY "Account holders or MOA can update roles" 
ON public.user_roles 
FOR UPDATE 
USING (
  is_moa() 
  OR is_account_holder(company_id)
  OR (
    company_id = get_user_company_id() 
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = auth.uid() 
      AND ur.company_id = user_roles.company_id 
      AND ur.permission_level = 'full'
    )
  )
);

-- Only account holders or MOA can delete roles
CREATE POLICY "Account holders or MOA can delete roles" 
ON public.user_roles 
FOR DELETE 
USING (
  is_moa() 
  OR is_account_holder(company_id)
);

-- Trigger for updated_at
CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();