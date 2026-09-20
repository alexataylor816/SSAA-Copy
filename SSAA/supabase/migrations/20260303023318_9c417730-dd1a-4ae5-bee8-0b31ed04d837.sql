-- Add failed_attempts column to track brute force on individual codes
ALTER TABLE public.password_reset_codes ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0;