/**
 * Weekly resource matrix: employees down the side, days across the top.
 * Availability goes in by drag-and-drop (fixed 08:00-16:00) or via the per-day
 * "+" button for custom hours; confirmed schedule requests show as booking
 * badges on the day. Talks to our own API instead of Supabase.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toaster";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

interface Employee {
  id: string;
  name: string;
  jobTitle?: string | null;
  linkedUserId: string | null;
}

interface Availability {
  id: string;
  employeeId: string;
  projectId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  allProjects: boolean;
}

interface Booking {
  employeeId: string;
  date: string;
  projectName: string;
}

interface Project {
  id: string;
  name: string;
  companyId: string;
}

interface ConnectedCrew {
  companyId: string;
  companyName: string;
  employees: Employee[];
}

const DAY_MS = 86_400_000;
/** Local calendar date; toISOString() is UTC and rolls evenings over to tomorrow. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "13:30" -> "1:30 PM" */
function fmtTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function EmployeeLabel({ employee }: { employee: Employee }) {
  return (
    <>
      <p className="truncate text-sm font-medium">{employee.name}</p>
      {employee.jobTitle && <p className="truncate text-xs text-muted-foreground">{employee.jobTitle}</p>}
    </>
  );
}

/** Monday-based start of week. */
function startOfWeek(from: Date): Date {
  const date = new Date(from);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function DraggableChip({ employee, disabled }: { employee: Employee; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `employee:${employee.id}`,
    data: { employee },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Without touch-action: none, the browser's own scroll/gesture handling
      // can swallow the pointer-down-and-move before dnd-kit claims it, which
      // presents as "dragging does nothing" with zero visual feedback.
      style={{ touchAction: "none" }}
      className={`min-w-0 rounded-md border bg-card px-3 py-2 shadow-sm transition-opacity ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <EmployeeLabel employee={employee} />
    </div>
  );
}

function ConnectedDayCell({ entries, bookings }: { entries: Availability[]; bookings: Booking[] }) {
  if (entries.length === 0 && bookings.length === 0) {
    return <div className="min-h-24 rounded-md border bg-muted/30 p-1.5" />;
  }
  return (
    <div className="min-h-24 space-y-1 rounded-md border bg-muted/30 p-1.5">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="rounded-md border border-yellow-400 bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-900"
          title="Available"
        >
          <span className="flex min-w-0 items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500" />
            <span className="leading-tight">
              {fmtTime(entry.startTime)} – <span className="whitespace-nowrap">{fmtTime(entry.endTime)}</span>
            </span>
          </span>
        </div>
      ))}
      {bookings.map((booking, index) => (
        <div
          key={`${booking.projectName}-${index}`}
          className="flex items-center gap-1.5 truncate rounded-md border border-green-500 bg-green-50 px-2 py-1 text-xs font-medium text-green-900"
          title={`Booked: ${booking.projectName}`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
          <span className="truncate">{booking.projectName}</span>
        </div>
      ))}
    </div>
  );
}

function DayCell({
  date,
  entries,
  bookings,
  onDelete,
  canDelete,
  onAdd,
  canAdd,
  isToday,
}: {
  date: string;
  entries: Availability[];
  bookings: Booking[];
  onDelete: (id: string) => void;
  canDelete: boolean;
  onAdd: () => void;
  canAdd: boolean;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });

  return (
    <div
      ref={setNodeRef}
      className={`group/cell min-h-24 space-y-1 rounded-md border p-1.5 transition-colors ${
        isOver ? "border-primary bg-primary/5" : isToday ? "border-primary/50 bg-primary/[0.03]" : "bg-card"
      }`}
    >
      {entries.map((entry) => (
        // Lovable's matrix colour code: yellow = available, green = booked.
        <div
          key={entry.id}
          className="group flex items-center justify-between gap-1 rounded-md border border-yellow-400 bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-900"
          title="Available"
        >
          <span className="flex min-w-0 items-start gap-1.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500" />
            {/* Wraps rather than truncating: narrow day columns cut the end time off. */}
            <span className="leading-tight">
              {fmtTime(entry.startTime)} – <span className="whitespace-nowrap">{fmtTime(entry.endTime)}</span>
            </span>
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(entry.id)}
              className="text-yellow-800 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label="Remove availability"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {bookings.map((booking, index) => (
        <div
          key={`${booking.projectName}-${index}`}
          className="flex items-center gap-1.5 truncate rounded-md border border-green-500 bg-green-50 px-2 py-1 text-xs font-medium text-green-900"
          title={`Booked: ${booking.projectName}`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
          <span className="truncate">{booking.projectName}</span>
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center rounded px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/cell:opacity-100"
          aria-label={`Add availability on ${date}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function ResourceMatrix() {
  const { user, hasPartialOrHigher, isMOA } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId ?? null;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null);
  const [addTarget, setAddTarget] = useState<{ employee: Employee; date: string } | null>(null);
  const [addStart, setAddStart] = useState("08:00");
  const [addEnd, setAddEnd] = useState("16:00");
  const [connectedCrews, setConnectedCrews] = useState<ConnectedCrew[]>([]);
  const [connectedAvail, setConnectedAvail] = useState<Availability[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [busy, setBusy] = useState(false);

  // PointerSensor alone is occasionally not dispatched correctly in embedded
  // webviews; Mouse/Touch cover those cases without changing normal-browser
  // behavior (dnd-kit only activates the first sensor that fires).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      return { date, iso: iso(date) };
    });
  }, [weekStart]);

  const todayIso = useMemo(() => iso(new Date()), []);

  const load = useCallback(async () => {
    if (!companyId) return;
    const start = iso(days[0].date);
    const end = iso(days[6].date);
    try {
      const [employeesRes, projectsRes, availabilityRes, requestsRes] = await Promise.all([
        api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`),
        api.get<{ projects: Project[] }>("/projects"),
        api.get<{ availability: Availability[] }>(`/availability?start=${start}&end=${end}`),
        api.get<{ requests: { employeeIds: string[]; date: string; status: string; projectId: string }[] }>(
          `/schedule-requests?start=${start}&end=${end}`,
        ),
      ]);
      setEmployees(employeesRes.employees);
      setProjects(projectsRes.projects);
      setAvailability(availabilityRes.availability);
      const names = new Map(projectsRes.projects.map((p) => [p.id, p.name]));
      setBookings(
        requestsRes.requests
          .filter((r) => r.status === "confirmed")
          .flatMap((r) =>
            r.employeeIds.map((employeeId) => ({
              employeeId,
              date: r.date,
              projectName: names.get(r.projectId) ?? "Booked",
            })),
          ),
      );
    } catch (err) {
      toast({
        title: "Could not load the matrix",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, [companyId, days, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Connected crews, GC-style: who the partner companies are and when their
   * people are free. Read-only by design — booking another company's crew
   * goes through schedule requests, never by writing their availability.
   * Everything here is best-effort: a sub viewing this page simply sees
   * nothing extra.
   */
  useEffect(() => {
    if (!companyId || projects.length === 0) {
      setConnectedCrews([]);
      setConnectedAvail([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const seen = new Map<string, string>();
        // Only projects this company owns: their connections are subs linked
        // by definition, so the crew endpoints below are entitled. Walking
        // merely-connected projects too produces 403 noise (and nothing
        // usable) for subs.
        for (const project of projects.filter((p) => p.companyId === companyId)) {
          try {
            const res = await api.get<{ companies: { id: string; name: string }[] }>(
              `/projects/${project.id}/connections`,
            );
            for (const c of res.companies) {
              if (c.id !== companyId && !seen.has(c.id)) seen.set(c.id, c.name);
            }
          } catch {
            // Not entitled to this project's connections — skip it.
          }
        }
        const crews: ConnectedCrew[] = [];
        for (const [id, name] of seen) {
          try {
            const res = await api.get<{ employees: Employee[] }>(`/companies/${id}/connected-employees`);
            if (res.employees.length > 0) crews.push({ companyId: id, companyName: name, employees: res.employees });
          } catch {
            // Not entitled to this roster — skip it.
          }
        }
        if (cancelled) return;
        setConnectedCrews(crews);
        if (crews.length === 0) {
          setConnectedAvail([]);
          return;
        }
        const week = new Set(days.map((d) => d.iso));
        const res = await supabase.from("availability").select("*");
        const rows = ((res.data ?? []) as Record<string, unknown>[]).filter(
          (r) => typeof r.date === "string" && week.has(r.date as string),
        );
        if (cancelled) return;
        setConnectedAvail(
          rows.map((r) => ({
            id: String(r.id),
            employeeId: String(r.employee_id),
            projectId: (r.project_id as string | null) ?? null,
            date: String(r.date),
            startTime: String(r.start_time),
            endTime: String(r.end_time),
            allProjects: r.all_projects === 1 || r.all_projects === true,
          })),
        );
      } catch {
        if (!cancelled) {
          setConnectedCrews([]);
          setConnectedAvail([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, projects, days]);

  // Realtime: other people on the same company changing availability, or a
  // schedule request being created/confirmed/rejected, should show up here
  // without a manual refresh. `.on()` must be called before `.subscribe()` —
  // the channel only forwards events it already knows about at that point.
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`company:${companyId}:matrix`)
      .on(EVENT.availabilityChanged, () => void load())
      .on(EVENT.scheduleRequestCreated, () => void load())
      .on(EVENT.scheduleRequestUpdated, () => void load())
      .subscribe();
    return () => channel.unsubscribe();
  }, [companyId, load]);

  function entriesFor(employeeId: string, date: string): Availability[] {
    return availability.filter((a) => a.employeeId === employeeId && a.date === date);
  }

  function bookingsFor(employeeId: string, date: string): Booking[] {
    return bookings.filter((b) => b.employeeId === employeeId && b.date === date);
  }

  function connectedEntriesFor(employeeId: string, date: string): Availability[] {
    return connectedAvail.filter((a) => a.employeeId === employeeId && a.date === date);
  }

  async function handleQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!companyId || !newEmployeeName.trim()) return;
    setBusy(true);
    try {
      // The facade resolves {data, error} instead of rejecting — check it,
      // or a refused write still toasts success.
      const { error } = await supabase.from("employees").insert({ company_id: companyId, name: newEmployeeName.trim() });
      if (error) throw new Error(error.message);
      setNewEmployeeName("");
      toast({ title: "Employee added to the roster" });
      await load();
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

  const myEmployeeId = useMemo(
    () => employees.find((employee) => employee.linkedUserId === user?.id)?.id ?? null,
    [employees, user],
  );

  /**
   * Publishing hours for somebody else needs Partial-level access or higher --
   * the backend enforces exactly this in `resolveEmployeeToSchedule`, matching
   * the original's ProfilesModal copy (level_1 and basic "cannot edit
   * availability"). Anyone can always publish their own row.
   */
  const canEditOthers = hasPartialOrHigher || isMOA;

  function canEdit(employeeId: string): boolean {
    return canEditOthers || employeeId === myEmployeeId;
  }

  async function saveAvailability(employee: Employee, date: string, startTime: string, endTime: string) {
    setBusy(true);
    try {
      await api.post("/availability", {
        date,
        startTime,
        endTime,
        projectId: selectedProjectId || undefined,
        allProjects: !selectedProjectId,
        // Omitted for your own row so the backend can resolve it from your
        // linked employee record, exactly as before.
        ...(employee.id === myEmployeeId ? {} : { employeeId: employee.id }),
      });
      toast({ title: `Availability saved for ${date}` });
      await load();
    } catch (err) {
      toast({
        title: "Could not save that availability",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveEmployee(null);
    const employee = event.active.data.current?.employee as Employee | undefined;
    const target = String(event.over?.id ?? "");
    if (!employee || !target.startsWith("day:")) return;
    if (!canEdit(employee.id)) {
      toast({
        title: "You can only edit your own availability",
        description: "You need Partial-level access or higher to publish hours for other people.",
        variant: "destructive",
      });
      return;
    }

    const date = target.slice("day:".length);
    await saveAvailability(employee, date, "08:00", "16:00");
  }

  async function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!addTarget) return;
    if (addStart >= addEnd) {
      toast({ title: "Start time must be before end time.", variant: "destructive" });
      return;
    }
    setAddTarget(null);
    await saveAvailability(addTarget.employee, addTarget.date, addStart, addEnd);
  }

  async function deleteEntry(id: string) {
    setBusy(true);
    try {
      await api.delete(`/availability/${id}`);
      await load();
    } catch (err) {
      toast({
        title: "Could not remove that entry",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!companyId) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-5xl p-4">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Join a company before using the resource matrix.
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <h1 className="text-lg font-bold">Resource matrix</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Project"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              This week
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}>
              Next
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Week of {iso(weekStart)} &#8212;{" "}
          {canEditOthers
            ? "drag any name onto a day to publish that person's hours."
            : myEmployeeId
              ? "drag your own name onto a day to add availability."
              : "you have no employee record in this company yet, so this view is read-only."}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-yellow-400 bg-yellow-50" />
            Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-green-500 bg-green-50" />
            Booked on a project
          </span>
        </div>

        {canEditOthers && (
          <form onSubmit={handleQuickAdd} className="mb-3 flex max-w-md items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="quickAddName">Add to roster</Label>
              <Input
                id="quickAddName"
                value={newEmployeeName}
                onChange={(e) => setNewEmployeeName(e.target.value)}
                placeholder="New employee name"
                required
              />
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </form>
        )}

        <DndContext
          sensors={sensors}
          onDragStart={(event: DragStartEvent) =>
            setActiveEmployee((event.active.data.current?.employee as Employee | undefined) ?? null)
          }
          onDragEnd={(event) => void handleDragEnd(event)}
          onDragCancel={() => setActiveEmployee(null)}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] table-fixed border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-44 bg-background pr-2 text-left text-xs font-medium text-muted-foreground">
                    Employee
                  </th>
                  {days.map((day) => (
                    <th
                      key={day.iso}
                      className={`pb-1 text-left text-xs font-medium ${
                        day.iso === todayIso ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {day.date.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="sticky left-0 z-10 bg-background pr-2 align-top">
                      <DraggableChip employee={employee} disabled={!canEdit(employee.id)} />
                    </td>
                    {days.map((day) => (
                      <td key={day.iso} className="align-top">
                        <DayCell
                          date={day.iso}
                          entries={entriesFor(employee.id, day.iso)}
                          bookings={bookingsFor(employee.id, day.iso)}
                          canDelete={canEdit(employee.id)}
                          onDelete={deleteEntry}
                          canAdd={canEdit(employee.id)}
                          isToday={day.iso === todayIso}
                          onAdd={() => {
                            setAddStart("08:00");
                            setAddEnd("16:00");
                            setAddTarget({ employee, date: day.iso });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">No employees yet.</p>
                      <Button variant="outline" size="sm" className="mt-3" asChild>
                        <Link to="/settings/company">Add your crew in company settings</Link>
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DragOverlay>
            {activeEmployee ? (
              <div className="w-44 rounded-md border bg-card px-3 py-2 shadow-lg">
                <EmployeeLabel employee={activeEmployee} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {connectedCrews.length > 0 && (
          <Card className="mt-6">
            <CardContent className="space-y-5 p-4">
              <div>
                <p className="text-sm font-medium">Connected crews</p>
                <p className="text-xs text-muted-foreground">
                  When connected companies&apos; people are free this week. Read-only — booking them goes through
                  a schedule request.
                </p>
              </div>
              {connectedCrews.map((crew) => (
                <div key={crew.companyId} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{crew.companyName}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[48rem] border-separate border-spacing-1">
                      <tbody>
                        {crew.employees.map((employee) => (
                          <tr key={employee.id}>
                            <td className="sticky left-0 z-10 w-44 bg-background pr-2 align-top">
                              <div className="rounded-md border bg-card px-3 py-2">
                                <EmployeeLabel employee={employee} />
                              </div>
                            </td>
                            {days.map((day) => (
                              <td key={day.iso} className="align-top">
                                <ConnectedDayCell
                                  entries={connectedEntriesFor(employee.id, day.iso)}
                                  bookings={bookingsFor(employee.id, day.iso)}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Dialog open={addTarget !== null} onOpenChange={(isOpen) => !isOpen && setAddTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Add availability</DialogTitle>
            </DialogHeader>
            {addTarget && (
              <form onSubmit={handleAddSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {addTarget.employee.name} · {addTarget.date}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="addStart">Start</Label>
                    <Input
                      id="addStart"
                      type="time"
                      value={addStart}
                      onChange={(e) => setAddStart(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="addEnd">End</Label>
                    <Input
                      id="addEnd"
                      type="time"
                      value={addEnd}
                      onChange={(e) => setAddEnd(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={busy}>
                    Save
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {busy && (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Saving...
          </p>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Signed in as {user?.email} <Badge variant="outline">week view</Badge>
        </p>
      </main>
      <Toaster />
    </div>
  );
}