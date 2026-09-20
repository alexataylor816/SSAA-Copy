import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, Ban, Building2 } from 'lucide-react';

interface ManageCancellationRequestsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

interface Row {
  id: string;
  company_id: string;
  requested_by: string;
  created_at: string;
  company_name: string;
  company_type: string | null;
  is_guest: boolean | null;
  requester_name: string | null;
  requester_email: string | null;
}

const ManageCancellationRequestsModal = ({
  open,
  onOpenChange,
  onBack,
}: ManageCancellationRequestsModalProps) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    const { data: reqs, error } = await supabase
      .from('company_deletion_requests')
      .select('id, company_id, requested_by, created_at, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      toast({ title: 'Failed to load requests', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const companyIds = [...new Set((reqs || []).map((r) => r.company_id))];
    const userIds = [...new Set((reqs || []).map((r) => r.requested_by))];

    const [{ data: companies }, { data: profiles }] = await Promise.all([
      companyIds.length
        ? supabase.from('companies').select('id, name, company_type, is_guest').in('id', companyIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length
        ? supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const cMap = new Map((companies || []).map((c: any) => [c.id, c]));
    const pMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    setRows(
      (reqs || []).map((r) => {
        const c = cMap.get(r.company_id);
        const p = pMap.get(r.requested_by);
        return {
          id: r.id,
          company_id: r.company_id,
          requested_by: r.requested_by,
          created_at: r.created_at,
          company_name: c?.name || '(deleted company)',
          company_type: c?.company_type || null,
          is_guest: c?.is_guest || false,
          requester_name: p?.full_name || null,
          requester_email: p?.email || null,
        };
      })
    );
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchRequests();
  }, [open]);

  const handleApprove = async (row: Row) => {
    setDeletingId(row.id);
    try {
      const { error } = await supabase.functions.invoke('delete-company', {
        body: { company_id: row.company_id, request_id: row.id },
      });
      if (error) throw error;
      toast({ title: 'Company deleted', description: `${row.company_name} and all associated users were removed.` });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e: any) {
      toast({
        title: 'Failed to delete company',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  const confirmingRow = rows.find((r) => r.id === confirmingId) || null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {onBack && (
                <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <DialogTitle className="flex items-center gap-2">
                <Ban className="h-5 w-5" />
                Cancellation Requests
              </DialogTitle>
            </div>
            <DialogDescription>
              Approve to permanently delete the company account and all associated users.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No pending cancellation requests.
              </p>
            ) : (
              rows.map((r) => (
                <div
                  key={r.id}
                  className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold flex items-center gap-2 flex-wrap">
                        <span className="truncate">{r.company_name}</span>
                        {r.company_type && (
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                            {r.is_guest ? 'guest ' : ''}{r.company_type}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Requested by {r.requester_name || r.requester_email || 'unknown'}
                        {r.requester_email && r.requester_name ? ` (${r.requester_email})` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmingId(r.id)}
                    disabled={deletingId === r.id}
                    className="flex-shrink-0"
                  >
                    {deletingId === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Approve & Delete Company'
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmingId} onOpenChange={(o) => !o && setConfirmingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve cancellation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{confirmingRow?.company_name}</strong>, all of its
              users, projects, schedules, and subscription data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmingRow) handleApprove(confirmingRow);
              }}
              disabled={!!deletingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Company'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ManageCancellationRequestsModal;
