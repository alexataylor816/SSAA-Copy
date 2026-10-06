import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Clock, Loader2, Lock, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The core of Lovable's ScheduleModal, opened by clicking a calendar day.
 * GC: pick a project and subs, then book posted availability slots. Sub:
 * answer that day's requests and publish who is available. Multiple stops,
 * multi-day booking, SMS/email toggles and photos are not ported here.
 */

interface ProjectLite {
  id: string;
  name: string;
  companyId: string;
}

interface Company {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
  jobTitle?: string | null;
  job_title?: string | null;
  companyId?: string;
  linkedUserId?: string | null;
}

interface ScheduleRequest {
  id: string;
  projectId: string;
  requestingCompanyId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
}

interface Slot {
  id: string;
  employeeId: string;
  projectId: string | null;
  allProjects: boolean;
  startTime: string;
  endTime: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date | null;
  viewMode: "gc" | "sub";
  projects: ProjectLite[];
  defaultProjectId: string | null;
  onChanged: () => void;
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "13:30" -> "1:30 PM" */
function fmtTime(value: string | null | undefined): string {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Same rule as the backend's historicalLock: anything before this week's Monday. */
function isLocked(date: Date): boolean {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
  monday.setHours(1, 0, 0, 0);
  if (now < monday) monday.setDate(monday.getDate() - 7);
  monday.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day < monday;
}

const STATUS_STYLE: Record<ScheduleRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  confirmed: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
};

const overlaps = (a: { startTime: string | null; endTime: string | null }, b: { startTime: string; endTime: string }) =>
  !a.startTime || !a.endTime || (a.startTime < b.endTime && b.startTime < a.endTime);

const titleOf = (e: Employee) => e.jobTitle ?? e.job_title ?? null;

function RequestRow({
  request,
  label,
  names,
  actions,
}: {
  request: ScheduleRequest;
  label: string;
  names: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-background p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {fmtTime(request.startTime)} – {fmtTime(request.endTime)} · {names || `${request.employeeIds.length} person(s)`}
        </p>
        {request.description && <p className="text-xs text-muted-foreground">{request.description}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`capitalize ${STATUS_STYLE[request.status]}`}>
          {request.status}
        </Badge>
        {actions}
      </div>
    </div>
  );
}

export default function ScheduleDayDialog({ open, onOpenChange, date, viewMode, projects, defaultProjectId, onChanged }: Props) {
  const { user, hasPartialOrHigher } = useAuth();
  const companyId = user?.companyId ?? null;
  const day = date ? isoDate(date) : null;
  const locked = date ? isLocked(date) : false;

  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GC state
  const ownedProjects = useMemo(() => projects.filter((p) => p.companyId === companyId), [projects, companyId]);
  const [projectId, setProjectId] = useState<string>("");
  const [subs, setSubs] = useState<Company[]>([]);
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [crew, setCrew] = useState<Employee[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [pickedSlotIds, setPickedSlotIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");

  // Sub state
  const [roster, setRoster] = useState<Employee[]>([]);
  const [myAvailability, setMyAvailability] = useState<Slot[]>([]);
  const [availFor, setAvailFor] = useState<string[]>([]);
  const [availStart, setAvailStart] = useState("08:00");
  const [availEnd, setAvailEnd] = useState("16:00");
  const [availProject, setAvailProject] = useState<string>("all");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPickedSlotIds([]);
    setDescription("");
    if (viewMode === "gc") {
      const preferred = ownedProjects.find((p) => p.id === defaultProjectId) ?? ownedProjects[0];
      setProjectId(preferred?.id ?? "");
    }
  }, [open, viewMode, defaultProjectId, ownedProjects]);

  const loadGc = useCallback(async () => {
    if (!day || !projectId) {
      setSubs([]);
      setCrew([]);
      setSlots([]);
      return;
    }
    const conn = await api.get<{ companies: Company[] }>(`/projects/${projectId}/connections`);
    setSubs(conn.companies);
    setSelectedSubIds((prev) => {
      const still = prev.filter((id) => conn.companies.some((c) => c.id === id));
      return still.length ? still : conn.companies.map((c) => c.id);
    });
    const lists = await Promise.all(
      conn.companies.map((c) =>
        api
          .get<{ employees: Employee[] }>(`/companies/${c.id}/connected-employees`)
          .then((r) => r.employees.map((e) => ({ ...e, companyId: e.companyId ?? c.id })))
          .catch(() => [] as Employee[]),
      ),
    );
    const everyone = lists.flat();
    setCrew(everyone);
    if (everyone.length === 0) {
      setSlots([]);
      return;
    }
    const { data } = await supabase
      .from("availability")
      .select("*")
      .eq("date", day)
      .in(
        "employee_id",
        everyone.map((e) => e.id),
      );
    const rows = (data ?? []) as {
      id: string;
      employee_id: string;
      project_id: string | null;
      all_projects: number | boolean;
      start_time: string;
      end_time: string;
    }[];
    setSlots(
      rows
        .map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          projectId: r.project_id,
          allProjects: r.all_projects === true || r.all_projects === 1,
          startTime: r.start_time,
          endTime: r.end_time,
        }))
        // Only hours posted for every project, or for this one.
        .filter((s) => s.allProjects || s.projectId === projectId)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    );
  }, [day, projectId]);

  const loadSub = useCallback(async () => {
    if (!day || !companyId) return;
    const [emp, avail] = await Promise.all([
      api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`),
      api.get<{ availability: Slot[] }>(`/availability?start=${day}&end=${day}`),
    ]);
    setRoster(emp.employees);
    setMyAvailability(avail.availability);
    // Without Partial access you can only post for yourself.
    const self = emp.employees.find((e) => e.linkedUserId === user?.id);
    setAvailFor((prev) => (prev.length ? prev : self ? [self.id] : []));
  }, [day, companyId, user?.id]);

  const load = useCallback(async () => {
    if (!open || !day) return;
    setLoading(true);
    try {
      const res = await api.get<{ requests: ScheduleRequest[] }>(`/schedule-requests?start=${day}&end=${day}`);
      setRequests(res.requests);
      if (viewMode === "gc") await loadGc();
      else await loadSub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this day.");
    } finally {
      setLoading(false);
    }
  }, [open, day, viewMode, loadGc, loadSub]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open || !companyId) return;
    const channel = supabase
      .channel(`company:${companyId}:schedule-day`)
      .on(EVENT.availabilityChanged, () => void load())
      .on(EVENT.scheduleRequestCreated, () => void load())
      .on(EVENT.scheduleRequestUpdated, () => void load())
      .subscribe();
    return () => channel.unsubscribe();
  }, [open, companyId, load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (id: string, status: "confirmed" | "rejected" | "cancelled") =>
    run(() => api.patch(`/schedule-requests/${id}`, { status }));

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";
  const active = (r: ScheduleRequest) => r.status === "pending" || r.status === "confirmed";

  // ---------- GC view ----------
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of [...crew, ...roster]) map.set(e.id, e.name);
    return map;
  }, [crew, roster]);
  const namesOf = (r: ScheduleRequest) => r.employeeIds.map((id) => nameById.get(id) ?? "").filter(Boolean).join(", ");
  const subName = (id: string) => subs.find((s) => s.id === id)?.name ?? "Subcontractor";

  const gcRequests = requests.filter((r) => r.projectId === projectId && r.requestingCompanyId === companyId);
  const isBooked = (slot: Slot) =>
    requests.some((r) => active(r) && r.employeeIds.includes(slot.employeeId) && overlaps(r, slot));

  const availableCrew = crew
    .filter((e) => selectedSubIds.includes(e.companyId ?? ""))
    .map((e) => ({ employee: e, slots: slots.filter((s) => s.employeeId === e.id) }))
    .filter((x) => x.slots.length > 0);

  const sendRequests = () =>
    run(async () => {
      const picked = slots.filter((s) => pickedSlotIds.includes(s.id));
      // One request per sub and time window, covering everyone picked for it.
      const groups = new Map<string, { subCompanyId: string; startTime: string; endTime: string; employeeIds: string[] }>();
      for (const slot of picked) {
        const subCompanyId = crew.find((e) => e.id === slot.employeeId)?.companyId ?? "";
        const key = `${subCompanyId}|${slot.startTime}|${slot.endTime}`;
        const group = groups.get(key) ?? { subCompanyId, startTime: slot.startTime, endTime: slot.endTime, employeeIds: [] };
        if (!group.employeeIds.includes(slot.employeeId)) group.employeeIds.push(slot.employeeId);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        await api.post("/schedule-requests", {
          projectId,
          date: day,
          description: description.trim() || undefined,
          ...group,
        });
      }
      setPickedSlotIds([]);
      setDescription("");
    });

  const gcView = (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="schedule-project">Project</Label>
        {ownedProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a project first to schedule subcontractors.</p>
        ) : (
          <select
            id="schedule-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPickedSlotIds([]);
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ownedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <Label>Scheduled requests</Label>
        {gcRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled on this project for this day.</p>
        ) : (
          <div className="space-y-2">
            {gcRequests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                label={subName(r.subCompanyId)}
                names={namesOf(r)}
                actions={
                  active(r) && hasPartialOrHigher && !locked ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus(r.id, "cancelled")}>
                      Cancel
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </div>

      {hasPartialOrHigher && !locked && projectId && (
        <>
          <div className="space-y-2">
            <Label>Select subcontractors</Label>
            {subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subcontractors on this project yet. Share its connection code so they can join.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3">
                {subs.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSubIds.includes(s.id)}
                      onCheckedChange={(checked) =>
                        setSelectedSubIds((prev) => (checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {subs.length > 0 && (
            <div className="space-y-2">
              <Label>Available personnel & time slots</Label>
              <div className="max-h-64 space-y-4 overflow-y-auto rounded-md border bg-muted/30 p-3">
                {availableCrew.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No one from the selected subs has posted availability for this day yet.
                  </p>
                ) : (
                  availableCrew.map(({ employee, slots: empSlots }) => (
                    <div key={employee.id} className="space-y-2">
                      <p className="text-sm font-medium">
                        {employee.name}
                        {titleOf(employee) && ` - ${titleOf(employee)}`}{" "}
                        <span className="text-xs font-normal text-muted-foreground">({subName(employee.companyId ?? "")})</span>
                      </p>
                      <div className="space-y-1 pl-4">
                        {empSlots.map((slot) => {
                          const booked = isBooked(slot);
                          const picked = pickedSlotIds.includes(slot.id);
                          return (
                            <label
                              key={slot.id}
                              className={`flex items-center gap-2 rounded-md border p-2 text-sm ${
                                booked
                                  ? "cursor-not-allowed bg-muted opacity-60"
                                  : picked
                                    ? "cursor-pointer border-primary bg-primary/10"
                                    : "cursor-pointer bg-background hover:bg-muted/50"
                              }`}
                            >
                              <Checkbox
                                checked={picked}
                                disabled={booked}
                                onCheckedChange={(checked) =>
                                  setPickedSlotIds((prev) => (checked ? [...prev, slot.id] : prev.filter((id) => id !== slot.id)))
                                }
                              />
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="flex-1">
                                {date && format(date, "EEEE")}, Available: {fmtTime(slot.startTime)} - {fmtTime(slot.endTime)}
                              </span>
                              {booked && (
                                <Badge variant="secondary" className="text-xs">
                                  Booked
                                </Badge>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="schedule-description">Description / work to be performed</Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the crew will be doing"
              rows={3}
            />
          </div>

          <Button className="w-full" disabled={busy || pickedSlotIds.length === 0} onClick={() => void sendRequests()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request{pickedSlotIds.length > 1 ? "s" : ""}
          </Button>
        </>
      )}
    </div>
  );

  // ---------- Sub view ----------
  const incoming = requests.filter((r) => r.subCompanyId === companyId);
  const pending = incoming.filter((r) => r.status === "pending");
  const confirmed = incoming.filter((r) => r.status === "confirmed");
  const closed = incoming.filter((r) => r.status === "rejected" || r.status === "cancelled");
  const connectedProjects = projects.filter((p) => p.companyId !== companyId);
  const selfEmployee = roster.find((e) => e.linkedUserId === user?.id);
  const postable = hasPartialOrHigher ? roster : roster.filter((e) => e.id === selfEmployee?.id);
  const canRemove = (slot: Slot) => hasPartialOrHigher || slot.employeeId === selfEmployee?.id;

  const publishAvailability = () =>
    run(async () => {
      for (const employeeId of availFor) {
        await api.post("/availability", {
          date: day,
          startTime: availStart,
          endTime: availEnd,
          employeeId,
          allProjects: availProject === "all",
          projectId: availProject === "all" ? undefined : availProject,
        });
      }
    });

  const respond = (r: ScheduleRequest) =>
    hasPartialOrHigher && !locked ? (
      <>
        <Button size="sm" disabled={busy} onClick={() => void setStatus(r.id, "confirmed")}>
          Confirm
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(r.id, "rejected")}>
          Decline
        </Button>
      </>
    ) : null;

  const subView = (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Pending requests</Label>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests waiting on you for this day.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <RequestRow key={r.id} request={r} label={projectName(r.projectId)} names={namesOf(r)} actions={respond(r)} />
            ))}
          </div>
        )}
      </div>

      {confirmed.length > 0 && (
        <div className="space-y-2">
          <Label>Confirmed schedules</Label>
          <div className="space-y-2">
            {confirmed.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                label={projectName(r.projectId)}
                names={namesOf(r)}
                actions={
                  hasPartialOrHigher && !locked ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus(r.id, "cancelled")}>
                      Cancel
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-2">
          <Label className="text-red-600">Rejected / cancelled</Label>
          <div className="space-y-2">
            {closed.map((r) => (
              <RequestRow key={r.id} request={r} label={projectName(r.projectId)} names={namesOf(r)} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Posted availability</Label>
        {myAvailability.length === 0 ? (
          <p className="text-sm text-muted-foreground">No availability posted for this day.</p>
        ) : (
          <div className="space-y-1">
            {myAvailability.map((slot) => (
              <div key={slot.id} className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1">
                  {nameById.get(slot.employeeId) ?? "Employee"}: {fmtTime(slot.startTime)} - {fmtTime(slot.endTime)}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {slot.allProjects ? "all projects" : projectName(slot.projectId ?? "")}
                  </span>
                </span>
                {canRemove(slot) && !locked && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label="Remove availability"
                    disabled={busy}
                    onClick={() => void run(() => api.delete(`/availability/${slot.id}`))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!locked && postable.length > 0 && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <Label>Who is available?</Label>
          <div className="flex flex-wrap gap-3">
            {postable.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={availFor.includes(e.id)}
                  onCheckedChange={(checked) =>
                    setAvailFor((prev) => (checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                  }
                />
                {e.name}
                {titleOf(e) && <span className="text-xs text-muted-foreground">({titleOf(e)})</span>}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="avail-start" className="text-xs">
                Start time
              </Label>
              <Input id="avail-start" type="time" value={availStart} onChange={(e) => setAvailStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="avail-end" className="text-xs">
                End time
              </Label>
              <Input id="avail-end" type="time" value={availEnd} onChange={(e) => setAvailEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="avail-project" className="text-xs">
              Available for
            </Label>
            <select
              id="avail-project"
              value={availProject}
              onChange={(e) => setAvailProject(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All my projects</option>
              {connectedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button className="w-full" disabled={busy || availFor.length === 0} onClick={() => void publishAvailability()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Post availability
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{date ? format(date, "EEEE, MMMM d, yyyy") : "Schedule"}</DialogTitle>
          <DialogDescription>
            {viewMode === "gc" ? "Book crews from your subcontractors' posted availability." : "Answer requests and post who is available."}
          </DialogDescription>
        </DialogHeader>

        {locked && (
          <p className="flex items-center gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            This day is before the current week, so its schedule is locked.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && requests.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : viewMode === "gc" ? (
          gcView
        ) : (
          subView
        )}
      </DialogContent>
    </Dialog>
  );
}
