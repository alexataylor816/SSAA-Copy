import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export default function AddContactModal({
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
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const owner = ownerUserId ?? user?.id ?? null;

  const reset = () => {
    setName(''); setJobTitle(''); setCompany(''); setPhone(''); setEmail('');
  };

  const saveManual = async () => {
    if (!owner || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('contacts').insert({
      owner_user_id: owner,
      name: name.trim(),
      job_title: jobTitle || null,
      company_name: company || null,
      phone: phone || null,
      email: email || null,
      source: 'manual',
    });
    setSaving(false);
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
          <DialogTitle>Add new contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Job title</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
          <div><Label>Company</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={saveManual} disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Save contact'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
