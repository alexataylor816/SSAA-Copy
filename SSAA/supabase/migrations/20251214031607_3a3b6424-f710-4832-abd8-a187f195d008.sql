-- Add trade column to companies table for subcontractors
ALTER TABLE public.companies ADD COLUMN trade TEXT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.companies.trade IS 'Trade type for subcontractor companies (e.g., Drywall, HVAC, Electrical)';