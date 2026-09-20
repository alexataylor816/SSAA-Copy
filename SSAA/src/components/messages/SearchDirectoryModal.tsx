import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface Match {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
}

export default function SearchDirectoryModal({
  open,
  onOpenChange,
  onSaved,
  ownerUserId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  ownerUserId?: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const owner = ownerUserId ?? user?.id ?? null;

  const reset = () => {
    setName(''); setPhone(''); setEmail(''); setMatches([]); setSearched(false);
  };

  const search = async () => {
    const q = (email || name || phone).trim();
    if (!q) return;
    setSearching(true);
    const { data, error } = await supabase.rpc('search_ssaa_users' as any, { p_query: q });
    setSearching(false);
    setSearched(true);
    if (error) {
      toast({ title: 'Search failed', description: error.message, variant: 'destructive' });
      return;
    }
    setMatches(((data as any) || []).filter((m: Match) => m.user_id !== owner));
  };

  const saveLinked = async (m: Match) => {
    if (!owner) return;
    const { error } = await supabase.from('contacts').insert({
      owner_user_id: owner,
      contact_user_id: m.user_id,
      name: m.full_name || m.email,
      company_name: m.company_name,
      phone: m.phone,
      email: m.email,
      source: 'ssaa_link',
    });
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Contact added' });
    onSaved();
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Search SSAA database</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <Button onClick={search} disabled={searching || !(email || name || phone).trim()}>
          {searching ? 'Searching...' : 'Search'}
        </Button>
        {searched && (
          matches.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-4">No matches found</div>
          ) : (
            <ScrollArea className="max-h-56">
              <div className="space-y-1">
                {matches.map((m) => (
                  <button key={m.user_id} onClick={() => saveLinked(m)} className="w-full text-left p-2 rounded hover:bg-accent border">
                    <div className="font-medium text-sm">{m.full_name || m.email}</div>
                    <div className="text-xs text-muted-foreground">{m.email} · {m.company_name || 'No company'}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
