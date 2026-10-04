/**
 * Weekly resource matrix: employees down the side, days across the top, and
 * availability you can drag in. The Lovable original was 134 KB; this is the
 * working core of it, talking to our own API instead of Supabase.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/toaster";
import { ArrowLeft, Trash2 } from "lucide-react";

interface Employee {
  id: string;
  name: string;
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

interface Project {
  id: string;
  name: string;
}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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
      className={`rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-opacity ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <p className="font-medium">{employee.name}</p>
    </div>
  );
}

function DayCell({
  date,
  entries,
  onDelete,
  canDelete,
}: {
  date: string;
  entries: Availability[];
  onDelete: (id: string) => void;
  canDelete: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-24 space-y-1 rounded-md border p-1.5 transition-colors ${
        isOver ? "border-primary bg-primary/5" : "bg-card"
      }`}
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="group flex items-center justify-between gap-1 rounded bg-secondary px-2 py-1 text-xs"
        >
          <span className="truncate">
            {entry.startTime}&#8202;-&#8202;{entry.endTime}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(entry.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Remove availability"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ResourceMatrix() {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId ?? null;

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      return { date, iso: iso(date) };
    });
  }, [weekStart]);

  const load = useCallback(async () => {
    if (!companyId) return;
    const start = iso(days[0].date);
    const end = iso(days[6].date);
    try {
      const [employeesRes, projectsRes, availabilityRes] = await Promise.all([
        api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`),
        api.get<{ projects: Project[] }>("/projects"),
        api.get<{ availability: Availability[] }>(`/availability?start=${start}&end=${end}`),
      ]);
      setEmployees(employeesRes.employees);
      setProjects(projectsRes.projects);
      setAvailability(availabilityRes.availability);
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

  // Realtime: other people on the same company changing availability should
  // show up here without a refresh.
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase.channel(`availability:${companyId}`).subscribe();
    return () => channel.unsubscribe();
  }, [companyId]);

  function entriesFor(employeeId: string, date: string): Availability[] {
    return availability.filter((a) => a.employeeId === employeeId && a.date === date);
  }

  /**
   * The API only lets you publish availability for the employee record linked to
   * your own account (see `setAvailability`), so only that row is editable.
   * Everyone else's published hours are shown read-only.
   */
  const myEmployeeId = useMemo(
    () => employees.find((employee) => employee.linkedUserId === user?.id)?.id ?? null,
    [employees, user],
  );

  async function handleDragEnd(event: DragEndEvent) {
    setActiveEmployee(null);
    const employee = event.active.data.current?.employee as Employee | undefined;
    const target = String(event.over?.id ?? "");
    if (!employee || !target.startsWith("day:")) return;
    if (employee.id !== myEmployeeId) {
      toast({
        title: "You can only edit your own availability",
        description: "Account holders can edit a crew's hours from company settings.",
        variant: "destructive",
      });
      return;
    }

    const date = target.slice("day:".length);
    setBusy(true);
    try {
      await api.post("/availability", {
        date,
        startTime: "08:00",
        endTime: "16:00",
        projectId: selectedProjectId || undefined,
        allProjects: !selectedProjectId,
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
          {myEmployeeId
            ? "drag your own name onto a day to add availability."
            : "you have no employee record in this company yet, so this view is read-only."}
        </p>

        <DndContext
          sensors={sensors}
          onDragStart={(event: DragStartEvent) =>
            setActiveEmployee((event.active.data.current?.employee as Employee | undefined) ?? null)
          }
          onDragEnd={(event) => void handleDragEnd(event)}
          onDragCancel={() => setActiveEmployee(null)}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-40 text-left text-xs font-medium text-muted-foreground">Employee</th>
                  {days.map((day) => (
                    <th key={day.iso} className="pb-1 text-left text-xs font-medium text-muted-foreground">
                      {day.date.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const mine = employee.id === myEmployeeId;
                  return (
                    <tr key={employee.id}>
                      <td className="align-top">
                        <DraggableChip employee={employee} disabled={!mine} />
                      </td>
                      {days.map((day) => (
                        <td key={day.iso} className="align-top">
                          <DayCell
                            date={day.iso}
                            entries={entriesFor(employee.id, day.iso)}
                            canDelete={mine}
                            onDelete={deleteEntry}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-sm text-muted-foreground">
                      No employees yet. Add them in company settings first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DragOverlay>
            {activeEmployee ? (
              <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-lg">
                {activeEmployee.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

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