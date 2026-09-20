import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Building2 } from 'lucide-react';

interface CompanyOption {
  id: string;
  name: string;
  company_type: 'gc' | 'sub';
}

interface JoinExistingCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guestCompanyId: string | null;
  onSubmitted?: () => void;
}

const JoinExistingCompanyDialog = ({
  open,
  onOpenChange,
  guestCompanyId,
  onSubmitted,
}: JoinExistingCompanyDialogProps) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [merge, setMerge] = useState(true);
  const [canMerge, setCanMerge] = useState(false);
  const [guestProjectCount, setGuestProjectCount] = useState(0);
  const [guestSubCount, setGuestSubCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Reset state when opened
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId(null);
    setEmail(profile?.email || '');
    setPhone(profile?.phone || '');
    setMerge(true);
  }, [open, profile?.email, profile?.phone]);

  // Determine if user is the last member of guest company, plus counts
  useEffect(() => {
    if (!open || !guestCompanyId) return;
    (async () => {
      const { count: memberCount } = await supabase
        .from('user_roles')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', guestCompanyId);
      setCanMerge((memberCount ?? 0) <= 1);

      const { data: projs } = await supabase
        .from('projects')
        .select('id')
        .eq('company_id', guestCompanyId);
      setGuestProjectCount(projs?.length ?? 0);

      const projIds = (projs ?? []).map((p) => p.id);
      if (projIds.length > 0) {
        const { count: connCount } = await supabase
          .from('project_connections')
          .select('id', { count: 'exact', head: true })
          .in('project_id', projIds);
        const { count: gpcCount } = await supabase
          .from('guest_project_connections')
          .select('id', { count: 'exact', head: true })
          .eq('guest_company_id', guestCompanyId);
        setGuestSubCount((connCount ?? 0) + (gpcCount ?? 0));
      } else {
        setGuestSubCount(0);
      }
    })();
  }, [open, guestCompanyId]);

  // Load GC companies
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data, error } = await supabase.rpc('search_companies_for_onboarding', {
        search_term: '',
      });
      if (error) {
        console.error(error);
        return;
      }
      setCompanies(((data as CompanyOption[]) || []).filter((c) => c.company_type === 'gc'));
    })();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies.slice(0, 50);
    return companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [companies, search]);

  const handleSubmit = async () => {
    if (!selectedId) {
      toast({ title: 'Pick a company', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-join-existing-company', {
        body: {
          target_company_id: selectedId,
          update_email: email && email !== profile?.email ? email : null,
          update_phone: phone && phone !== (profile?.phone || '') ? phone : null,
          merge_on_approval: canMerge && merge,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({
        title: 'Request submitted',
        description: 'The main account holder of that company has been notified.',
      });
      onSubmitted?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'Could not submit request',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Join an Existing Company</DialogTitle>
          <DialogDescription>
            Send a request to merge your account into a registered GC company. The main account
            holder of that company will review and approve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Find your company</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search GC companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-48 overflow-auto border rounded-md divide-y">
              {filtered.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No companies found</div>
              ) : (
                filtered.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left p-2 flex items-center gap-2 hover:bg-accent ${
                      selectedId === c.id ? 'bg-accent' : ''
                    }`}
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{c.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <Label htmlFor="join-email">Work email (optional update)</Label>
              <Input
                id="join-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
              />
              <p className="text-xs text-muted-foreground">
                Use your company email if it's different from what you signed up with.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="join-phone">Work phone (optional update)</Label>
              <Input
                id="join-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {canMerge && guestProjectCount > 0 && (
            <div className="border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="merge"
                  checked={merge}
                  onCheckedChange={(v) => setMerge(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="merge" className="cursor-pointer">
                    Merge my Guest Account into the new company
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Carries over {guestProjectCount} project{guestProjectCount === 1 ? '' : 's'} and{' '}
                    {guestSubCount} subcontractor connection{guestSubCount === 1 ? '' : 's'} to the
                    new company. Your Guest Account will be removed after approval.
                  </p>
                </div>
              </div>
            </div>
          )}
          {!canMerge && (
            <p className="text-xs text-muted-foreground">
              Other users are still part of your Guest Account, so its projects and connections will
              stay with that account. The GC company can create new projects and connect to your
              subs.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !selectedId}>
            {loading ? 'Submitting...' : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JoinExistingCompanyDialog;
