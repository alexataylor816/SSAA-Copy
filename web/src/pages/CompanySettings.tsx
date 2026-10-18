import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/toaster";
import TeamProfilesDialog from "@/components/TeamProfilesDialog";
import ConnectedCompaniesCard from "@/components/ConnectedCompaniesCard";
import MobileTabBar from "@/components/dashboard/MobileTabBar";
import TimesheetDownloadCard from "@/components/TimesheetDownloadCard";
import { ArrowLeft, RefreshCw, UserPlus } from "lucide-react";
import InviteShare from "@/components/InviteShare";
import { companyJoinUrl } from "@/lib/share";

const PERMISSION_LEVELS = ["basic", "standard", "level_1", "partial", "full", "account_holder"] as const;

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUserId: string | null;
  employeeNumber?: string | null;
}

interface Member {
  userId: string;
  email: string;
  fullName: string | null;
  permissionLevel: string;
  isCompanyCreator: boolean;
}

interface Project {
  id: string;
  name: string;
  address: string | null;
  companyId: string;
  connectionCode: string;
}

/** `GET /companies/:id/employees` already answers in camelCase. */
interface Employee {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUserId: string | null;
}

export default function CompanySettings() {
  const { user, isAccountHolder, permissionLevel, isMOA } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId ?? null;

  const [company, setCompany] = useState<{ id: string; name: string; companyType: string; trade: string | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [aliases, setAliases] = useState<Record<string, { name: string; address: string }>>({});
  const [joinCode, setJoinCode] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const canManageProjects = isMOA || permissionLevel === "full" || permissionLevel === "account_holder";

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    try {
      const [companyRes, membersRes, employeesRes, projectsRes, aliasesRes] = await Promise.all([
        supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
        api.get<{ members: Member[] }>(`/companies/${companyId}/members`),
        api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`),
        api.get<{ projects: Project[] }>("/projects"),
        supabase.from("project_aliases").select("*").eq("company_id", companyId),
      ]);
      // /query returns snake_case columns.
      const row = companyRes.data as { id: string; name: string; company_type: string; trade: string | null } | null;
      setCompany(row && { id: row.id, name: row.name, companyType: row.company_type, trade: row.trade });
      setMembers(membersRes.members);
      setEmployees(employeesRes.employees);
      setProjects(projectsRes.projects.filter((p) => p.companyId === companyId));
      const aliasMap: Record<string, { name: string; address: string }> = {};
      for (const a of (aliasesRes.data ?? []) as { project_id: string; name: string | null; address: string | null }[]) {
        aliasMap[a.project_id] = { name: a.name ?? "", address: a.address ?? "" };
      }
      setAliases(aliasMap);
    } catch (err) {
      toast({
        title: "Could not load company settings",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateMember(userId: string, permissionLevel: string) {
    setBusy(true);
    try {
      await api.patch(`/companies/${companyId}/members/${userId}`, { permissionLevel });
      await load();
      toast({ title: "Permissions updated" });
    } catch (err) {
      toast({
        title: "Could not update permissions",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addEmployee(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmployeeName.trim()) return;
    setBusy(true);
    try {
      // The facade resolves {data, error} instead of rejecting — check it,
      // or a refused write still toasts success.
      const { error } = await supabase.from("employees").insert({
        company_id: companyId,
        name: newEmployeeName.trim(),
        email: newEmployeeEmail.trim() || null,
      });
      if (error) throw new Error(error.message);
      setNewEmployeeName("");
      setNewEmployeeEmail("");
      await load();
      toast({ title: "Employee added" });
    } catch (err) {
      toast({
        title: "Could not add that employee",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode(event: React.FormEvent) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    setBusy(true);
    try {
      await api.post("/projects/connect", { code: joinCode.trim() });
      setJoinCode("");
      await load();
      toast({ title: "Project connected" });
    } catch (err) {
      toast({
        title: "Could not connect to that project",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteProject() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/projects/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
      toast({ title: "Project deleted" });
    } catch (err) {
      toast({
        title: "Could not delete that project",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveAlias(projectId: string) {
    const draft = aliases[projectId] ?? { name: "", address: "" };
    setBusy(true);
    try {
      const { error } = await supabase.from("project_aliases").upsert(
        {
          project_id: projectId,
          company_id: companyId,
          name: draft.name.trim() || null,
          address: draft.address.trim() || null,
        },
        { onConflict: "project_id,company_id" },
      );
      if (error) throw new Error(error.message);
      await load();
      toast({ title: "Display name saved" });
    } catch (err) {
      toast({
        title: "Could not save that name",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeEmployee(id: string) {    setBusy(true);
    try {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await load();
      toast({ title: "Employee removed" });
    } catch (err) {
      toast({
        title: "Could not remove that employee",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <h1 className="text-lg font-bold">Company settings</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-6 p-4">
        {!companyId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              You are not part of a company yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Company</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="font-medium">{company?.name ?? "Unknown"}</p>
                    <Badge variant="secondary">{company?.companyType === "gc" ? "General contractor" : "Subcontractor"}</Badge>
                    {company?.trade && <Badge variant="outline">{company.trade}</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Projects</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects yet. Create one from the dashboard.</p>
                ) : (
                  <ul className="divide-y">
                    {projects.map((project) => {
                      const draft = aliases[project.id] ?? { name: "", address: "" };
                      return (
                        <li key={project.id} className="space-y-2 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{draft.name || project.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {draft.address || project.address || "No address"}
                                {" · "}
                                <span className="font-mono">{project.connectionCode}</span>
                              </p>
                            </div>
                            {canManageProjects && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => setDeleteTarget(project)}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1 space-y-1">
                              <Label htmlFor={`alias-name-${project.id}`}>Display name (optional)</Label>
                              <Input
                                id={`alias-name-${project.id}`}
                                value={draft.name}
                                onChange={(e) =>
                                  setAliases((a) => ({
                                    ...a,
                                    [project.id]: { name: e.target.value, address: a[project.id]?.address ?? "" },
                                  }))
                                }
                                placeholder={project.name}
                              />
                            </div>
                            <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1 space-y-1">
                              <Label htmlFor={`alias-address-${project.id}`}>Display address (optional)</Label>
                              <Input
                                id={`alias-address-${project.id}`}
                                value={draft.address}
                                onChange={(e) =>
                                  setAliases((a) => ({
                                    ...a,
                                    [project.id]: { name: a[project.id]?.name ?? "", address: e.target.value },
                                  }))
                                }
                                placeholder={project.address ?? ""}
                              />
                            </div>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveAlias(project.id)}>
                              Save name
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <form onSubmit={joinByCode} className="flex flex-wrap items-end gap-2 border-t pt-4">
                  <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1 space-y-2">
                    <Label htmlFor="joinCode">Connect to a project with its code</Label>
                    <Input
                      id="joinCode"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Paste the code a GC gave you"
                    />
                  </div>
                  <Button type="submit" variant="secondary" disabled={busy}>
                    Connect
                  </Button>
                </form>
              </CardContent>
            </Card>

            {companyId && <ConnectedCompaniesCard companyId={companyId} />}

            {/* Same rule the server applies to approving join requests. */}
            {companyId && (isAccountHolder || isMOA || (company?.companyType === "sub" && permissionLevel === "full")) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <UserPlus className="h-5 w-5 text-primary" />
                    Invite your team
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <InviteShare
                    url={companyJoinUrl(companyId)}
                    caption={`Send new ${company?.companyType === "gc" ? "staff" : "crew members"} this link so they can ask to join ${company?.name ?? "your company"}. You approve each one and choose what they can do.`}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Members</CardTitle>
                {companyId && (
                  <Button variant="outline" size="sm" onClick={() => setTeamDialogOpen(true)}>
                    Manage team
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {members.map((member) => (
                    <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{member.fullName ?? member.email}</p>
                        <p className="text-sm text-muted-foreground">{member.email}</p>
                      </div>
                      {isAccountHolder && !member.isCompanyCreator ? (
                        <Select
                          value={member.permissionLevel}
                          disabled={busy}
                          onValueChange={(value) => void updateMember(member.userId, value)}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PERMISSION_LEVELS.map((level) => (
                              <SelectItem key={level} value={level}>
                                {level.replace("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {member.isCompanyCreator ? "Creator" : member.permissionLevel.replace("_", " ")}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Employees</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employees yet. Add the crews you schedule.</p>
                ) : (
                  <ul className="divide-y">
                    {employees.map((employee) => (
                      <li key={employee.id} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-medium">{employee.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {employee.email ?? employee.phone ?? "No contact details"}
                            {employee.linkedUserId ? " · linked to an account" : ""}
                          </p>
                        </div>
                        {isAccountHolder && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => void removeEmployee(employee.id)}>
                            Remove
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isAccountHolder && (
                  <form onSubmit={addEmployee} className="flex flex-wrap items-end gap-2 border-t pt-4">
                    <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1 space-y-2">
                      <Label htmlFor="employeeName">Name</Label>
                      <Input
                        id="employeeName"
                        value={newEmployeeName}
                        onChange={(e) => setNewEmployeeName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="w-full sm:w-auto sm:min-w-40 sm:flex-1 space-y-2">
                      <Label htmlFor="employeeEmail">Email</Label>
                      <Input
                        id="employeeEmail"
                        type="email"
                        value={newEmployeeEmail}
                        onChange={(e) => setNewEmployeeEmail(e.target.value)}
                        placeholder="Optional, used to link their account"
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      Add
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {company?.companyType === "sub" && (
          <TimesheetDownloadCard employees={employees.map((e) => ({ id: e.id, name: e.name, employeeNumber: e.employeeNumber }))} />
        )}

        {/* Your own name, phone, photo and password live in Manage My Profile, not on the company page. */}
      </main>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project and everything attached to it: tasks, availability, schedule
              requests, connections, aliases, and its message channel. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeleteProject()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {companyId && (
        <TeamProfilesDialog
          open={teamDialogOpen}
          onOpenChange={setTeamDialogOpen}
          companyId={companyId}
          companyType={company?.companyType === "gc" ? "gc" : "sub"}
          currentUserId={user?.id ?? ""}
          canManage={isAccountHolder}
          onChanged={() => void load()}
        />
      )}
      <div className="flex-1" />
      <MobileTabBar />
      <Toaster />
    </div>
  );
}