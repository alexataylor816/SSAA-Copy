import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import {
  createTask,
  deleteTask,
  listTasksForProjects,
  toCalendarTask,
  updateTask,
  type CalendarTask,
  type Task,
} from "@/lib/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CalendarPanel from "@/components/dashboard/CalendarPanel";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CreateTaskModal from "@/components/dashboard/CreateTaskModal";
import EditTaskModal from "@/components/dashboard/EditTaskModal";
import ScheduleDayDialog from "@/components/dashboard/ScheduleDayDialog";
import LeftPanel from "@/components/dashboard/LeftPanel";
import RightPanel from "@/components/dashboard/RightPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarDays, Plus } from "lucide-react";

interface Project {
  id: string;
  name: string;
  address: string | null;
  companyId: string;
  connectionCode: string;
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  /** REST responses use camelCase; RightPanel expects the column name. */
  jobTitle?: string | null;
  company_id?: string;
  companyId?: string;
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
  confirmed: "Confirmed",
  rejected: "Declined",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  confirmed: "border-green-200 bg-green-100 text-green-800",
  rejected: "border-red-200 bg-red-100 text-red-800",
  cancelled: "border-red-200 bg-red-100 text-red-800",
};

const parseDay = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "2026-10-08" -> "Thu, Oct 8" */
const formatDay = (value: string) =>
  parseDay(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "13:30" -> "1:30 PM" */
const formatTime = (value: string | null) => {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export default function Dashboard() {
  const { user, isAccountHolder, isMOA, isBasicUser, permissionLevel, hasLevel1OrHigher, refreshProfile } = useAuth();
  // Mirrors the original's can_manage_projects(): full or account holder, any company type.
  const canManageProjects = isAccountHolder || isMOA || permissionLevel === "full";
  const location = useLocation();
  const pendingJoinRequest = Boolean((location.state as { pendingJoinRequest?: boolean } | null)?.pendingJoinRequest);

  const [projects, setProjects] = useState<Project[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [scheduleRequests, setScheduleRequests] = useState<Record<string, unknown>[]>([]);
  const [projectName, setProjectName] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyType, setNewCompanyType] = useState<"gc" | "sub">("gc");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // Calendar state. Tasks have no REST route, so they load through the same
  // /query facade the rest of the ported Lovable code uses.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showOverlay, setShowOverlay] = useState(false);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);
  const [scheduleDayOpen, setScheduleDayOpen] = useState(false);

  const companyId = user?.companyId ?? null;
  const viewMode: "gc" | "sub" = company?.companyType === "sub" ? "sub" : "gc";

  const loadProjects = useCallback(async () => {
    if (!companyId) {
      setProjects([]);
      return;
    }
    try {
      const res = await api.get<{ projects: Project[] }>("/projects");
      setProjects(res.projects);
    } catch {
      // Company-less users have no visible projects; that is fine.
      setProjects([]);
    }
  }, [companyId]);

  const loadCompany = useCallback(async () => {
    if (!companyId) return;
    const { data: row } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    // /query returns snake_case columns.
    const r = row as { id: string; name: string; company_type: "gc" | "sub" } | null;
    setCompany(r && { id: r.id, name: r.name, companyType: r.company_type });
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

  const loadEmployees = useCallback(async () => {
    if (!companyId) {
      setEmployees([]);
      return;
    }
    try {
      const res = await api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`);
      setEmployees(res.employees);
    } catch {
      // Employee visibility is scoped by permission level.
      setEmployees([]);
    }
  }, [companyId]);

  const refresh = useCallback(async () => {
    await Promise.all([loadProjects(), loadCompany(), loadJoinRequests(), loadScheduleRequests(), loadEmployees()]);
  }, [loadProjects, loadCompany, loadJoinRequests, loadScheduleRequests, loadEmployees]);

// Projects first, then tasks: the task query is scoped by project id, so
  // fetching them together would always ask for an empty id list.
  const loadTasks = useCallback(async (projectIds: string[]) => {
    try {
      setTasks(await listTasksForProjects(projectIds));
    } catch {
      // Not being able to read tasks is not a reason to blank the dashboard;
      // the calendar simply renders empty.
      setTasks([]);
    }
  }, []);

  /** Re-reads tasks for the projects currently in state. */
  const reloadTasks = useCallback(async () => {
    const ids = projects.map((p) => p.id);
    await loadTasks(ids);
  }, [projects, loadTasks]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!companyId) {
        // Company-less users get the setup card, not a 409 error banner.
        if (!controller.signal.aborted) setLoading(false);
        return;
      }
      const res = await api.get<{ projects: Project[] }>("/projects", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await Promise.all([refresh(), loadTasks(res.projects.map((p) => p.id))]);
      if (!controller.signal.aborted) setLoading(false);
    })().catch((err) => {
      // Unmount aborts the request on purpose; anything else is a real failure.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not load the dashboard.");
      setLoading(false);
    });
    return () => controller.abort();
  }, [refresh, loadTasks, companyId]);

  // Realtime: someone else approving/rejecting a join request, or a schedule
  // request being created/confirmed/rejected, should show up here live.
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`company:${companyId}:dashboard`)
      .on(EVENT.joinRequestCreated, () => void loadJoinRequests())
      .on(EVENT.joinRequestResolved, () => void loadJoinRequests())
      .on(EVENT.scheduleRequestCreated, () => void loadScheduleRequests())
      .on(EVENT.scheduleRequestUpdated, () => void loadScheduleRequests())
      .on(EVENT.projectConnectionChanged, () => void loadProjects())
      .subscribe();
    return () => channel.unsubscribe();
  }, [companyId, loadJoinRequests, loadScheduleRequests, loadProjects]);

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

  async function createCompany(event: React.FormEvent) {
    event.preventDefault();
    if (!newCompanyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/companies", { name: newCompanyName.trim(), companyType: newCompanyType });
      // user.companyId lives in AuthContext, not local state — refresh it so
      // the rest of this page (gated on companyId) picks up the new company.
      await refreshProfile();
      setNewCompanyName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that company.");
    } finally {
      setBusy(false);
    }
  }

  async function respondToJoinRequest(requestId: string, approve: boolean) {
    setBusy(true);
    try {
      // The original grants the lowest level each company type allows.
      await api.post(`/companies/${companyId}/join-requests/${requestId}/${approve ? "approve" : "reject"}`, {
        permissionLevel: company?.companyType === "sub" ? "basic" : "partial",
      });
      await loadJoinRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that request.");
    } finally {
      setBusy(false);
    }
  }

/** RightPanel reads the snake_case column names; /projects and
 *  /companies/:id/employees return camelCase. */
  const rightPanelProjects = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name, connection_code: p.connectionCode ?? null })),
    [projects],
  );

  const rightPanelEmployees = useMemo(
    () =>
      employees.map((e) => ({
        ...e,
        job_title: e.job_title ?? e.jobTitle ?? null,
        company_id: e.company_id ?? e.companyId,
      })),
    [employees],
  );

  const handleCreateProject = useCallback(
    async (name: string, address: string) => {
      await api.post("/projects", { name, address: address || null });
      await loadProjects();
    },
    [loadProjects],
  );

  const handleAddEmployee = useCallback(
    async (name: string, email: string, jobTitle: string) => {
      if (!companyId) return;
      const { error } = await supabase.from("employees").insert({
        company_id: companyId,
        name,
        email: email || null,
        job_title: jobTitle || null,
      });
      if (error) throw new Error(error.message);
      await loadEmployees();
    },
    [companyId, loadEmployees],
  );

  const handleDeleteEmployee = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await loadEmployees();
    },
    [loadEmployees],
  );

  /**
 * LeftPanel hands back the whole reordered array. The query executor matches
 * update rows by the columns in `data`, so each task is written one at a time
 * with its new index. LeftPanel has already reordered locally, so this only
 * persists; a failure is swallowed rather than snapping the list back.
 */
const handleReorderTasks = useCallback(
  async (ordered: { id: string }[]) => {
    await Promise.all(
      ordered.map((task, index) => updateTask(task.id, { sort_order: index })),
    ).catch(() => undefined);
    await reloadTasks();
  },
  [reloadTasks],
);

  const handleDeleteTask = useCallback(async (id: string) => {
    await deleteTask(id);
    await reloadTasks();
  }, [reloadTasks]);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  /** The modals pass Dates; the API stores YYYY-MM-DD. */
  const handleCreateTask = useCallback(
    async (name: string, startDate: Date, endDate: Date) => {
      // With no project chosen the calendar is showing every project, so a new
      // task needs one explicitly rather than landing in an arbitrary project.
      const projectId = selectedProjectId ?? projects[0]?.id;
      if (!projectId) throw new Error("Create a project before adding tasks.");
      await createTask(projectId, { name, start_date: iso(startDate), end_date: iso(endDate) });
      await reloadTasks();
    },
    [selectedProjectId, projects, reloadTasks],
  );

  const handleUpdateTask = useCallback(
    async (
      id: string,
      name: string,
      startDate: Date,
      endDate: Date,
      status: string,
      color: string,
    ) => {
      await updateTask(id, {
        name,
        start_date: iso(startDate),
        end_date: iso(endDate),
        status,
        color,
      });
      await reloadTasks();
    },
    [reloadTasks],
  );

  const handleConnectProject = useCallback(
    async (code: string) => {
      await api.post("/projects/connect", { code });
      await loadProjects();
    },
    [loadProjects],
  );

  // Tasks for the selected project, narrowed to what CalendarPanel renders.
  const calendarTasks: CalendarTask[] = useMemo(
    () =>
      tasks
        .filter((task) => !selectedProjectId || task.project_id === selectedProjectId)
        .map(toCalendarTask),
    [tasks, selectedProjectId],
  );

  /**
   * Roll schedule requests up per day so the calendar can colour each cell the
   * way the original does: red when anything was rejected/cancelled, green when
   * every request that day was confirmed, amber while one is still pending.
   */
  /** Today onward, soonest first, for the Upcoming Requests card. */
  const upcomingRequests = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return scheduleRequests
      .map((entry) => ({
        id: String(entry.id),
        date: String(entry.date ?? ""),
        startTime: (entry.startTime ?? entry.start_time ?? null) as string | null,
        endTime: (entry.endTime ?? entry.end_time ?? null) as string | null,
        status: String(entry.status ?? ""),
        projectName: projects.find((p) => p.id === (entry.projectId ?? entry.project_id))?.name ?? null,
        employeeNames: Array.isArray(entry.employeeNames) ? (entry.employeeNames as string[]) : [],
      }))
      .filter((entry) => entry.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }, [scheduleRequests, projects]);

  const openDay = (value: string) => {
    const day = parseDay(value);
    setCurrentDate(day);
    setSelectedDate(day);
    setScheduleDayOpen(true);
  };

  // Notifications link to /dashboard?day=YYYY-MM-DD; open that day once the company has loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const dayParam = searchParams.get("day");
  useEffect(() => {
    if (!dayParam || !company) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
      const day = parseDay(dayParam);
      setCurrentDate(day);
      setSelectedDate(day);
      setScheduleDayOpen(true);
    }
    setSearchParams({}, { replace: true });
  }, [dayParam, company, setSearchParams]);

  const dayStatuses = useMemo(() => {
    const byDate = new Map<string, { confirmed: number; pending: number; rejected: number; total: number }>();
    for (const entry of scheduleRequests) {
      const date = String(entry.date ?? "");
      if (!date) continue;
      const bucket = byDate.get(date) ?? { confirmed: 0, pending: 0, rejected: 0, total: 0 };
      const status = String(entry.status ?? "");
      bucket.total += 1;
      if (status === "confirmed" || status === "accepted") bucket.confirmed += 1;
      else if (status === "pending") bucket.pending += 1;
      else if (status === "rejected" || status === "declined" || status === "cancelled") {
        bucket.rejected += 1;
      }
      byDate.set(date, bucket);
    }
    return [...byDate.entries()].map(([date, b]) => ({
      date,
      confirmedCount: b.confirmed,
      pendingCount: b.pending,
      rejectedCount: b.rejected,
      totalRequestedSubs: b.total,
      scheduledEmployeeCount: b.confirmed,
      availableEmployeeCount: b.total,
    }));
  }, [scheduleRequests]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <DashboardHeader companyName={company?.name} pendingJoinCount={pendingRequests.length} />

      <main className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!company ? (
          <div className="mx-auto max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>{pendingJoinRequest ? "Request sent" : "Set up your company"}</CardTitle>
              </CardHeader>
            <CardContent className="space-y-4">
              {pendingJoinRequest ? (
                <p className="text-sm text-muted-foreground">
                  Your request to join has been sent. The account holder needs to approve it before you can
                  start scheduling with that company.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Your account is ready, but you are not part of a company yet. Create one to start scheduling.
                  </p>
                  <form onSubmit={createCompany} className="flex gap-2">
                    <Input
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      placeholder="Company name"
                      required
                    />
                    <select
                      value={newCompanyType}
                      onChange={(e) => setNewCompanyType(e.target.value as "gc" | "sub")}
                      className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="gc">General contractor</option>
                      <option value="sub">Subcontractor</option>
                    </select>
                    <Button type="submit" disabled={busy}>
                      Create
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
          </div>
        ) : (
          <>
            {/* Flex-row parent (like Lovable's), but only from `min-[1400px]`
                up: LeftPanel/CalendarPanel/RightPanel carry their own width +
                flex-order classes built for a row, and four columns need
                ~1400px before the calendar keeps usable day widths. Below that
                everything stacks (rail first) instead of squeezing sideways.

                Two deliberate departures from the original:
                - `h-screen` shell + `h-full` row, so the panels fill the
                  viewport instead of the page scrolling past them.
                - The calendar is `flex-1` here rather than the original's
                  hard-coded `lg:w-[1100px]`. Fixed 1100 + 288 + 256 is 1644px
                  of panel plus gaps, which overflows any normal monitor.
                  Growing the calendar into the leftover space is what "fits
                  the screen" actually requires. */}
            <div className="flex min-h-0 w-full flex-col gap-4 min-[1400px]:h-full min-[1400px]:mx-auto min-[1400px]:max-w-[1600px] min-[1400px]:flex-row min-[1400px]:gap-6">
              <LeftPanel
                viewMode={viewMode}
                tasks={calendarTasks}
                showOverlay={showOverlay}
                setShowOverlay={setShowOverlay}
                onCreateTask={() => setTaskEditorOpen(true)}
                onDeleteTask={(id) => void handleDeleteTask(id)}
                onReorderTasks={(ordered) => void handleReorderTasks(ordered)}
                onEditTask={(task) => {
                  setEditingTask(task);
                  setTaskEditorOpen(true);
                }}
                selectedProject={selectedProjectId ?? "master"}
                projects={rightPanelProjects}
              />

              <CalendarPanel
                currentDate={currentDate}
                setCurrentDate={setCurrentDate}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                selectedDates={selectedDates}
                setSelectedDates={setSelectedDates}
                tasks={calendarTasks}
                showOverlay={false}
                onDayClick={(date) => {
                  setSelectedDate(date);
                  setScheduleDayOpen(true);
                }}
                dayStatuses={dayStatuses}
                viewMode={viewMode}
              />

              <RightPanel
                viewMode={viewMode}
                projects={rightPanelProjects}
                selectedProject={selectedProjectId ?? "master"}
                setSelectedProject={(id) => setSelectedProjectId(id === "master" ? null : id)}
                employees={rightPanelEmployees}
                onCreateProject={(name, address) => void handleCreateProject(name, address)}
                onAddEmployee={(name, email, jobTitle) => void handleAddEmployee(name, email, jobTitle)}
                onDeleteEmployee={(id) => void handleDeleteEmployee(id)}
                onConnectProject={(code) => void handleConnectProject(code)}
                hasLevel1OrHigher={hasLevel1OrHigher}
                isBasicUser={isBasicUser}
                isAdminOrHigher={isAccountHolder}
                companyId={companyId ?? undefined}
                currentDate={currentDate}
                onTeamRefresh={() => void loadEmployees()}
              />

              {/* Lovable keeps projects in the header dropdown and schedule
                  requests inside ScheduleModal, so it has no equivalent of
                  these cards at all — they were invented by the migration and
                  originally stacked *below* the panels, which put them off the
                  bottom of a scrolling page. They live here instead: a fourth
                  column beside the calendar, so nothing important needs a
                  scroll to reach. `lg:h-full` + `overflow-y-auto` keeps the
                  rail scrolling internally rather than growing the page. */}
              {/* Four columns need ~1400px before the calendar keeps usable day
                  widths, so below that everything stacks with the rail on top;
                  from `min-[1400px]` up the panels sit side by side with the
                  rail as a true right-hand column beside the calendar. */}
              <aside className="order-first w-full space-y-4 min-[1400px]:order-last min-[1400px]:h-full min-[1400px]:w-80 min-[1400px]:flex-shrink-0 min-[1400px]:overflow-y-auto min-[1400px]:pr-1">
                <Card className="border-primary/20">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                    <CardTitle className="text-lg">My Projects</CardTitle>
                    {canManageProjects && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button size="sm">
                            <Plus className="mr-2 h-4 w-4" />
                            New
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
                  {/* Selecting a project here is the same as picking it in the
                      Projects dropdown: the calendar filters to it and the panel
                      beside shows its connection code. Connecting by code lives
                      in that panel, as in Lovable. */}
                  <CardContent className="space-y-1">
                    {loading ? (
                      <p className="text-sm text-muted-foreground">Loading projects...</p>
                    ) : projects.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {viewMode === "gc"
                          ? "No projects yet. Create one to get a connection code for your subcontractors."
                          : "No projects yet. Use Connect to Project with the code your GC sent you."}
                      </p>
                    ) : (
                      projects.map((project) => {
                        const selected = selectedProjectId === project.id;
                        const owned = project.companyId === companyId;
                        return (
                          <div
                            key={project.id}
                            className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                              selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent"
                            }`}
                          >
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setSelectedProjectId(selected ? null : project.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="truncate text-sm font-medium">{project.name}</p>
                              {project.address && (
                                <p className="truncate text-xs text-muted-foreground">{project.address}</p>
                              )}
                            </button>
                            {!owned && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                Connected
                              </Badge>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                              <Link
                                to={`/projects/${project.id}/schedule`}
                                aria-label={`${project.name} schedule page`}
                                title="Schedule page"
                              >
                                <CalendarDays className="h-4 w-4" />
                              </Link>
                            </Button>
                          </div>
                        );
                      })
                    )}
                    {selectedProjectId && (
                      <button
                        type="button"
                        onClick={() => setSelectedProjectId(null)}
                        className="w-full pt-1 text-center text-xs text-muted-foreground hover:text-foreground"
                      >
                        Show all projects (Master Schedule)
                      </button>
                    )}
                  </CardContent>
                </Card>

                {pendingRequests.length > 0 && (
                  <Card className="border-primary/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Join Requests</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y">
                        {pendingRequests.map((request) => (
                          <li key={request.id} className="flex items-center justify-between gap-2 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {request.userName ?? request.userEmail}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{request.userEmail}</p>
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <Button size="sm" disabled={busy} onClick={() => void respondToJoinRequest(request.id, true)}>
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void respondToJoinRequest(request.id, false)}
                              >
                                Decline
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <Card className="border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Upcoming Requests</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {upcomingRequests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing scheduled in the next month. Click a day on the calendar to schedule.
                      </p>
                    ) : (
                      upcomingRequests.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => openDay(entry.date)}
                          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{formatDay(entry.date)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                              {entry.projectName && ` · ${entry.projectName}`}
                            </p>
                            {entry.employeeNames.length > 0 && (
                              <p className="truncate text-xs text-muted-foreground">
                                {entry.employeeNames.join(", ")}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className={`shrink-0 ${STATUS_STYLE[entry.status] ?? ""}`}>
                            {STATUS_LABELS[entry.status] ?? entry.status}
                          </Badge>
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>
              </aside>
            </div>

            <CreateTaskModal
              isOpen={taskEditorOpen && editingTask === null}
              onClose={() => setTaskEditorOpen(false)}
              onCreateTask={(name, start, end) => void handleCreateTask(name, start, end)}
              selectedProject={selectedProjectId ?? ""}
              isGCView={viewMode === "gc"}
            />

            <EditTaskModal
              isOpen={taskEditorOpen && editingTask !== null}
              onClose={() => {
                setTaskEditorOpen(false);
                setEditingTask(null);
              }}
              task={
                editingTask && {
                  id: editingTask.id,
                  name: editingTask.name,
                  start_date: editingTask.start_date,
                  end_date: editingTask.end_date,
                  color: editingTask.color,
                  status: editingTask.status ?? "pending",
                }
              }
              onUpdateTask={(id, name, start, end, status, color) =>
                void handleUpdateTask(id, name, start, end, status, color)
              }
              onDeleteTask={(id) => void handleDeleteTask(id)}
              isGCView={viewMode === "gc"}
            />

            <ScheduleDayDialog
              open={scheduleDayOpen}
              onOpenChange={(open) => {
                setScheduleDayOpen(open);
                // As in the original: otherwise re-clicking the same day deselects it instead of reopening.
                if (!open) setSelectedDates([]);
              }}
              date={selectedDate}
              viewMode={viewMode}
              projects={projects}
              defaultProjectId={selectedProjectId}
              onChanged={() => void loadScheduleRequests()}
            />
          </>
        )}
      </main>
    </div>
  );
}
