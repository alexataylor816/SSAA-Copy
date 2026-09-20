-- Create enum for company types
CREATE TYPE public.company_type AS ENUM ('gc', 'sub');

-- Create enum for user roles
CREATE TYPE public.user_role AS ENUM ('moa', 'admin', 'project_manager', 'superintendent', 'worker');

-- Create companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  company_type public.company_type NOT NULL,
  address TEXT,
  subscription_status TEXT DEFAULT 'trial',
  subscription_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '6 months'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create profiles table (links to auth.users)
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT,
  role public.user_role NOT NULL DEFAULT 'worker',
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connection_code TEXT UNIQUE DEFAULT substring(md5(random()::text), 1, 8),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create project_connections table (Subs connect to GC Projects)
CREATE TABLE public.project_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sub_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, sub_company_id)
);

-- Create tasks table
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assigned_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  color TEXT DEFAULT '#0284c7',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create employees table for subs
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create availability table
CREATE TABLE public.availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  all_projects BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create schedule_requests table
CREATE TABLE public.schedule_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  requesting_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sub_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  description TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_requests ENABLE ROW LEVEL SECURITY;

-- Create function to check if user is MOA
CREATE OR REPLACE FUNCTION public.is_moa()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'moa'
  )
$$;

-- Create function to get user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- RLS Policies for companies
CREATE POLICY "Anyone can view companies" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert companies" ON public.companies FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Company members or MOA can update" ON public.companies FOR UPDATE USING (
  public.is_moa() OR id = public.get_user_company_id()
);

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile or MOA can view all" ON public.profiles FOR SELECT USING (
  user_id = auth.uid() OR public.is_moa()
);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for projects
CREATE POLICY "View projects for own company or connected or MOA" ON public.projects FOR SELECT USING (
  public.is_moa() OR 
  company_id = public.get_user_company_id() OR
  EXISTS (
    SELECT 1 FROM public.project_connections 
    WHERE project_id = projects.id AND sub_company_id = public.get_user_company_id()
  )
);
CREATE POLICY "Company admins can create projects" ON public.projects FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id() OR public.is_moa()
);
CREATE POLICY "Company admins or MOA can update projects" ON public.projects FOR UPDATE USING (
  company_id = public.get_user_company_id() OR public.is_moa()
);
CREATE POLICY "Company admins or MOA can delete projects" ON public.projects FOR DELETE USING (
  company_id = public.get_user_company_id() OR public.is_moa()
);

-- RLS Policies for project_connections
CREATE POLICY "View connections for own company or MOA" ON public.project_connections FOR SELECT USING (
  public.is_moa() OR sub_company_id = public.get_user_company_id() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Insert connections" ON public.project_connections FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- RLS Policies for tasks
CREATE POLICY "View tasks for accessible projects" ON public.tasks FOR SELECT USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND company_id = public.get_user_company_id()) OR
  EXISTS (SELECT 1 FROM public.project_connections WHERE project_id = tasks.project_id AND sub_company_id = public.get_user_company_id())
);
CREATE POLICY "Create tasks for own projects" ON public.tasks FOR INSERT WITH CHECK (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Update tasks for own projects" ON public.tasks FOR UPDATE USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Delete tasks for own projects" ON public.tasks FOR DELETE USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND company_id = public.get_user_company_id())
);

-- RLS Policies for employees
CREATE POLICY "View employees for own company or MOA" ON public.employees FOR SELECT USING (
  public.is_moa() OR company_id = public.get_user_company_id()
);
CREATE POLICY "Manage employees for own company" ON public.employees FOR INSERT WITH CHECK (
  company_id = public.get_user_company_id() OR public.is_moa()
);
CREATE POLICY "Update employees for own company" ON public.employees FOR UPDATE USING (
  company_id = public.get_user_company_id() OR public.is_moa()
);
CREATE POLICY "Delete employees for own company" ON public.employees FOR DELETE USING (
  company_id = public.get_user_company_id() OR public.is_moa()
);

-- RLS Policies for availability
CREATE POLICY "View availability" ON public.availability FOR SELECT USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.employees WHERE id = employee_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Manage availability" ON public.availability FOR INSERT WITH CHECK (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.employees WHERE id = employee_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Update availability" ON public.availability FOR UPDATE USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.employees WHERE id = employee_id AND company_id = public.get_user_company_id())
);
CREATE POLICY "Delete availability" ON public.availability FOR DELETE USING (
  public.is_moa() OR
  EXISTS (SELECT 1 FROM public.employees WHERE id = employee_id AND company_id = public.get_user_company_id())
);

-- RLS Policies for schedule_requests
CREATE POLICY "View schedule requests" ON public.schedule_requests FOR SELECT USING (
  public.is_moa() OR requesting_company_id = public.get_user_company_id() OR sub_company_id = public.get_user_company_id()
);
CREATE POLICY "Create schedule requests" ON public.schedule_requests FOR INSERT WITH CHECK (
  public.is_moa() OR requesting_company_id = public.get_user_company_id()
);
CREATE POLICY "Update schedule requests" ON public.schedule_requests FOR UPDATE USING (
  public.is_moa() OR requesting_company_id = public.get_user_company_id() OR sub_company_id = public.get_user_company_id()
);

-- Create trigger for updating timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    CASE 
      WHEN NEW.email = 'lukepaaron@gmail.com' THEN 'moa'::public.user_role
      ELSE 'admin'::public.user_role
    END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();