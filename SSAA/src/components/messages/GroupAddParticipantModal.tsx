import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function GroupAddParticipantModal({
  open,
  onOpenChange,
  conversationId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<any[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setSearch('');
    supabase.from('contacts').select('contact_user_id, name, company_name').eq('owner_user_id', user.id).then(({ data }) => {
      setContacts(((data as any) || []).filter((c: any) => c.contact_user_id));
    });
    supabase.from('conversation_participants').select('user_id').eq('conversation_id', conversationId).then(({ data }) => {
      setExisting(new Set((data || []).map((p: any) => p.user_id)));
    });
  }, [open, user, conversationId]);

  const add = async (uid: string) => {
    const { data: prof } = await supabase.from('profiles').select('company_id').eq('user_id', uid).maybeSingle();
    const { error } = await supabase.from('conversation_participants').insert({
      conversation_id: conversationId,
      user_id: uid,
      company_id: prof?.company_id || null,
    });
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Added' });
    onAdded();
  };

  const filtered = contacts.filter((c) => !existing.has(c.contact_user_id) && (!search || c.name.toLowerCase().includes(search.toLowerCase())));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add participant</DialogTitle></DialogHeader>
        <Input placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <ScrollArea className="max-h-72">
          {filtered.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">No contacts to add</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c) => (
                <button key={c.contact_user_id} onClick={() => add(c.contact_user_id)} className="w-full text-left p-2 rounded hover:bg-accent">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.company_name}</div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
