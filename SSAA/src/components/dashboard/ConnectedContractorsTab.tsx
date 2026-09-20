import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, UserPlus, ArrowLeftRight, Plus, X, Send, Share2, Copy, Link2, Mail } from 'lucide-react';
import EmailConnectionCodeDialog from './EmailConnectionCodeDialog';


interface Props {
  effectiveCompanyId: string;
  canManageConnections: boolean; // full or account_holder
}

interface ConnRow {
  id: string;
  company_a_id: string;
  company_b_id: string;
  main_company_id: string | null;
  status: 'pending' | 'accepted' | 'declined';
  initiated_by_company_id: string;
  proposed_main_company_id: string | null;
  role_change_request: any;
  other_company_id: string;
  other_company_name: string;
  my_role: 'main' | 'sub' | 'unset';
}

interface ProjectRow { id: string; name: string; connected?: boolean; connection_code?: string | null; company_id?: string | null; }
interface AssignmentRow { connection_id: string; project_id: string; shared: boolean; }
interface LinkRow { project_id: string; sub_company_id: string; owner_company_id: string; }
interface ContactRow { user_id: string; full_name: string | null; job_title: string | null; email: string | null; }


const ConnectedContractorsTab = ({ effectiveCompanyId, canManageConnections }: Props) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnRow[]>([]);
  const [ownedProjects, setOwnedProjects] = useState<ProjectRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [shareOpen, setShareOpen] = useState<Record<string, boolean>>({});
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [emailCodeCtx, setEmailCodeCtx] = useState<{
    connectionId: string;
    projectId: string;
    projectName: string;
    otherCompanyName: string;
    connectionCode: string | null;
  } | null>(null);


  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [proposedRole, setProposedRole] = useState<'main' | 'sub'>('main');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactQ, setContactQ] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [sendingRequest, setSendingRequest] = useState(false);


  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCompanyName, setInviteCompanyName] = useState('');
  const [inviteEmails, setInviteEmails] = useState<string[]>(['']);
  const [inviting, setInviting] = useState(false);

  const [swapOpenFor, setSwapOpenFor] = useState<ConnRow | null>(null);
  const [swapProposedMain, setSwapProposedMain] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: connsData }, { data: projData }, { data: projConnData }, { data: linkData }] = await Promise.all([
      supabase
        .from('contractor_connections')
        .select('*')
        .or(`company_a_id.eq.${effectiveCompanyId},company_b_id.eq.${effectiveCompanyId}`),
      supabase.from('projects').select('id, name, connection_code, company_id').eq('company_id', effectiveCompanyId),
      supabase.from('project_connections').select('project_id').eq('sub_company_id', effectiveCompanyId),
      supabase.rpc('get_contractor_connection_project_links', { p_acting_company_id: effectiveCompanyId } as any),
    ]);

    const connIds = ((connsData as any[]) || []).map((r) => r.id);
    const { data: assignData } = connIds.length
      ? await supabase
          .from('contractor_connection_project_assignments')
          .select('connection_id, project_id, shared')
          .in('connection_id', connIds)
      : { data: [] as any[] };


    const otherIds = new Set<string>();
    (connsData || []).forEach((r: any) => {
      otherIds.add(r.company_a_id === effectiveCompanyId ? r.company_b_id : r.company_a_id);
    });
    const { data: companies } = otherIds.size
      ? await supabase.from('companies').select('id, name').in('id', Array.from(otherIds))
      : { data: [] as any[] };
    const nameMap = new Map<string, string>((companies || []).map((c: any) => [c.id, c.name]));

    // Projects this company is connected to (owned by another company)
    const ownedIds = new Set<string>(((projData as any[]) || []).map(p => p.id));
    const connectedIds = ((projConnData as any[]) || [])
      .map(r => r.project_id)
      .filter(id => !ownedIds.has(id));
    const { data: connectedProjects } = connectedIds.length
      ? await supabase.from('projects').select('id, name, connection_code, company_id').in('id', connectedIds)
      : { data: [] as any[] };

    const rows: ConnRow[] = (connsData || []).map((r: any) => {
      const otherId = r.company_a_id === effectiveCompanyId ? r.company_b_id : r.company_a_id;
      const my_role: 'main' | 'sub' | 'unset' =
        !r.main_company_id ? 'unset'
        : r.main_company_id === effectiveCompanyId ? 'main' : 'sub';
      return {
        ...r,
        other_company_id: otherId,
        other_company_name: nameMap.get(otherId) || 'Unknown',
        my_role,
      };
    });
    setConnections(rows);
    setOwnedProjects([
      ...(((projData as any[]) || []).map(p => ({ ...p, connected: false }))),
      ...(((connectedProjects as any[]) || []).map(p => ({ ...p, connected: true }))),
    ]);
    setAssignments((assignData as any) || []);
    setLinks(((linkData as any[]) || []) as LinkRow[]);
    setLoading(false);
  }, [effectiveCompanyId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('cc-tab')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_connections' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contractor_connection_project_assignments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_connections' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // --- search / connect ---
  useEffect(() => {
    if (!searchOpen) return;
    if (searchQ.trim().length < 3) { setSearchResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    supabase.rpc('search_sub_companies_for_connection', {
      p_query: searchQ,
      p_acting_company_id: effectiveCompanyId,
    } as any).then(({ data }) => {
      if (!cancelled) {
        setSearchResults((data as any[]) || []);
        setSearching(false);
      }
    });
    return () => { cancelled = true; };
  }, [searchOpen, searchQ, effectiveCompanyId]);

  // Load the selectable people at the chosen company (RLS blocks cross-company profile reads).
  useEffect(() => {
    if (!selectedTargetId) { setContacts([]); setSelectedRecipients([]); setContactQ(''); return; }
    let cancelled = false;
    setContactsLoading(true);
    supabase.rpc('list_company_contact_candidates', {
      p_company_id: selectedTargetId,
      p_acting_company_id: effectiveCompanyId,
    } as any).then(({ data }) => {
      if (cancelled) return;
      setContacts((data as any[]) || []);
      setContactsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedTargetId, effectiveCompanyId]);

  const submitConnect = async () => {
    if (!selectedTargetId || selectedRecipients.length === 0) return;
    setSendingRequest(true);
    const { data: connectionId, error } = await supabase.rpc('create_contractor_connection_request', {
      p_other_company_id: selectedTargetId,
      p_proposed_role: proposedRole,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    if (error) {
      setSendingRequest(false);
      toast({ title: 'Failed to send request', description: error.message, variant: 'destructive' });
      return;
    }
    const { error: noticeError } = await supabase.functions.invoke('send-connection-request-notice', {
      body: {
        mode: 'request',
        connection_id: connectionId,
        acting_company_id: effectiveCompanyId,
        recipient_user_ids: selectedRecipients,
      },
    });
    setSendingRequest(false);
    if (noticeError) {
      toast({ title: 'Request sent, but the notification failed', description: noticeError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Request sent' });
    }
    setSearchOpen(false); setSelectedTargetId(null); setSearchQ('');
    setSelectedRecipients([]); setContacts([]);
    load();
  };

  const respond = async (conn: ConnRow, accept: boolean) => {
    const { error } = await supabase.rpc('respond_contractor_connection_request', {
      p_connection_id: conn.id,
      p_accept: accept,
      p_confirm_main_company_id: conn.proposed_main_company_id ?? null,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    if (!accept) {
      // Tell the requester their request was declined — email, push and a People message.
      const { error: noticeError } = await supabase.functions.invoke('send-connection-request-notice', {
        body: { mode: 'declined', connection_id: conn.id, acting_company_id: effectiveCompanyId },
      });
      if (noticeError) console.error('decline notice failed', noticeError);
    }
    toast({ title: accept ? 'Connection accepted' : 'Request declined' });
    load();
  };


  const submitSwap = async () => {
    if (!swapOpenFor || !swapProposedMain) return;
    const { data, error } = await supabase.rpc('request_or_confirm_role_swap', {
      p_connection_id: swapOpenFor.id,
      p_proposed_main_company_id: swapProposedMain,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({
      title: data === 'confirmed'
        ? 'Roles updated'
        : 'Request sent — the roles will change once the other company approves',
    });
    setSwapOpenFor(null);
    load();
  };

  const toggleProjectAssignment = async (conn: ConnRow, projectId: string, sharedFlag: boolean) => {
    const { error } = await supabase.rpc('set_contractor_connection_project', {
      p_connection_id: conn.id,
      p_project_id: projectId,
      p_shared: sharedFlag,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else load();
  };

  const unassignProject = async (conn: ConnRow, projectId: string) => {
    const { error } = await supabase.rpc('unset_contractor_connection_project', {
      p_connection_id: conn.id,
      p_project_id: projectId,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
    else load();
  };

  const isProjectLinked = (conn: ConnRow, p: ProjectRow) =>
    links.some(l =>
      l.project_id === p.id && (
        l.sub_company_id === conn.other_company_id ||
        (l.sub_company_id === effectiveCompanyId && l.owner_company_id === conn.other_company_id)
      )
    );

  const copyCode = (code?: string | null) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast({ title: 'Connection code copied' });
  };

  const submitLink = async (conn: ConnRow) => {
    const code = (codeInputs[conn.id] || '').trim();
    if (!code) return;
    setLinking(conn.id);
    const { data, error } = await supabase.rpc('link_contractor_connection_projects', {
      p_connection_id: conn.id,
      p_code: code,
      p_acting_company_id: effectiveCompanyId,
    } as any);
    setLinking(null);
    if (error) { toast({ title: 'Failed to connect project', description: error.message, variant: 'destructive' }); return; }
    const res = data as any;
    toast({
      title: res?.status === 'exists' ? 'Already connected' : 'Project connected',
      description: res?.project_name ? `"${res.project_name}" is now linked with ${conn.other_company_name}.` : undefined,
    });
    setCodeInputs(prev => ({ ...prev, [conn.id]: '' }));
    load();
  };



  const sendInvite = async () => {
    const emails = inviteEmails.map(e => e.trim()).filter(Boolean);
    if (!inviteCompanyName.trim() || emails.length === 0) {
      toast({ title: 'Company name and at least one email are required', variant: 'destructive' });
      return;
    }
    setInviting(true);
    const { error } = await supabase.functions.invoke('send-contractor-invite', {
      body: { invited_company_name: inviteCompanyName.trim(), recipient_emails: emails, acting_company_id: effectiveCompanyId },
    });
    setInviting(false);
    if (error) { toast({ title: 'Failed to send invite', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invite sent' });
    setInviteOpen(false); setInviteCompanyName(''); setInviteEmails(['']);
  };

  const filteredContacts = useMemo(() => {
    const q = contactQ.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
    );
  }, [contacts, contactQ]);

  const pending = useMemo(() => connections.filter(c => c.status === 'pending'), [connections]);

  const accepted = useMemo(() => connections.filter(c => c.status === 'accepted'), [connections]);
  // A declined connection is not a connection — those companies stay selectable.
  const alreadyConnectedIds = useMemo(
    () => new Set(connections.filter(c => c.status !== 'declined').map(c => c.other_company_id)),
    [connections],
  );

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Section A: connections list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your connected contractors</CardTitle>
          <CardDescription>
            Manage the sub companies your team collaborates with. Each connection has one Main Contractor (holds the GC contract) and one Subcontractor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.length === 0 && (
            <p className="text-sm text-muted-foreground">No contractor connections yet.</p>
          )}

          {pending.map((c) => {
            const waitingOnMe = c.initiated_by_company_id !== effectiveCompanyId;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-md p-3">
                <div>
                  <div className="font-medium">{c.other_company_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Pending —{' '}
                    {waitingOnMe
                      ? `they proposed you would be the ${c.proposed_main_company_id === effectiveCompanyId ? 'Main Contractor' : 'Subcontractor'}`
                      : 'awaiting their response'}
                  </div>
                </div>
                {waitingOnMe && canManageConnections && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => respond(c, false)}>Decline</Button>
                    <Button size="sm" onClick={() => respond(c, true)}>Accept</Button>
                  </div>
                )}
              </div>
            );
          })}

          {accepted.map((c) => {
            const connAssignments = assignments.filter(a => a.connection_id === c.id);
            return (
              <div key={c.id} className="border rounded-md p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{c.other_company_name}</div>
                    <Badge variant={c.my_role === 'main' ? 'default' : 'secondary'}>
                      You: {c.my_role === 'main' ? 'Main Contractor' : c.my_role === 'sub' ? 'Subcontractor' : 'Unset'}
                    </Badge>
                    <Badge variant="outline">
                      Them: {c.my_role === 'main' ? 'Subcontractor' : c.my_role === 'sub' ? 'Main Contractor' : 'Unset'}
                    </Badge>
                  </div>
                  {canManageConnections && (
                    <Button size="sm" variant="ghost" onClick={() => {
                      setSwapOpenFor(c);
                      setSwapProposedMain(c.my_role === 'main' ? c.other_company_id : effectiveCompanyId);
                    }}>
                      <ArrowLeftRight className="h-4 w-4 mr-1" /> Request role change
                    </Button>
                  )}
                </div>

                {c.role_change_request && (
                  c.role_change_request.requested_by_company_id === effectiveCompanyId ? (
                    <div className="text-xs bg-muted/40 rounded p-2 text-muted-foreground">
                      Role change request sent — the roles will change once {c.other_company_name} approves it.
                    </div>
                  ) : (
                    <div className="text-xs bg-muted/40 rounded p-2">
                      Role change requested: proposed Main Contractor is{' '}
                      <strong>
                        {c.role_change_request.proposed_main_company_id === effectiveCompanyId ? 'your company' : c.other_company_name}
                      </strong>
                      {canManageConnections && (
                        <Button
                          size="sm"
                          variant="link"
                          className="h-auto p-0 ml-2"
                          onClick={async () => {
                            const { error } = await supabase.rpc('request_or_confirm_role_swap', {
                              p_connection_id: c.id,
                              p_proposed_main_company_id: c.role_change_request.proposed_main_company_id,
                              p_acting_company_id: effectiveCompanyId,
                            } as any);
                            if (error) toast({ title: 'Failed', description: error.message, variant: 'destructive' });
                            else { toast({ title: 'Roles updated' }); load(); }
                          }}
                        >
                          Confirm
                        </Button>
                      )}
                    </div>
                  )
                )}

                {/* Section C — project sharing + assignments */}
                {canManageConnections && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Share &amp; connect projects with {c.other_company_name}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        className="h-9"
                        placeholder="Enter connection code"
                        value={codeInputs[c.id] || ''}
                        onChange={e => setCodeInputs(prev => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="h-9"
                        disabled={!((codeInputs[c.id] || '').trim()) || linking === c.id}
                        onClick={() => submitLink(c)}
                      >
                        {linking === c.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
                        Connect project
                      </Button>
                    </div>

                    {ownedProjects.length === 0 && (
                      <p className="text-xs text-muted-foreground">You don't have any projects yet.</p>
                    )}
                    {ownedProjects.map(p => {
                      const a = connAssignments.find(x => x.project_id === p.id);
                      const assigned = !!a;
                      const linked = isProjectLinked(c, p);
                      const shareKey = `${c.id}:${p.id}`;
                      return (
                        <div key={p.id} className="border rounded p-2 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm min-w-0 break-words">
                              {p.name}
                              {p.connected && <span className="text-muted-foreground"> — connected</span>}
                              {linked && (
                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                  Connected with {c.other_company_name}
                                </Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => setShareOpen(prev => ({ ...prev, [shareKey]: !prev[shareKey] }))}
                            >
                              <Share2 className="h-4 w-4 mr-1" /> Share Project
                            </Button>
                          </div>

                          {shareOpen[shareKey] && (
                            <div className="rounded bg-muted/40 p-2 space-y-1">
                              {p.connection_code ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Input readOnly value={p.connection_code} className="h-8 font-mono text-sm" />
                                    <Button size="sm" variant="ghost" className="h-8" onClick={() => copyCode(p.connection_code)}>
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    Send this code to {c.other_company_name} so they can connect this project. Names, addresses and other project details stay unchanged on both sides.
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8"
                                    onClick={() => setEmailCodeCtx({
                                      connectionId: c.id,
                                      projectId: p.id,
                                      projectName: p.name,
                                      otherCompanyName: c.other_company_name,
                                      connectionCode: p.connection_code ?? null,
                                    })}
                                  >
                                    <Mail className="h-4 w-4 mr-1" /> Email code
                                  </Button>
                                </>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">No connection code available for this project.</p>
                              )}

                            </div>
                          )}

                          {c.my_role === 'main' && (
                            <div className="flex flex-wrap items-center gap-3">
                              <label className={`flex items-center gap-2 text-xs ${linked ? '' : 'opacity-40'}`}>
                                <span className="text-muted-foreground">Assigned</span>
                                <Switch
                                  checked={assigned}
                                  disabled={!linked}
                                  onCheckedChange={(v) => {
                                    if (v) toggleProjectAssignment(c, p.id, a?.shared ?? true);
                                    else unassignProject(c, p.id);
                                  }}
                                />
                              </label>
                              <label className={`flex items-center gap-2 text-xs ${assigned && linked ? '' : 'opacity-40'}`}>
                                <span className="text-muted-foreground">Shared on schedule</span>
                                <Switch
                                  checked={a?.shared ?? false}
                                  disabled={!assigned || !linked}
                                  onCheckedChange={(v) => toggleProjectAssignment(c, p.id, v)}
                                />
                              </label>
                              {!linked && (
                                <span className="text-[11px] text-muted-foreground">
                                  Link this project with {c.other_company_name} first
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {c.my_role === 'sub' && (
                  <p className="text-xs text-muted-foreground">
                    {c.other_company_name} manages which projects your availability is shared on.
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Section B: connect / invite */}
      {canManageConnections && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connect a contractor</CardTitle>
            <CardDescription>Find another subcontractor on SSAA or invite one to join.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4 mr-1" /> Search SSAA
            </Button>
            <Button variant="outline" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1" /> Invite to SSAA
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search dialog */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Search subcontractors</DialogTitle>
            <DialogDescription>Search by company name or trade.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Search…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            <div className="max-h-64 overflow-auto border rounded">
              {searchQ.trim().length < 3 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">Type in the company name to search.</p>
              ) : (
                <>
                  {searching && <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>}
                  {!searching && searchResults.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground text-center">No matches.</p>
                  )}
                </>
              )}
              {!searching && searchResults.map((c: any) => {
                const already = alreadyConnectedIds.has(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    disabled={already}
                    onClick={() => setSelectedTargetId(c.id)}
                    className={`w-full text-left p-3 border-b hover:bg-accent transition-colors ${
                      selectedTargetId === c.id ? 'bg-accent' : ''
                    } ${already ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.trade || 'Subcontractor'}{c.is_guest ? ' · Guest' : ''}{already ? ' · Already connected' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedTargetId && (
              <div className="space-y-2 border-t pt-3">
                <Label>Your proposed role on this connection</Label>
                <Select value={proposedRole} onValueChange={(v: 'main' | 'sub') => setProposedRole(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main Contractor — I hold the GC contract</SelectItem>
                    <SelectItem value="sub">Subcontractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedTargetId && (
              <div className="space-y-2 border-t pt-3">
                <Label>Who should receive this request?</Label>
                <p className="text-xs text-muted-foreground">
                  Only the people you select get the email, the notification and the message.
                </p>
                <Input
                  placeholder="Search people by name or email…"
                  value={contactQ}
                  onChange={e => setContactQ(e.target.value)}
                />
                <div className="max-h-48 overflow-auto border rounded">
                  {contactsLoading && <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>}
                  {!contactsLoading && filteredContacts.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground text-center">No people found at this company.</p>
                  )}
                  {!contactsLoading && filteredContacts.map((p) => {
                    const checked = selectedRecipients.includes(p.user_id);
                    return (
                      <label key={p.user_id} className="flex items-start gap-3 p-3 border-b cursor-pointer hover:bg-accent">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => setSelectedRecipients(prev =>
                            v ? [...prev, p.user_id] : prev.filter(id => id !== p.user_id)
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{p.full_name || p.email}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {[p.job_title, p.email].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSearchOpen(false)}>Cancel</Button>
            <Button disabled={!selectedTargetId || selectedRecipients.length === 0 || sendingRequest} onClick={submitConnect}>
              {sendingRequest ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Send request
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a contractor to SSAA</DialogTitle>
            <DialogDescription>
              We'll email them an invite to join SSAA and connect with you. If they are already on SSAA, use Search SSAA instead.
            </DialogDescription>

          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Company name</Label>
              <Input value={inviteCompanyName} onChange={e => setInviteCompanyName(e.target.value)} placeholder="e.g., ACME Duct Install" />
            </div>
            <div>
              <Label>Email(s)</Label>
              <div className="space-y-2">
                {inviteEmails.map((em, i) => (
                  <div key={i} className="flex gap-2">
                    <Input type="email" value={em} onChange={e => {
                      const next = [...inviteEmails]; next[i] = e.target.value; setInviteEmails(next);
                    }} placeholder="name@company.com" />
                    {inviteEmails.length > 1 && (
                      <Button size="icon" variant="ghost" onClick={() => setInviteEmails(inviteEmails.filter((_, x) => x !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setInviteEmails([...inviteEmails, ''])}>
                  <Plus className="h-4 w-4 mr-1" /> Add another email
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={sendInvite} disabled={inviting}>
              {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role swap dialog */}
      <Dialog open={!!swapOpenFor} onOpenChange={(v) => { if (!v) setSwapOpenFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request role change</DialogTitle>
            <DialogDescription>
              Both companies must confirm before the roles switch. Pick who should be the Main Contractor.
            </DialogDescription>
          </DialogHeader>
          {swapOpenFor && (
            <Select value={swapProposedMain} onValueChange={setSwapProposedMain}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={effectiveCompanyId}>Your company as Main Contractor</SelectItem>
                <SelectItem value={swapOpenFor.other_company_id}>{swapOpenFor.other_company_name} as Main Contractor</SelectItem>
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwapOpenFor(null)}>Cancel</Button>
            <Button onClick={submitSwap}>Send request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {emailCodeCtx && (
        <EmailConnectionCodeDialog
          open={!!emailCodeCtx}
          onOpenChange={(v) => { if (!v) setEmailCodeCtx(null); }}
          connectionId={emailCodeCtx.connectionId}
          projectId={emailCodeCtx.projectId}
          projectName={emailCodeCtx.projectName}
          otherCompanyName={emailCodeCtx.otherCompanyName}
          connectionCode={emailCodeCtx.connectionCode}
          actingCompanyId={effectiveCompanyId}
        />
      )}

    </div>
  );
};

export default ConnectedContractorsTab;
