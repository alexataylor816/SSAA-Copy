import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { dateFnsLocale } from "@/i18n/runtime";

/** Port of Lovable's NotificationBell. Push-notification opt-in is not ported. */

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get<{ notifications: Notification[] }>("/notifications");
      setItems(res.notifications);
    } catch {
      // Keep whatever is already showing.
    }
  }, [userId]);

  useEffect(() => {
    void fetchItems();
    if (!userId) return;
    const channel = supabase
      .channel(`user_notifications_${userId}`)
      .on(EVENT.notificationCreated, () => void fetchItems())
      .subscribe();
    return () => channel.unsubscribe();
  }, [userId, fetchItems]);

  const unread = items.filter((i) => !i.readAt).length;

  // As in the original: opening the bell marks everything shown as read.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    const ids = items.filter((i) => !i.readAt).map((i) => i.id);
    if (next && ids.length) {
      void api.post("/notifications/read", { ids }).then(fetchItems);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-10 w-10 p-0 text-primary-foreground hover:bg-primary-foreground/10"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] bg-card p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
        </div>
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`relative w-full py-2.5 pl-6 pr-3 text-left hover:bg-muted/30 ${item.readAt ? "" : "bg-primary/5"}`}
                  onClick={() => {
                    setOpen(false);
                    if (item.link) navigate(item.link);
                  }}
                >
                  {!item.readAt && <span className="absolute left-2.5 top-[1.05rem] h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                  <div className="truncate text-sm font-medium">{item.title}</div>
                  {item.body && (
                    <div className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{item.body}</div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: dateFnsLocale() })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
