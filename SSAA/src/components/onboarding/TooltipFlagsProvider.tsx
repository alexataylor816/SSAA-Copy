import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type TooltipKey =
  | 'guided_tour_done'
  | 'project_dropdown'
  | 'manage_profile'
  | 'messages'
  | 'overlays'
  | 'manage_company_intro'
  | 'team_add_button'
  | 'sub_availability_overlay'
  | 'upload_schedule'
  | 'guest_billing'
  | 'guest_upgrade'
  | 'send_invite_first_click'
  | 'connected_contractors_dashboard'
  | 'connected_contractors_tab'
  | 'subcontractor_overlay'
  | 'tour_calendar_toggle'
  | 'tour_projects'
  | 'tour_master_schedule'
  | 'tour_team'
  | 'tour_company_account'
  | 'tour_messages'
  | 'connect_gc_sub'
  | 'calendar_monthly_scheduling'
  | 'calendar_weekly_scheduling';

interface Ctx {
  loaded: boolean;
  hasSeen: (k: TooltipKey) => boolean;
  markSeen: (k: TooltipKey) => Promise<void>;
}

const TooltipFlagsContext = createContext<Ctx | undefined>(undefined);

export const TooltipFlagsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setFlags({});
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('tooltip_flags, tour_seen')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const tf = ((data as any)?.tooltip_flags as Record<string, boolean>) || {};
      // Legacy compatibility: if tour_seen was ever true, treat guided_tour_done as seen.
      if ((data as any)?.tour_seen) tf.guided_tour_done = true;
      setFlags(tf);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id, profile?.id]);

  const hasSeen = useCallback((k: TooltipKey) => !!flags[k], [flags]);

  const markSeen = useCallback(async (k: TooltipKey) => {
    if (!user?.id) return;
    if (flags[k]) return;
    const next = { ...flags, [k]: true };
    setFlags(next);
    const patch: any = { tooltip_flags: next };
    if (k === 'guided_tour_done') patch.tour_seen = true;
    await supabase.from('profiles').update(patch).eq('user_id', user.id);
  }, [user?.id, flags]);

  return (
    <TooltipFlagsContext.Provider value={{ loaded, hasSeen, markSeen }}>
      {children}
    </TooltipFlagsContext.Provider>
  );
};

export const useTooltipFlags = () => {
  const ctx = useContext(TooltipFlagsContext);
  if (!ctx) throw new Error('useTooltipFlags must be used within TooltipFlagsProvider');
  return ctx;
};
