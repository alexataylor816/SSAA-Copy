
-- Merge duplicate Sub-side projects for the TGF T1 guest GC into the canonical
-- "Test GC Functionality Test 1" project so the Sub list shows only one entry.

DO $$
DECLARE
  v_canon uuid := 'f0ceb27a-e6de-47c2-80f9-281fc3308d96';
  v_dup1  uuid := '7c628f19-4090-4bb3-8127-d811a85f4e7d'; -- Testing Guest Functionality Test 1
  v_dup2  uuid := 'e064660a-6e2e-4427-95aa-491d6a80b035'; -- TGF T1
  v_guest uuid := '4ecf8f54-bf97-4e13-9154-c037854d7c17';
  v_canon_conv uuid;
BEGIN
  -- Re-point any data rows still attached to the duplicates onto the canonical project
  UPDATE public.availability             SET project_id = v_canon WHERE project_id IN (v_dup1, v_dup2);
  UPDATE public.schedule_requests        SET project_id = v_canon WHERE project_id IN (v_dup1, v_dup2);
  UPDATE public.tasks                    SET project_id = v_canon WHERE project_id IN (v_dup1, v_dup2);

  -- Assignments: skip conflicts so we don't duplicate canonical rows
  DELETE FROM public.employee_project_assignments
    WHERE project_id IN (v_dup1, v_dup2)
      AND (employee_id, v_canon) IN (
        SELECT employee_id, project_id FROM public.employee_project_assignments WHERE project_id = v_canon
      );
  UPDATE public.employee_project_assignments SET project_id = v_canon WHERE project_id IN (v_dup1, v_dup2);

  DELETE FROM public.user_project_assignments
    WHERE project_id IN (v_dup1, v_dup2)
      AND (user_id, v_canon) IN (
        SELECT user_id, project_id FROM public.user_project_assignments WHERE project_id = v_canon
      );
  UPDATE public.user_project_assignments SET project_id = v_canon WHERE project_id IN (v_dup1, v_dup2);

  -- Move the guest GC's alias to the canonical project
  INSERT INTO public.project_aliases (project_id, company_id, name)
  VALUES (v_canon, v_guest, 'Testing Guest Functionality Test 1')
  ON CONFLICT (project_id, company_id) DO UPDATE
    SET name = EXCLUDED.name, updated_at = now();
  DELETE FROM public.project_aliases WHERE project_id IN (v_dup1, v_dup2);

  -- Re-parent conversation messages from duplicate conversations to the canonical one
  SELECT id INTO v_canon_conv FROM public.conversations WHERE project_id = v_canon LIMIT 1;
  IF v_canon_conv IS NOT NULL THEN
    UPDATE public.messages SET conversation_id = v_canon_conv
      WHERE conversation_id IN (
        SELECT id FROM public.conversations WHERE project_id IN (v_dup1, v_dup2)
      );
  END IF;
  DELETE FROM public.conversation_participants
    WHERE conversation_id IN (SELECT id FROM public.conversations WHERE project_id IN (v_dup1, v_dup2));
  DELETE FROM public.messages
    WHERE conversation_id IN (SELECT id FROM public.conversations WHERE project_id IN (v_dup1, v_dup2));
  DELETE FROM public.conversations WHERE project_id IN (v_dup1, v_dup2);

  -- Clean any project_connections on the duplicates (none expected but be safe)
  DELETE FROM public.project_connections WHERE project_id IN (v_dup1, v_dup2);

  -- Finally, delete the duplicate projects
  DELETE FROM public.projects WHERE id IN (v_dup1, v_dup2);

  -- Resync conversation participants for the canonical project so the guest GC is added
  PERFORM public.sync_project_conversation_participants(v_canon);
END$$;
