import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Search, Database } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AddContactModal from './AddContactModal';
import SearchDirectoryModal from './SearchDirectoryModal';

interface Contact {
  id: string;
  name: string;
  job_title: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  contact_user_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStartChat: (userId: string) => void;
  ownerUserId?: string | null;
}

export default function ContactsModal({ open, onOpenChange, onStartChat, ownerUserId }: Props) {
  const { user } = useAuth();
  const owner = ownerUserId ?? user?.id ?? null;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const load = async () => {
    if (!owner) return;
    const { data } = await supabase
      .from('contacts')
      .select('id, name, job_title, company_name, phone, email, contact_user_id')
      .eq('owner_user_id', owner)
      .order('name');
    setContacts((data as any) || []);
  };

  useEffect(() => { if (open) load(); }, [open, owner]);

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.job_title, c.company_name, c.email, c.phone]
      .filter(Boolean)
      .some((v) => (v as string).toLowerCase().includes(q));
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contacts</DialogTitle>
          </DialogHeader>
          <Button onClick={() => setAddOpen(true)} variant="default" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" /> Add new contact
          </Button>
          <Button onClick={() => setSearchOpen(true)} variant="outline" size="sm" className="w-full">
            <Database className="h-4 w-4 mr-2" /> Search SSAA database
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..." className="pl-8" />
          </div>
          <ScrollArea className="max-h-80">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">No contacts</div>
            ) : (
              <div className="space-y-1">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => c.contact_user_id && onStartChat(c.contact_user_id)}
                    disabled={!c.contact_user_id}
                    className="w-full text-left p-2 rounded hover:bg-accent disabled:opacity-50"
                  >
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.job_title, c.company_name, c.email].filter(Boolean).join(' · ')}
                    </div>
                    {!c.contact_user_id && <div className="text-[10px] text-amber-600">Not on SSAA</div>}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <AddContactModal open={addOpen} onOpenChange={setAddOpen} onSaved={load} ownerUserId={owner} />
      <SearchDirectoryModal open={searchOpen} onOpenChange={setSearchOpen} onSaved={load} ownerUserId={owner} />
    </>
  );
}
