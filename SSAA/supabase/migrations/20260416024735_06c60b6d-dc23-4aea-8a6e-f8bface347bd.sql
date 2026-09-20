
-- Drop the function and its dependent trigger with CASCADE
DROP FUNCTION IF EXISTS public.auto_create_guest_project() CASCADE;

-- Delete existing "Customers Calendar" projects and related data
DELETE FROM public.employee_project_assignments
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.user_project_assignments
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.project_connections
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.tasks
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.schedule_requests
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.availability
WHERE project_id IN (SELECT id FROM public.projects WHERE name = 'Customers Calendar');

DELETE FROM public.projects WHERE name = 'Customers Calendar';
