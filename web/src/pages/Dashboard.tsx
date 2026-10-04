import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarDays, Grid3x3, LogOut, Plus, Settings, Users } from "lucide-react";

interface Project {
  id: string;
  name: string;
  address: string | null;
  companyId: string;
  connectionCode: string;
}

interface Company {
  id: string;
  name: string;
  companyType: "gc" | "sub";
}

interface JoinRequest {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

export default function Dashboard() {
  const { user, userRole, isAccountHolder, hasLevel1OrHigher, signOut } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [scheduleRequests, setScheduleRequests] = useState<Record<string, unknown>[]>([]);
  const [projectName, setProjectName] = useState("");
  const [connectCode, setConnectCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const companyId = user?.companyId ?? null;

  const loadProjects = useCallback(async () => {
    const res = await api.get<{ projects: Project[] }>("/projects");
    setProjects(res.projects);
  }, []);

  const loadCompany = useCallback(async () => {
    if (!companyId) return;
    const rows = (await supabase.from("companies").select("*").eq("id", companyId).maybeSingle()) as Company | null;
    setCompany(rows);
  }, [companyId]);

  const loadJoinRequests = useCallback(async () => {
    if (!companyId || !isAccountHolder) return;
    try {
      const res = await api.get<{ requests: JoinRequest[] }>(`/companies/${companyId}/join-requests`);
      setJoinRequests(res.requests);
    } catch {
      // Not every permission level can read join requests; that is fine.
      setJoinRequests([]);
    }
  }, [companyId, isAccountHolder]);

  const loadScheduleRequests = useCallback(async () => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const res = await api.get<{ requests: Record<string, unknown>[] }>(
        `/schedule-requests?start=${iso(start)}&end=${iso(end)}`,
      );
      setScheduleRequests(res.requests);
    } catch {
      setScheduleRequests([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadProjects(), loadCompany(), loadJoinRequests(), loadScheduleRequests()]);
  }, [loadProjects, loadCompany, loadJoinRequests, loadScheduleRequests]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const pendingRequests = useMemo(
    () => joinRequests.filter((r) => r.status === "pending"),
    [joinRequests],
  );

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!projectName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/projects", { name: projectName.trim(), address: null });
      setProjectName("");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that project.");
    } finally {
      setBusy(false);
    }
  }

  async function connectProject(event: React.FormEvent) {
    event.preventDefault();
    if (!connectCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/projects/connect", { code: connectCode.trim() });
      setConnectCode("");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect with that code.");
    } finally {
      setBusy(false);
    }
  }

  async function respondToJoinRequest(requestId: string, approve: boolean) {
    setBusy(true);
    try {
      await api.post(`/companies/${companyId}/join-requests/${requestId}/${approve ? "approve" : "reject"}`, {
        permissionLevel: "standard",
      });
      await loadJoinRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
          <div>
            <h1 className="text-xl font-bold">SSAA</h1>
            <p className="text-sm text-muted-foreground">
              {company ? company.name : "No company yet"}
              {userRole && (
                <Badge variant="secondary" className="ml-2">
                  {userRole.permission_level.replace("_", " ")}
                </Badge>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/matrix")}>
              <Grid3x3 className="mr-2 h-4 w-4" />
              Matrix
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/settings/company")}>
              <Settings className="mr-2 h-4 w-4" />
              Company
            </Button>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!company ? (
          <Card>
            <CardHeader>
              <CardTitle>Set up your company</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your account is ready, but you are not part of a company yet. Create one to start scheduling.
              </p>
              <form onSubmit={createProject} className="flex gap-2">
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Company name"
                  required
                />
                <Button type="submit" disabled={busy}>
                  Create
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Projects</CardTitle>
                {hasLevel1OrHigher && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        New project
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>New project</DialogTitle>
                        <DialogDescription>
                          Projects belong to your company. Subs join yours with a connection code.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={createProject} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="projectName">Project name</Label>
                          <Input
                            id="projectName"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            required
                          />
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={busy}>
                            Create project
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading projects...</p>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                ) : (
                  <ul className="divide-y">
                    {projects.map((project) => (
                      <li key={project.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{project.name}</p>
                          {project.address && <p className="truncate text-sm text-muted-foreground">{project.address}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/projects/${project.id}/schedule`}>
                              <CalendarDays className="mr-2 h-4 w-4" />
                              Schedule
                            </Link>
                          </Button>
                          <Badge variant="outline" className="font-mono">
                            {project.connectionCode}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={connectProject} className="flex items-end gap-2 border-t pt-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="connectCode">Connect to a project</Label>
                    <Input
                      id="connectCode"
                      value={connectCode}
                      onChange={(e) => setConnectCode(e.target.value)}
                      placeholder="Paste the code a GC gave you"
                    />
                  </div>
                  <Button type="submit" variant="secondary" disabled={busy}>
                    Connect
                  </Button>
                </form>
              </CardContent>
            </Card>

            {pendingRequests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Pending join requests</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {pendingRequests.map((request) => (
                      <li key={request.id} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <p className="font-medium">{request.userName ?? request.userEmail}</p>
                          <p className="text-sm text-muted-foreground">{request.userEmail}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy} onClick={() => void respondToJoinRequest(request.id, true)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void respondToJoinRequest(request.id, false)}>
                            Decline
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent schedule requests</CardTitle>
              </CardHeader>
              <CardContent>
                {scheduleRequests.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing scheduled in the next month.</p>
                ) : (
                  <ul className="divide-y">
                    {scheduleRequests.map((entry) => (
                      <li key={String(entry.id)} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {String(entry.date ?? "")} · {String(entry.start_time ?? entry.startTime ?? "")}-
                            {String(entry.end_time ?? entry.endTime ?? "")}
                          </p>
                        </div>
                        <Badge variant="secondary">{STATUS_LABELS[String(entry.status)] ?? String(entry.status)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}