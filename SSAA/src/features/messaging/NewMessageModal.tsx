import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Check } from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  contact_user_id: string | null;
  company_name: string | null;
}

export default function NewMessageModal({
  open,
  onOpenChange,
  mode,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: 'dm' | 'group';
  onCreated: (convId: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setSelected(new Set()); setTitle(''); setSearch('');
    supabase.from('contacts').select('id, name, contact_user_id, company_name').eq('owner_user_id', user.id).then(({ data }) => {
      setContacts(((data as any) || []).filter((c: Contact) => c.contact_user_id));
    });
  }, [open, user]);

  const filtered = contacts.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else {
        if (mode === 'dm') next.clear();
        next.add(uid);
      }
      return next;
    });
  };

  const create = async () => {
    if (selected.size === 0) return;
    try {
      if (mode === 'dm') {
        const otherId = Array.from(selected)[0];
        const { data, error } = await supabase.rpc('get_or_create_dm_conversation' as any, { p_other_user_id: otherId });
        if (error) throw error;
        onCreated(data as any);
      } else {
        const { data, error } = await supabase.rpc('create_group_conversation' as any, {
          p_title: title || 'Group',
          p_user_ids: Array.from(selected),
        });
        if (error) throw error;
        onCreated(data as any);
      }
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'dm' ? 'New message' : 'New group chat'}</DialogTitle>
        </DialogHeader>
        {mode === 'group' && (
          <div><Label>Group name</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        )}
        <Input placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <ScrollArea className="max-h-72">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">No SSAA contacts. Add some from the Contacts list first.</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c) => {
                const active = selected.has(c.contact_user_id!);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.contact_user_id!)}
                    className={`w-full flex items-center justify-between p-2 rounded hover:bg-accent ${active ? 'bg-accent' : ''}`}
                  >
                    <div className="text-left">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.company_name}</div>
                    </div>
                    {active && <Check className="h-4 w-4" />}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={selected.size === 0 || (mode === 'group' && !title.trim())}>
            {mode === 'dm' ? 'Start chat' : 'Create group'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
