-- Enable realtime for schedule_requests table
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_requests;

-- Enable realtime for availability table  
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability;