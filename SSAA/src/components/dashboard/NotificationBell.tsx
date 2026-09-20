import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Bell, BellOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface NotificationRow {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  conversation_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface Props {
  /** The user whose notifications are shown (the real signed-in user). */
  userId: string | null | undefined;
  /** When true (operator impersonation), viewing does not clear the badge. */
  suppressReadReceipts?: boolean;
}

const NotificationBell = ({ userId, suppressReadReceipts = false }: Props) => {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { permission, subscribe, supported } = usePushNotifications(userId);

  const fetchItems = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      console.warn('[notifications] fetch failed', error);
      return;
    }
    setItems((data || []) as NotificationRow[]);
  }, [userId]);

  useEffect(() => {
    fetchItems();
    if (!userId) return;
    const channel = supabase
      .channel(`user_notifications_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
        () => fetchItems()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchItems]);

  const unread = items.filter(i => !i.read_at).length;

  const markRead = async (ids: string[]) => {
    if (suppressReadReceipts || ids.length === 0) return;
    await supabase
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
    fetchItems();
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      markRead(items.filter(i => !i.read_at).map(i => i.id));
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary-foreground/10 relative"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {supported && permission !== 'granted' && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => subscribe()}>
              <BellOff className="h-3 w-3 mr-1" /> Enable push
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y">
              {items.map(item => (
                <button
                  key={item.id}
                  className={`w-full text-left px-3 py-2 hover:bg-muted/60 ${item.read_at ? '' : 'bg-primary/5'}`}
                  onClick={() => {
                    setOpen(false);
                    navigate('/messages');
                  }}
                >
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  {item.body && (
                    <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{item.body}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
