-- Add 'draft' status support for schedule requests (no schema change needed, just using status field)
-- Rejected requests should be kept in DB but shown differently

-- No schema changes needed, status field already supports: 'pending', 'confirmed', 'rejected', 'draft'
-- Just documenting that we'll now use 'draft' for AI recommendations and GC editable requests