import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const JOB_TITLE_PRESETS = [
  'Senior Project Manager',
  'Project Manager',
  'Assistant Project Manager',
  'Senior Superintendent',
  'Superintendent',
  'Assistant Superintendent',
  'Project Engineer',
  'Other',
] as const;

// Strict email format accepted by Resend/most providers (no parens, spaces, quoted locals).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

interface Invitee {
  full_name: string;
  email: string;
  phone: string;
  job_title_preset: string; // UI state: one of JOB_TITLE_PRESETS or ''
  job_title_custom: string; // UI state: free-text when preset === 'Other'
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subCompanyId: string;
  subCompanyName: string;
}

const empty = (): Invitee => ({
  full_name: '',
  email: '',
  phone: '',
  job_title_preset: '',
  job_title_custom: '',
});

const SITE_URL = 'https://ssaainc.com';

const resolveJobTitle = (inv: Invitee): string => {
  if (inv.job_title_preset === 'Other') return inv.job_title_custom.trim();
  return inv.job_title_preset.trim();
};

const InviteGCWizard = ({ open, onOpenChange, subCompanyId, subCompanyName }: Props) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [count, setCount] = useState(1);
  const [sharedCompanyName, setSharedCompanyName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [invitees, setInvitees] = useState<Invitee[]>([empty()]);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const handleCountChange = (n: number) => {
    const clamped = Math.max(1, Math.min(10, n));
    setCount(clamped);
    setInvitees((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push(empty());
      next.length = clamped;
      return next;
    });
  };

  const updateInvitee = (i: number, patch: Partial<Invitee>) => {
    setInvitees((prev) => prev.map((inv, idx) => (idx === i ? { ...inv, ...patch } : inv)));
  };

  const reset = () => {
    setStep(1);
    setCount(1);
    setSharedCompanyName('');
    setProjectName('');
    setProjectAddress('');
    setInvitees([empty()]);
  };

  const handleSend = async () => {
    if (!projectName.trim()) {
      toast({ title: 'Project name required', variant: 'destructive' });
      return;
    }
    if (!sharedCompanyName.trim()) {
      toast({ title: 'GC Company Name is required', variant: 'destructive' });
      return;
    }
    const validInvitees = invitees.filter((i) => i.email.trim() && i.full_name.trim());
    if (validInvitees.length === 0) {
      toast({ title: 'At least one invitee with name + email is required', variant: 'destructive' });
      return;
    }
    const badEmails = validInvitees
      .map((i) => i.email.trim())
      .filter((e) => !EMAIL_RE.test(e));
    if (badEmails.length > 0) {
      toast({
        title: 'Invalid email address',
        description: `Please fix: ${badEmails.join(', ')}. Email addresses can't contain parentheses or spaces.`,
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const companyName = sharedCompanyName.trim();

      // Ensure a sub-owned project exists for this batch so we have a real
      // connection_code that existing SSAA users can enter on their dashboard.
      let connectionCode = 'PREFILL';
      try {
        // HIGHEST PRIORITY: if this guest GC company already exists and is linked
        // to this Sub, reuse the project it's already aliased to. A guest GC
        // must have ONE Sub-side project, regardless of how many users we invite.
        let resolvedProjectId: string | null = null;
        const { data: existingGuestCo } = await supabase
          .from('companies')
          .select('id')
          .eq('is_guest', true)
          .eq('company_type', 'gc')
          .ilike('name', companyName)
          .maybeSingle();
        if (existingGuestCo?.id) {
          const { data: linked } = await supabase
            .from('guest_project_connections')
            .select('guest_company_id')
            .eq('guest_company_id', existingGuestCo.id)
            .eq('sub_company_id', subCompanyId)
            .maybeSingle();
          if (linked) {
            const { data: guestAliases } = await supabase
              .from('project_aliases')
              .select('project_id, projects:projects!inner(id, company_id)')
              .eq('company_id', existingGuestCo.id);
            const match = (guestAliases || []).find(
              (r: any) => r.projects?.company_id === subCompanyId,
            );
            if (match?.project_id) resolvedProjectId = match.project_id as string;
          }
        }

        // Pre-share edit trap: the Sub may have renamed this project locally
        // via project_aliases. Resolve via the Sub's alias next.
        if (!resolvedProjectId) {
          const { data: aliasMatch } = await supabase
            .from('project_aliases')
            .select('project_id')
            .eq('company_id', subCompanyId)
            .ilike('name', projectName.trim())
            .maybeSingle();
          if (aliasMatch?.project_id) resolvedProjectId = aliasMatch.project_id as string;
        }

        let existingProj: { id: string; connection_code: string | null } | null = null;
        if (resolvedProjectId) {
          const { data } = await supabase
            .from('projects')
            .select('id, connection_code')
            .eq('id', resolvedProjectId)
            .maybeSingle();
          existingProj = data;
        } else {
          const { data } = await supabase
            .from('projects')
            .select('id, connection_code')
            .eq('company_id', subCompanyId)
            .ilike('name', projectName.trim())
            .maybeSingle();
          existingProj = data;
        }

        if (existingProj?.connection_code) {
          connectionCode = existingProj.connection_code;
        } else {
          const { data: newProj } = await supabase
            .from('projects')
            .insert({
              company_id: subCompanyId,
              name: projectName.trim(),
              address: projectAddress.trim() || null,
            })
            .select('connection_code')
            .single();
          if (newProj?.connection_code) connectionCode = newProj.connection_code;
        }
      } catch (projErr) {
        console.error('Project lookup/create for connection code failed:', projErr);
      }

      let successCount = 0;
      let existingUserCount = 0;
      const failures: { email: string; reason: string }[] = [];
      for (const inv of validInvitees) {
        const jobTitle = resolveJobTitle(inv);
        const emailLower = inv.email.trim().toLowerCase();

        const { data: prefill, error: pfErr } = await supabase
          .from('gc_invite_prefills')
          .insert({
            sub_company_id: subCompanyId,
            gc_company_name: companyName,
            project_name: projectName.trim(),
            project_address: projectAddress.trim() || null,
            invitee_full_name: inv.full_name.trim(),
            invitee_email: emailLower,
            invitee_phone: inv.phone.trim() || null,
            invitee_job_title: jobTitle || null,
          })
          .select('invite_token')
          .single();

        if (pfErr || !prefill) {
          console.error('prefill insert error', pfErr);
          failures.push({ email: emailLower, reason: 'Could not create invite record' });
          continue;
        }

        const inviteUrl = `${SITE_URL}/invite-accept?token=${prefill.invite_token}`;

        const { data: sendData, error: sendErr } = await supabase.functions.invoke('send-project-invite', {
          body: {
            recipientEmail: emailLower,
            projectName: projectName.trim(),
            connectionCode,
            senderCompanyName: subCompanyName,
            isSubToGCInvite: true,
            inviteUrl,
          },
        });

        const ok = !sendErr && sendData?.success !== false;
        if (ok) {
          successCount++;
          if (sendData?.recipientIsExistingUser) existingUserCount++;
        } else {
          const reason =
            (sendData as any)?.error ||
            sendErr?.message ||
            'Email provider rejected the address';
          failures.push({ email: emailLower, reason });
        }
      }

      const failedDesc =
        failures.length > 0
          ? ` Failed: ${failures.map((f) => `${f.email} (${f.reason})`).join('; ')}.`
          : '';

      toast({
        title: `Sent ${successCount} invitation${successCount === 1 ? '' : 's'}${failures.length ? `, ${failures.length} failed` : ''}`,
        description:
          successCount > 0
            ? (existingUserCount > 0
                ? `${existingUserCount} recipient${existingUserCount === 1 ? ' already has' : 's already have'} an SSAA account and received a sign-in + connection code email. The rest received the full welcome email.`
                : 'Recipients can click the email link to set up their account in one step.') + failedDesc
            : `No invitations could be sent — please review the form and try again.${failedDesc}`,
        variant: failures.length > 0 ? 'destructive' : 'default',
      });

      if (successCount > 0 && failures.length === 0) {
        reset();
        onOpenChange(false);
      }


    } catch (e: any) {
      console.error(e);
      toast({ title: 'Failed to send', description: e.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite General Contractor(s) to SSAA</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>How many people would you like to invite?</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(e) => handleCountChange(parseInt(e.target.value || '1', 10))}
              />
              <p className="text-xs text-muted-foreground">Up to 10 people per batch.</p>
            </div>

            <div className="space-y-2">
              <Label>GC Company Name *</Label>
              <Input
                value={sharedCompanyName}
                onChange={(e) => setSharedCompanyName(e.target.value)}
                placeholder="Acme Construction"
              />
              <p className="text-xs text-muted-foreground">
                All invitees in this batch will be grouped under this company.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Project Name *</Label>
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Downtown Office Build" />
              </div>
              <div className="space-y-2">
                <Label>Project Address</Label>
                <Input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} placeholder="123 Main St" />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(2)} disabled={!projectName.trim() || !sharedCompanyName.trim()}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Fill in details for each invitee. Name and email are required.
            </p>

            {invitees.map((inv, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Invitee #{i + 1}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Full Name *</Label>
                    <Input value={inv.full_name} onChange={(e) => updateInvitee(i, { full_name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email *</Label>
                    <Input type="email" value={inv.email} onChange={(e) => updateInvitee(i, { email: e.target.value })} />
                    {inv.email.trim() && !EMAIL_RE.test(inv.email.trim()) && (
                      <p className="text-xs text-destructive">
                        Invalid email — no parentheses, spaces, or special characters allowed.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={inv.phone} onChange={(e) => updateInvitee(i, { phone: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Job Title</Label>
                    <Select
                      value={inv.job_title_preset}
                      onValueChange={(value) =>
                        updateInvitee(i, {
                          job_title_preset: value,
                          // clear custom field when switching away from Other
                          job_title_custom: value === 'Other' ? inv.job_title_custom : '',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a job title" />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_TITLE_PRESETS.map((title) => (
                          <SelectItem key={title} value={title}>
                            {title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {inv.job_title_preset === 'Other' && (
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-xs">Custom Job Title</Label>
                      <Input
                        value={inv.job_title_custom}
                        onChange={(e) => updateInvitee(i, { job_title_custom: e.target.value })}
                        placeholder="Enter job title"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={sending}>
                Back
              </Button>
              <Button onClick={handleSend} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send {invitees.filter((i) => i.email && i.full_name).length} Invitation
                    {invitees.filter((i) => i.email && i.full_name).length === 1 ? '' : 's'}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InviteGCWizard;
