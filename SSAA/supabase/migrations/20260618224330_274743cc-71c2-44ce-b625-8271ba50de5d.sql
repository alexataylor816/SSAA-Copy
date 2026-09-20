ALTER TABLE public.schedule_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.schedule_requests SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL OR updated_at = created_at;

DROP TRIGGER IF EXISTS trg_schedule_requests_updated_at ON public.schedule_requests;
CREATE TRIGGER trg_schedule_requests_updated_at
BEFORE UPDATE ON public.schedule_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();