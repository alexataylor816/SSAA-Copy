UPDATE public.subscription_plans SET max_users = 5 WHERE name = 'guest_gc';

INSERT INTO public.employees (company_id, name, email, phone, job_title, linked_user_id)
SELECT '4ecf8f54-bf97-4e13-9154-c037854d7c17'::uuid, 'Super Test 1', 'saaatest1+tgft1super@gmail.com', NULL, 'Superintendent', '88dacaee-98ad-4c49-a7b3-590c3d42c314'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.employees
  WHERE company_id = '4ecf8f54-bf97-4e13-9154-c037854d7c17'::uuid
    AND (linked_user_id = '88dacaee-98ad-4c49-a7b3-590c3d42c314'::uuid OR lower(email) = 'saaatest1+tgft1super@gmail.com')
);