import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function usePendingCancellationCount() {
  const { isMOA } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isMOA) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const fetchCount = async () => {
      const { count: c } = await supabase
        .from('company_deletion_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (!cancelled) setCount(c ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel('cancellation-requests-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'company_deletion_requests' },
        () => { fetchCount(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isMOA]);

  return { count };
}
