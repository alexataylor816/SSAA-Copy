import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Link2, Users, Copy, Mail, Loader2, Trash2, UserPlus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import SubOverlayPanel from './SubOverlayPanel';
import MatrixEmployeeCard from './MatrixEmployeeCard';
import InviteGCWizard from './InviteGCWizard';
import AnchoredFirstClickTip from '@/components/onboarding/AnchoredFirstClickTip';
import { TOUR_COPY } from '@/components/onboarding/tourSteps';

interface Project {
  id: string;
  name: string;
  connection_code: string | null;
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  company_id?: string;
}

interface ConnectedSub {
  id: string;
  name: string;
  trade?: string | null;
}

interface AvailabilityRecord {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
}

interface RightPanelProps {
  viewMode: 'gc' | 'sub' | 'moa';
  projects: Project[];
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  employees: Employee[];
  onCreateProject: (name: string, address: string) => void;
  onAddEmployee: (name: string, email: string, jobTitle: string) => void;
  onDeleteEmployee: (id: string) => void;
  onConnectProject: (code: string) => void;
  onDeleteProject?: (id: string) => void;
  onDisconnectProject?: (id: string) => void;
  isGuestGC?: boolean;
  onGuestConnect?: (code: string) => void;
  isBasicUser?: boolean;
  hasLevel1OrHigher?: boolean;
  isAdminOrHigher?: boolean;
  connectedSubs?: ConnectedSub[];
  /** Sub-of-sub companies sharing availability with this main subcontractor (sub view). */
  subSubCompanies?: ConnectedSub[];
  allEmployees?: Employee[];
  allAvailabilities?: AvailabilityRecord[];
  currentDate?: Date;
  subOverlayEnabled?: boolean;
  onSubOverlayEnabledChange?: (enabled: boolean) => void;
  selectedOverlaySubIds?: string[];
  onSelectedOverlaySubIdsChange?: (ids: string[]) => void;
  companyId?: string;
  isReadOnlyOperator?: boolean;
  onTeamRefresh?: () => Promise<void> | void;
}

const RightPanel = ({
  viewMode,
  projects,
  selectedProject,
  setSelectedProject,
  employees,
  onCreateProject,
  onAddEmployee,
  onDeleteEmployee,
  onConnectProject,
  onDeleteProject,
  onDisconnectProject,
  isGuestGC = false,
  onGuestConnect,
  isBasicUser = false,
  hasLevel1OrHigher = true,
  isAdminOrHigher = false,
  connectedSubs = [],
  subSubCompanies = [],
  allEmployees = [],
  allAvailabilities = [],
  currentDate = new Date(),
  subOverlayEnabled = false,
  onSubOverlayEnabledChange,
  selectedOverlaySubIds = [],
  onSelectedOverlaySubIdsChange,
  companyId,
  isReadOnlyOperator = false,
  onTeamRefresh,
}: RightPanelProps) => {
  
  const [connectOpen, setConnectOpen] = useState(false);
  const [manageTeamOpen, setManageTeamOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [connectionCode, setConnectionCode] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeEmail, setNewEmployeeEmail] = useState('');
  const [newEmployeeJobTitle, setNewEmployeeJobTitle] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [subInviteEmail, setSubInviteEmail] = useState('');
  const [subInviteDialogOpen, setSubInviteDialogOpen] = useState(false);
  const [sendingSubInvite, setSendingSubInvite] = useState(false);
  const [canManageProjects, setCanManageProjects] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [guestConnectOpen, setGuestConnectOpen] = useState(false);
  const [guestConnectionCode, setGuestConnectionCode] = useState('');
  const [employeeToUnassign, setEmployeeToUnassign] = useState<Employee | null>(null);
  const [addTeamMemberOpen, setAddTeamMemberOpen] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addingMembers, setAddingMembers] = useState(false);
  const [freshAssignedIds, setFreshAssignedIds] = useState<Set<string> | null>(null);
  const { toast } = useToast();
  const { profile } = useAuth();

  useEffect(() => {
    if (!addTeamMemberOpen || selectedProject === 'master') {
      setFreshAssignedIds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('employee_project_assignments')
        .select('employee_id')
        .eq('project_id', selectedProject);
      if (!cancelled && !error) {
        setFreshAssignedIds(new Set((data || []).map(row => row.employee_id)));
      }
    })();
    return () => { cancelled = true; };
  }, [addTeamMemberOpen, selectedProject]);

  const isGCView = viewMode === 'gc' || viewMode === 'moa';
  const isSubView = viewMode === 'sub';

  const currentProject = projects.find(p => p.id === selectedProject);

  useEffect(() => {
    const checkPermission = async () => {
      const { data, error } = await supabase.rpc('can_manage_projects');
      if (!error && data !== null) {
        setCanManageProjects(data);
      }
    };
    checkPermission();
  }, []);

  const handleCopyCode = () => {
    if (currentProject?.connection_code) {
      navigator.clipboard.writeText(currentProject.connection_code);
      toast({
        title: "Copied!",
        description: "Connection code copied to clipboard.",
      });
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail || !currentProject?.connection_code || !currentProject?.name) return;

    // Parse multi-recipient input: comma, semicolon, space, or newline separated.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const rawEmails = inviteEmail
      .split(/[\s,;]+/)
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
    const uniqueEmails = Array.from(new Set(rawEmails));
    const validEmails = uniqueEmails.filter(e => emailRegex.test(e));
    const invalidEmails = uniqueEmails.filter(e => !emailRegex.test(e));

    if (validEmails.length === 0) {
      toast({
        title: "No valid email addresses",
        description: "Please enter at least one valid email.",
        variant: "destructive",
      });
      return;
    }

    setSendingInvite(true);
    try {
      let successCount = 0;
      const failures: string[] = [];
      for (const email of validEmails) {
        const { error } = await supabase.functions.invoke('send-project-invite', {
          body: {
            recipientEmail: email,
            projectName: currentProject.name,
            connectionCode: currentProject.connection_code,
            senderCompanyName: profile?.full_name || 'Your partner'
          }
        });
        if (error) {
          failures.push(email);
          console.error(`Failed to send invite to ${email}:`, error);
        } else {
          successCount++;
        }
      }

      const skipped = [...invalidEmails, ...failures];
      toast({
        title: `Sent ${successCount} of ${validEmails.length} invite${validEmails.length === 1 ? '' : 's'}`,
        description: skipped.length
          ? `Skipped: ${skipped.join(', ')}`
          : `Project invitation${successCount === 1 ? '' : 's'} sent successfully.`,
        variant: successCount === 0 ? 'destructive' : 'default',
      });

      if (successCount > 0) {
        setInviteEmail('');
        setInviteDialogOpen(false);
      }
    } catch (error: any) {
      console.error('Error sending invite:', error);
      toast({
        title: "Failed to send invite",
        description: error.message || "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setSendingInvite(false);
    }
  };

  const handleSendSubInvite = async () => {
    if (!subInviteEmail) return;
    
    setSendingSubInvite(true);
    try {
      const resolvedCompanyId = companyId || profile?.company_id;
      if (!resolvedCompanyId) throw new Error("No company ID found");

      // Get or create a guest_gc_link for this sub company
      let { data: existingLink } = await supabase
        .from('guest_gc_links')
        .select('*')
        .eq('sub_company_id', resolvedCompanyId)
        .maybeSingle();

      if (!existingLink) {
        const { data: newLink, error: linkError } = await supabase
          .from('guest_gc_links')
          .insert({ sub_company_id: resolvedCompanyId })
          .select()
          .single();
        if (linkError) throw linkError;
        existingLink = newLink;
      }

      // Get company name
      const { data: companyData } = await supabase
        .from('companies')
        .select('name')
        .eq('id', resolvedCompanyId)
        .single();

      const companyName = companyData?.name || 'A Subcontractor';
      // Use the production site URL so email links are not wrapped by Lovable's
      // preview auth-bridge (which forces recipients through a Lovable login page).
      const siteBaseUrl = 'https://ssaainc.com';
      const inviteUrl = `${siteBaseUrl}/?invite=${existingLink.invite_token}`;

      // Send using the gc_invite_to_ssaa template via edge function
      const { error } = await supabase.functions.invoke('send-project-invite', {
        body: {
          recipientEmail: subInviteEmail,
          projectName: 'SSAA Network',
          connectionCode: existingLink.connection_code,
          senderCompanyName: companyName,
          isSubToGCInvite: true,
          inviteUrl: inviteUrl,
        }
      });

      if (error) throw error;

      toast({
        title: "Invite sent!",
        description: `Invitation sent to ${subInviteEmail}`,
      });
      setSubInviteEmail('');
      setSubInviteDialogOpen(false);
    } catch (error: any) {
      console.error('Error sending invite:', error);
      toast({
        title: "Failed to send invite",
        description: error.message || "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setSendingSubInvite(false);
    }
  };

  const handleGuestConnect = async () => {
    if (!guestConnectionCode || !onGuestConnect) return;
    onGuestConnect(guestConnectionCode);
    setGuestConnectionCode('');
    setGuestConnectOpen(false);
  };

  return (
    <div className="w-full lg:w-64 space-y-4 flex-shrink-0 order-1 lg:order-none">
      {/* Project Selector */}
      <Card className="border-primary/20" data-tour="master-schedule">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AnchoredFirstClickTip
            tipKey="project_dropdown"
            copy={TOUR_COPY.project_dropdown.copy}
            className="block"
            as="div"
          >
            <div data-tour="projects-dropdown">
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="master">Master Schedule</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </AnchoredFirstClickTip>

          {(isGCView || isSubView) && (
            <>
              {(!isSubView || selectedProject === 'master') && (
              <AnchoredFirstClickTip tipKey="connect_gc_sub" copy={TOUR_COPY.connect_gc_sub.copy} as="div" className="block">
              <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full text-sm py-3 h-auto flex flex-col items-center gap-1 leading-tight">
                    {isSubView ? (
                      <span className="flex items-center gap-1">
                        <Link2 className="h-4 w-4 flex-shrink-0" />
                        Connect to Project
                      </span>
                    ) : (
                      <>
                        <span>Connect Subcontractor</span>
                        <span className="flex items-center gap-1">
                          <Link2 className="h-4 w-4 flex-shrink-0" />
                          To Project
                        </span>
                      </>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Connect Subcontractor To Project</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Connection Code</Label>
                      <Input
                        value={connectionCode}
                        onChange={(e) => setConnectionCode(e.target.value)}
                        placeholder="Enter 8-character code"
                      />
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => {
                        onConnectProject(connectionCode);
                        setConnectionCode('');
                        setConnectOpen(false);
                      }}
                      disabled={!connectionCode}
                    >
                      Connect
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </AnchoredFirstClickTip>
              )}

              {/* Delete Project button removed - now in Manage My Company Account */}
            </>
          )}


          {isSubView && (
            <>
              {selectedProject === 'master' && (companyId || profile?.company_id) && (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSubInviteDialogOpen(true)}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    Invite GC to SSAA
                  </Button>
                  <InviteGCWizard
                    open={subInviteDialogOpen}
                    onOpenChange={setSubInviteDialogOpen}
                    subCompanyId={(companyId || profile?.company_id)!}
                    subCompanyName={profile?.full_name || 'Your subcontractor'}
                  />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Subcontractor Availability Overlay - GC (including guest GC) */}
      {isGCView && connectedSubs.length > 0 && onSubOverlayEnabledChange && onSelectedOverlaySubIdsChange && (
        <SubOverlayPanel
          connectedSubs={connectedSubs}
          allEmployees={allEmployees}
          availabilities={allAvailabilities}
          currentDate={currentDate}
          overlayEnabled={subOverlayEnabled}
          onOverlayEnabledChange={onSubOverlayEnabledChange}
          selectedSubIds={selectedOverlaySubIds}
          onSelectedSubIdsChange={onSelectedOverlaySubIdsChange}
        />
      )}

      {/* Subcontractor Overlay - main subcontractor viewing shared sub-of-sub availability */}
      {!isGCView && subSubCompanies.length > 0 && onSubOverlayEnabledChange && onSelectedOverlaySubIdsChange && (
        <SubOverlayPanel
          connectedSubs={subSubCompanies}
          allEmployees={allEmployees}
          availabilities={allAvailabilities}
          currentDate={currentDate}
          overlayEnabled={subOverlayEnabled}
          onOverlayEnabledChange={onSubOverlayEnabledChange}
          selectedSubIds={selectedOverlaySubIds}
          onSelectedSubIdsChange={onSelectedOverlaySubIdsChange}
          title="Subcontractor Overlay"
          tipKey="subcontractor_overlay"
          tipCopy="Turn this on to see how many workers each connected subcontractor has available on any given day of the month."
        />
      )}

      {/* Share/Connect */}
      {/* Share Project — for GC, Guest GC, and Sub when a project is selected */}
      {currentProject && selectedProject !== 'master' && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              Share Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input 
                value={currentProject.connection_code || ''} 
                readOnly 
                className="font-mono"
              />
              <Button variant="outline" size="icon" onClick={handleCopyCode}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <AnchoredFirstClickTip
                tipKey="send_invite_first_click"
                copy="Click 'Send Invite' to email subcontractors. They will receive a unique connection code to instantly sync their team with your project schedule."
              >
                <Button variant="outline" className="w-full" onClick={() => setInviteDialogOpen(true)}>
                  <Mail className="h-4 w-4 mr-2" />
                  Send Invite
                </Button>
              </AnchoredFirstClickTip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Send Project Invite</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>{isSubView ? 'GC Email(s)' : 'Subcontractor Email(s)'}</Label>
                    <Textarea
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder={isSubView
                        ? 'gc1@company.com, gc2@company.com'
                        : 'contractor1@company.com, contractor2@company.com'}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter one or more emails separated by commas, spaces, or new lines.
                    </p>
                  </div>
                  {isSubView && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                      <div className="font-medium text-foreground mb-1">Inviting another contractor?</div>
                      <p className="text-muted-foreground">
                        This form invites <strong>General Contractors</strong>. To connect with another
                        subcontractor and share their team on this project, open{' '}
                        <span className="font-medium text-foreground">Manage My Company Account → Connected Contractors</span>.
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Each recipient will receive an email with the connection code and instructions to join <strong>{currentProject?.name}</strong>.
                  </p>

                  <Button
                    className="w-full"
                    onClick={handleSendInvite}
                    disabled={!inviteEmail.trim() || sendingInvite}
                  >
                    {sendingInvite ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4 mr-2" />
                        Send Invite
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      {/* Manage Team (Sub only) */}
      {isSubView && !isBasicUser && (selectedProject !== 'master' || isAdminOrHigher) && (
        <AnchoredFirstClickTip tipKey="tour_team" copy={TOUR_COPY.tour_team.copy} as="div" className="block" >
        <Card className="border-primary/20" data-tour="project-team">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {selectedProject === 'master' ? 'All Team Members' : 'Project Team'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dialog open={manageTeamOpen} onOpenChange={setManageTeamOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full">
                  {selectedProject === 'master' ? `View All Team Members (${employees.length})` : `View Project Team (${employees.length})`}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>{selectedProject === 'master' ? 'All Team Members' : 'Project Team'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="divide-y divide-border rounded-lg border border-border bg-card max-h-[40vh] overflow-y-auto">
                    {employees.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">No team members yet.</p>
                    )}
                    {employees.map((emp) => {
                      const initials = emp.name.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
                      return (
                        <div key={emp.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 transition-colors">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold flex-shrink-0">
                              {initials}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-base font-semibold text-foreground truncate leading-tight">{emp.name}</span>
                              {emp.job_title && (
                                <span className="text-sm text-muted-foreground truncate leading-tight mt-0.5">{emp.job_title}</span>
                              )}
                            </div>
                          </div>
                          {selectedProject !== 'master' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                              onClick={() => setEmployeeToUnassign(emp)}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {selectedProject !== 'master' && isAdminOrHigher && (
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={() => {
                        setSelectedToAdd(new Set());
                        setAddTeamMemberOpen(true);
                      }}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Add Team Members to Project
                    </Button>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {selectedProject !== 'master' && isAdminOrHigher && (
              <Dialog open={addTeamMemberOpen} onOpenChange={setAddTeamMemberOpen}>
                <DialogContent className="max-w-lg max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Add Team Members to Project</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    {(() => {
                      const assignedIds = freshAssignedIds ?? new Set(employees.map(e => e.id));
                      const available = allEmployees.filter(
                        e => !assignedIds.has(e.id) && (!companyId || e.company_id === companyId)
                      );
                      if (available.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground text-center py-6">
                            All team members are already assigned to this project.
                          </p>
                        );
                      }
                      return (
                        <>
                          <div className="divide-y divide-border rounded-lg border border-border bg-card max-h-[50vh] overflow-y-auto">
                            {available.map((emp) => {
                              const checked = selectedToAdd.has(emp.id);
                              return (
                                <label
                                  key={emp.id}
                                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors cursor-pointer"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => {
                                      setSelectedToAdd(prev => {
                                        const next = new Set(prev);
                                        if (v) next.add(emp.id);
                                        else next.delete(emp.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="text-sm font-semibold text-foreground truncate">{emp.name}</span>
                                    {emp.job_title && (
                                      <span className="text-xs text-muted-foreground truncate">{emp.job_title}</span>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                          <Button
                            className="w-full"
                            disabled={selectedToAdd.size === 0 || addingMembers}
                            onClick={async () => {
                              if (selectedToAdd.size === 0) return;
                              setAddingMembers(true);
                              try {
                                const rows = Array.from(selectedToAdd).map(empId => {
                                  const emp = available.find(e => e.id === empId);
                                  return {
                                    employee_id: empId,
                                    project_id: selectedProject,
                                    company_id: emp?.company_id || companyId || '',
                                  };
                                });
                                const { error } = await supabase
                                  .from('employee_project_assignments')
                                  .upsert(rows, {
                                    onConflict: 'employee_id,project_id',
                                    ignoreDuplicates: true,
                                  });
                                if (error) throw error;
                                toast({
                                  title: 'Team members added',
                                  description: `${rows.length} member${rows.length === 1 ? '' : 's'} added to this project.`,
                                });
                                setSelectedToAdd(new Set());
                                await onTeamRefresh?.();
                                setAddTeamMemberOpen(false);
                              } catch (error: any) {
                                toast({
                                  title: 'Error',
                                  description: error.message || 'Failed to add team members.',
                                  variant: 'destructive',
                                });
                              } finally {
                                setAddingMembers(false);
                              }
                            }}
                          >
                            {addingMembers ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Adding...
                              </>
                            ) : (
                              <>Add Selected ({selectedToAdd.size})</>
                            )}
                          </Button>
                        </>
                      );
                    })()}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
        </AnchoredFirstClickTip>
      )}

      {/* Unassign Employee Confirmation */}
      <AlertDialog open={!!employeeToUnassign} onOpenChange={(open) => !open && setEmployeeToUnassign(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {employeeToUnassign?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedProject === 'master'
                ? `This will remove ${employeeToUnassign?.name || 'this employee'} from all projects and the master schedule. They will no longer appear as available for any project. Their employee profile will NOT be deleted.`
                : `This will remove ${employeeToUnassign?.name || 'this employee'} from this project. They will no longer appear as available for this project. Their employee profile will NOT be deleted.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!employeeToUnassign) return;
                try {
                  if (selectedProject === 'master') {
                    const { error } = await supabase
                      .from('employee_project_assignments')
                      .delete()
                      .eq('employee_id', employeeToUnassign.id);
                    if (error) throw error;
                    toast({ title: "Employee removed", description: `${employeeToUnassign.name} has been removed from all projects.` });
                  } else {
                    const { error } = await supabase
                      .from('employee_project_assignments')
                      .delete()
                      .eq('employee_id', employeeToUnassign.id)
                      .eq('project_id', selectedProject);
                    if (error) throw error;
                    toast({ title: "Employee removed", description: `${employeeToUnassign.name} has been removed from this project.` });
                  }
                  setEmployeeToUnassign(null);
                  onTeamRefresh?.();
                } catch (error: any) {
                  toast({ title: "Error", description: error.message, variant: "destructive" });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RightPanel;
