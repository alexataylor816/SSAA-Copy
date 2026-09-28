import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Users, Share2 } from 'lucide-react';
import { format, startOfWeek, addDays } from 'date-fns';

interface Props {
  open: boolean;
  onClose: () => void;
  effectiveCompanyId: string;
  selectedProjectId: string; // never 'master' when the trigger opens
  selectedProjectName?: string;
  canManageShare: boolean; // Main Contractor + full/account_holder can toggle share
}

interface ConnRow {
  id: string;
  company_a_id: string;
  company_b_id: string;
  main_company_id: string | null;
  other_company_id: string;
  other_company_name: string;
  my_role: 'main' | 'sub' | 'unset';
}

interface EmpRow { id: string; name: string; job_title: string | null; }
interface AvailRow {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  all_projects: boolean | null;
}

const ConnectedContractorsViewerModal = ({
  open, onClose, effectiveCompanyId, selectedProjectId, selectedProjectName, canManageShare,
}: Props) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnRow[]>([]);
  const [assignments, setAssignments] = useState<{ connection_id: string; project_id: string; shared: boolean }[]>([]);
  const [selectedConn, setSelectedConn] = useState<ConnRow | null>(null);

  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [availabilities, setAvailabilities] = useState<AvailRow[]>([]);
  const [innerLoading, setInnerLoading] = useState(false);
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [savingToggle, setSavingToggle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: connRows } = await supabase
      .from('contractor_connections')
      .select('id, company_a_id, company_b_id, main_company_id, status')
      .eq('status', 'accepted')
      .or(`company_a_id.eq.${effectiveCompanyId},company_b_id.eq.${effectiveCompanyId}`);
    const rows = (connRows || []) as any[];
    const otherIds = rows.map(r => r.company_a_id === effectiveCompanyId ? r.company_b_id : r.company_a_id);
    let companyMap: Record<string, string> = {};
    if (otherIds.length) {
      const { data: cos } = await supabase.from('companies').select('id, name').in('id', otherIds);
      companyMap = Object.fromEntries((cos || []).map((c: any) => [c.id, c.name]));
    }
    const mapped: ConnRow[] = rows.map((r) => {
      const other = r.company_a_id === effectiveCompanyId ? r.company_b_id : r.company_a_id;
      let my_role: 'main' | 'sub' | 'unset' = 'unset';
      if (r.main_company_id === effectiveCompanyId) my_role = 'main';
      else if (r.main_company_id === other) my_role = 'sub';
      return {
        id: r.id,
        company_a_id: r.company_a_id,
        company_b_id: r.company_b_id,
        main_company_id: r.main_company_id,
        other_company_id: other,
        other_company_name: companyMap[other] || 'Unknown company',
        my_role,
      };
    });
    const { data: aRows } = await supabase
      .from('contractor_connection_project_assignments')
      .select('connection_id, project_id, shared')
      .eq('project_id', selectedProjectId);
    const projectAssignments = (aRows || []) as { connection_id: string; project_id: string; shared: boolean }[];
    setAssignments(projectAssignments);
    const sharedConnectionIds = new Set(projectAssignments.filter(a => a.shared).map(a => a.connection_id));
    setConnections(mapped.filter(conn => conn.my_role === 'main' && sharedConnectionIds.has(conn.id)));
    setLoading(false);
  }, [effectiveCompanyId, selectedProjectId]);

  useEffect(() => { if (open) { load(); setSelectedConn(null); } }, [open, load]);

  const loadContractor = useCallback(async (conn: ConnRow) => {
    setInnerLoading(true);
    const weekEnd = addDays(weekStart, 6);
    const startIso = format(weekStart, 'yyyy-MM-dd') + 'T00:00:00Z';
    const endIso = format(weekEnd, 'yyyy-MM-dd') + 'T23:59:59Z';
    const [assignmentRes, empRes, avRes] = await Promise.all([
      supabase.from('employee_project_assignments').select('employee_id').eq('project_id', selectedProjectId),
      supabase.from('employees').select('id, name, job_title').eq('company_id', conn.other_company_id),
      supabase.from('availability').select('id, employee_id, start_time, end_time, project_id, all_projects')
        .gte('start_time', startIso).lte('start_time', endIso),
    ]);
    const assignedIds = new Set((assignmentRes.data || []).map(row => row.employee_id));
    const emps = ((empRes.data || []) as EmpRow[]).filter(emp => assignedIds.has(emp.id));
    const empIds = new Set(emps.map(e => e.id));
    const avs = ((avRes.data || []) as AvailRow[]).filter(a => empIds.has(a.employee_id));
    setEmployees(emps);
    setAvailabilities(avs);
    setInnerLoading(false);
  }, [weekStart, selectedProjectId]);

  useEffect(() => {
    if (selectedConn) loadContractor(selectedConn);
  }, [selectedConn, weekStart, loadContractor]);

  const currentAssignment = useMemo(() => {
    if (!selectedConn) return null;
    return assignments.find(a => a.connection_id === selectedConn.id && a.project_id === selectedProjectId) || null;
  }, [assignments, selectedConn, selectedProjectId]);

  const isShared = !!currentAssignment?.shared;
  // Only Main Contractor of THIS connection can toggle share.
  const canToggleShare = canManageShare && selectedConn?.my_role === 'main';

  const handleToggleShare = async (checked: boolean) => {
    if (!selectedConn || !canToggleShare) return;
    setSavingToggle(true);
    try {
      const { error } = await supabase.rpc('set_contractor_connection_project' as any, {
        p_connection_id: selectedConn.id,
        p_project_id: selectedProjectId,
        p_shared: checked,
      });
      if (error) throw error;
      setAssignments((prev) => {
        const others = prev.filter(a => !(a.connection_id === selectedConn.id && a.project_id === selectedProjectId));
        return [...others, { connection_id: selectedConn.id, project_id: selectedProjectId, shared: checked }];
      });
      toast({
        title: checked ? 'Availability shared' : 'Availability unshared',
        description: checked
          ? `${selectedConn.other_company_name}'s personnel will appear on ${selectedProjectName || 'this project'}'s schedule.`
          : `${selectedConn.other_company_name}'s personnel removed from ${selectedProjectName || 'this project'}'s schedule.`,
      });
    } catch (e: any) {
      toast({ title: 'Failed to update sharing', description: e.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingToggle(false);
    }
  };

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedConn && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedConn(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            Connected Contractors
            {selectedProjectName && (
              <Badge variant="outline" className="ml-2 font-normal">{selectedProjectName}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {selectedConn
              ? `Viewing ${selectedConn.other_company_name}'s schedule (read-only).`
              : 'Select a connected contractor to view their availability for this project.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedConn ? (
            <ScrollArea className="h-[55vh] pr-2">
              {connections.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  No accepted contractor connections yet. Add one in Manage My Company Account → Connected Contractors.
                </div>
              ) : (
                <div className="space-y-2">
                  {connections.map((c) => {
                    const roleLabel = c.my_role === 'main' ? 'Subcontractor' : c.my_role === 'sub' ? 'Main Contractor' : 'Pending role';
                    const roleVariant = c.my_role === 'unset' ? 'outline' : 'secondary';
                    const shared = assignments.some(a => a.connection_id === c.id && a.project_id === selectedProjectId && a.shared);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedConn(c)}
                        className="w-full flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-medium">{c.other_company_name}</div>
                            <div className="text-xs text-muted-foreground">They are your {roleLabel}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {shared && <Badge variant="default" className="text-xs"><Share2 className="h-3 w-3 mr-1" />Shared</Badge>}
                          <Badge variant={roleVariant as any} className="text-xs">{roleLabel}</Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          ) : (
            <div className="flex flex-col h-[55vh]">
              {/* Toggle bar */}
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Copy & share availability to project schedule</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedConn.my_role === 'main'
                      ? `When on, ${selectedConn.other_company_name}'s personnel appear on this project's schedule so GCs can book them through you.`
                      : `Only the Main Contractor of this connection can toggle sharing.`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  {savingToggle && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <Switch checked={isShared} onCheckedChange={handleToggleShare} disabled={!canToggleShare || savingToggle} />
                </div>
              </div>

              {/* Week nav */}
              <div className="flex items-center justify-between mb-2">
                <Button variant="ghost" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                  ← Prev week
                </Button>
                <div className="text-sm font-medium">
                  Week of {format(weekStart, 'MMM d, yyyy')}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                  Next week →
                </Button>
              </div>

              {/* Roster + availability grid (read-only) */}
              <ScrollArea className="flex-1 border rounded-lg">
                {innerLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    No personnel found for {selectedConn.other_company_name}.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">Personnel</th>
                        {days.map((d) => (
                          <th key={d.toISOString()} className="text-center p-2 font-medium w-20">
                            <div>{format(d, 'EEE')}</div>
                            <div className="text-muted-foreground">{format(d, 'M/d')}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => (
                        <tr key={e.id} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{e.name}</div>
                            {e.job_title && <div className="text-muted-foreground">{e.job_title}</div>}
                          </td>
                          {days.map((d) => {
                            const dayStr = format(d, 'yyyy-MM-dd');
                            const slots = availabilities.filter(a =>
                              a.employee_id === e.id && a.start_time.startsWith(dayStr)
                            );
                            return (
                              <td key={d.toISOString()} className="p-1 text-center align-top">
                                {slots.length === 0 ? (
                                  <span className="text-muted-foreground/40">—</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    {slots.map(s => (
                                      <div key={s.id} className="rounded bg-primary/10 text-primary px-1 py-0.5">
                                        {format(new Date(s.start_time), 'H:mm')}–{format(new Date(s.end_time), 'H:mm')}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConnectedContractorsViewerModal;
