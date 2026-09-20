import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Recipient { name: string; email: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  projectId: string;
  projectName: string;
  otherCompanyName: string;
  actingCompanyId: string;
  connectionCode?: string | null;
}

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const EmailConnectionCodeDialog = ({
  open,
  onOpenChange,
  connectionId,
  projectId,
  projectName,
  otherCompanyName,
  actingCompanyId,
  connectionCode,
}: Props) => {
  const [recipients, setRecipients] = useState<Recipient[]>([{ name: '', email: '' }]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipients([{ name: '', email: '' }]);
      setMessage('');
    }
  }, [open]);

  const update = (i: number, patch: Partial<Recipient>) =>
    setRecipients(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const valid = recipients.filter(r => isValidEmail(r.email));

  const send = async () => {
    if (valid.length === 0) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-project-connection-code', {
      body: {
        connection_id: connectionId,
        project_id: projectId,
        acting_company_id: actingCompanyId,
        recipients: valid.map(r => ({ name: r.name.trim(), email: r.email.trim() })),
        custom_message: message.trim() || null,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      let detail = (data as any)?.error || error?.message || 'Unknown error';
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx.text === 'function') {
        try {
          const raw = await ctx.text();
          const parsed = JSON.parse(raw);
          if (parsed?.error) detail = parsed.error;
          else if (raw) detail = raw;
        } catch {
          /* keep fallback detail */
        }
      }
      toast.error(`Failed to send: ${detail}`);
      return;
    }
    const sent = (data as any)?.sent ?? valid.length;
    toast.success(`Connection code sent to ${sent} ${sent === 1 ? 'person' : 'people'} at ${otherCompanyName}.`);
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email connection code</DialogTitle>
          <DialogDescription>
            Send the code for <span className="font-medium text-foreground">{projectName}</span> to people at{' '}
            {otherCompanyName}.
            {connectionCode && (
              <> Code: <span className="font-mono text-foreground">{connectionCode}</span></>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Full name"
                  className="h-9"
                />
              </div>
              <div className="flex-1 min-w-0">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  value={r.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                  placeholder="name@company.com"
                  className="h-9"
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0"
                disabled={recipients.length === 1}
                onClick={() => setRecipients(prev => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove person"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setRecipients(prev => [...prev, { name: '', email: '' }])}
            disabled={recipients.length >= 20}
          >
            <Plus className="h-4 w-4 mr-1" /> Add another person
          </Button>

          <div>
            <Label className="text-xs text-muted-foreground">Message (optional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Add a short note to include in the email."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={send} disabled={sending || valid.length === 0}>
            <Mail className="h-4 w-4 mr-1" />
            {sending ? 'Sending...' : `Send${valid.length > 1 ? ` (${valid.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EmailConnectionCodeDialog;
