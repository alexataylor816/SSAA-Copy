import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Clock, Loader2, Lock, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { api } from "@/lib/api";
import { matrixApi, type BatchResult } from "@/lib/matrixApi";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { clip, freeWindows, windowOf, type TimeWindow } from "@/lib/timeWindows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, tr } from "@/i18n/runtime";
import { jobTitleLabel, statusLabel, tradeLabel } from "@/i18n/labels";

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
  trade?: string | null;
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
  /** Changed by the other company since it was last confirmed (the "Edited" tag). */
  edited?: boolean;
  lastEditedByCompanyId?: string | null;
  /** The sub put its own crew here from the Weekly view. */
  subAssigned?: boolean;
}

interface Slot {
  id: string;
  employeeId: string;
  projectId: string | null;
  allProjects: boolean;
  startTime: string;
  endTime: string;
  stopLabel?: string | null;
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

const titleOf = (e: Employee) => jobTitleLabel(e.jobTitle ?? e.job_title ?? null) || null;

/** Edited by the other company and not yet confirmed by this one. */
const editedFor = (request: ScheduleRequest, companyId: string | null) =>
  !!request.edited && !!request.lastEditedByCompanyId && request.lastEditedByCompanyId !== companyId;

function RequestRow({
  request,
  label,
  names,
  actions,
  edited = false,
  children,
}: {
  request: ScheduleRequest;
  label: string;
  names: string;
  actions?: React.ReactNode;
  edited?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className={`space-y-2 rounded-md border bg-background p-3 ${edited ? "border-amber-300" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{label}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {fmtTime(request.startTime)} – {fmtTime(request.endTime)} · {names || t("scheduleDayDialog.personS", { length: request.employeeIds.length })}
          </p>
          {request.description && <p className="text-xs text-muted-foreground">{request.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {edited && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              
              {t("scheduleDayDialog.edited")}
            </Badge>
          )}
          <Badge variant="outline" className={STATUS_STYLE[request.status]}>
            {statusLabel(request.status)}
          </Badge>
          {actions}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function ScheduleDayDialog({ open, onOpenChange, date, viewMode, projects, defaultProjectId, onChanged }: Props) {
  const { user, hasPartialOrHigher } = useAuth();
  const { t } = useLanguage();
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
  // Free windows the GC picked, keyed by employee + window start. Times can be
  // narrowed inside the window (book 7-12 and leave the afternoon free).
  const [picks, setPicks] = useState<Record<string, { employeeId: string; window: TimeWindow; start: string; end: string }>>({});
  const [description, setDescription] = useState("");

  // Sub state
  const [roster, setRoster] = useState<Employee[]>([]);
  const [myAvailability, setMyAvailability] = useState<Slot[]>([]);
  const [availFor, setAvailFor] = useState<string[]>([]);
  const [availStart, setAvailStart] = useState("08:00");
  const [availEnd, setAvailEnd] = useState("16:00");
  // Lovable's "Multiple Stops": separate blocks in one day, each posted as its own stop.
  const [multipleStops, setMultipleStops] = useState(false);
  const [stops, setStops] = useState<{ start: string; end: string }[]>([
    { start: "06:00", end: "10:00" },
    { start: "13:00", end: "17:00" },
  ]);
  const [availAllProjects, setAvailAllProjects] = useState(true);
  const [availProjectIds, setAvailProjectIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicks({});
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
      stop_label: string | null;
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
          stopLabel: r.stop_label,
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
      setError(err instanceof Error ? err.message : tr("scheduleDayDialog.couldNotLoadDay"));
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
      setError(err instanceof Error ? err.message : tr("common.thatDidntWork"));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (id: string, status: "confirmed" | "rejected" | "cancelled") =>
    run(() => api.patch(`/schedule-requests/${id}`, { status }));

  // "Edited" requests: confirm the other company's changes, or change the time and send it back.
  const [resend, setResend] = useState<{ id: string; start: string; end: string } | null>(null);
  const confirmChanges = (id: string) => run(() => matrixApi.acknowledgeEdit(id));
  const editAndResend = (r: ScheduleRequest, start: string, end: string) =>
    run(async () => {
      if (!(start < end)) throw new Error(t("scheduleDayDialog.theStartTimeMustBeBefore"));
      const res = await matrixApi.sendBatch({
        create: [],
        cancel: [],
        update: [{ requestId: r.id, employeeIds: r.employeeIds, startTime: start, endTime: end }],
      });
      if (res.skipped.length > 0) throw new Error(res.skipped[0].reason);
      setResend(null);
    });

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
  /** Time already held for someone today (any project, any GC), with what holds it. */
  const takenFor = (employeeId: string) =>
    requests
      .filter((r) => active(r) && r.employeeIds.includes(employeeId))
      .map((r) => ({ window: windowOf(r.startTime, r.endTime), status: r.status, project: projectName(r.projectId) }));
  const pickedCount = Object.keys(picks).length;
  const badPick = Object.values(picks).find(
    (pk) => !(pk.start < pk.end && pk.start >= pk.window.start && pk.end <= pk.window.end),
  );

  const availableCrew = crew
    .filter((e) => selectedSubIds.includes(e.companyId ?? ""))
    .map((e) => ({ employee: e, slots: slots.filter((s) => s.employeeId === e.id) }))
    .filter((x) => x.slots.length > 0);

  const sendRequests = () =>
    run(async () => {
      // One request per sub and time, covering everyone picked for it.
      const groups = new Map<string, { subCompanyId: string; startTime: string; endTime: string; employeeIds: string[] }>();
      for (const pk of Object.values(picks)) {
        const subCompanyId = crew.find((e) => e.id === pk.employeeId)?.companyId ?? "";
        const key = `${subCompanyId}|${pk.start}|${pk.end}`;
        const group = groups.get(key) ?? { subCompanyId, startTime: pk.start, endTime: pk.end, employeeIds: [] };
        if (!group.employeeIds.includes(pk.employeeId)) group.employeeIds.push(pk.employeeId);
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
      setPicks({});
      setDescription("");
    });

  const gcView = (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="schedule-project">{t("common.project")}</Label>
        {ownedProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scheduleDayDialog.createAProjectFirstToSchedule")}</p>
        ) : (
          <select
            id="schedule-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPicks({});
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
        <Label>{t("scheduleDayDialog.scheduledRequests")}</Label>
        {gcRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scheduleDayDialog.nothingScheduledOnThisProjectFor")}</p>
        ) : (
          <div className="space-y-2">
            {gcRequests.map((r) => {
              const edited = editedFor(r, companyId);
              const canAct = active(r) && hasPartialOrHigher && !locked;
              const editing = resend?.id === r.id ? resend : null;
              return (
                <RequestRow
                  key={r.id}
                  request={r}
                  label={subName(r.subCompanyId)}
                  names={namesOf(r)}
                  edited={edited}
                  actions={
                    // Luke: a normal request has Edit and Cancel; an Edited one gets its own row of buttons below.
                    canAct && !edited && !editing ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setResend({ id: r.id, start: r.startTime ?? "07:00", end: r.endTime ?? "15:30" })}
                        >
                          
                          {t("scheduleDayDialog.edit")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus(r.id, "cancelled")}>
                          
                          {t("common.cancel")}
                        </Button>
                      </>
                    ) : null
                  }
                >
                  {edited && r.subAssigned && (
                    <p className="text-xs italic text-blue-600 dark:text-blue-400">
                      
                      {t("scheduleDayDialog.theSubcontractorHasAssignedThisAdditiona")}
                    </p>
                  )}
                  {edited && canAct && !editing && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={() => void confirmChanges(r.id)}>
                        
                        {t("scheduleDayDialog.confirmChanges")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setResend({ id: r.id, start: r.startTime ?? "07:00", end: r.endTime ?? "15:30" })}
                      >
                        
                        {t("scheduleDayDialog.editResend")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus(r.id, "cancelled")}>
                        
                        {t("common.cancel")}
                      </Button>
                    </div>
                  )}
                  {editing && (
                    <div className="space-y-2 rounded-md border bg-muted/15 p-2">
                      <p className="text-xs text-muted-foreground">{t("scheduleDayDialog.changeTheTimeAndSendIt")}{" "}{subName(r.subCompanyId)} {" "}{t("scheduleDayDialog.toConfirm")}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 text-xs text-muted-foreground">
                          
                          {t("scheduleDayDialog.from")}
                          <Input type="time" value={editing.start} onChange={(e) => setResend({ ...editing, start: e.target.value })} />
                        </label>
                        <label className="space-y-1 text-xs text-muted-foreground">
                          
                          {t("scheduleDayDialog.until")}
                          <Input type="time" value={editing.end} onChange={(e) => setResend({ ...editing, end: e.target.value })} />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void editAndResend(r, editing.start, editing.end)}>
                          
                          {t("scheduleDayDialog.resend")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setResend(null)}>
                          
                          {t("common.back")}
                        </Button>
                      </div>
                    </div>
                  )}
                </RequestRow>
              );
            })}
          </div>
        )}
      </div>

      {hasPartialOrHigher && !locked && projectId && (
        <>
          <div className="space-y-2">
            <Label>{t("scheduleDayDialog.selectSubcontractors")}</Label>
            {subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                
                {t("scheduleDayDialog.noSubcontractorsOnThisProjectYet")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3 rounded-md border bg-muted/15 p-3">
                {subs.map((s) => {
                  // Luke's Monthly view greys out a sub nobody has posted hours for that day.
                  const posted = slots.some((slot) => crew.find((e) => e.id === slot.employeeId)?.companyId === s.id);
                  return (
                    <label key={s.id} className={`flex items-center gap-2 text-sm ${posted ? "" : "text-muted-foreground opacity-60"}`}>
                      <Checkbox
                        checked={selectedSubIds.includes(s.id)}
                        onCheckedChange={(checked) =>
                          setSelectedSubIds((prev) => (checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                        }
                      />
                      {s.name}
                      {s.trade && <span className="text-xs text-muted-foreground">· {tradeLabel(s.trade)}</span>}
                      {!posted && <span className="text-xs">{t("scheduleDayDialog.noAvailability")}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {subs.length > 0 && (
            <div className="space-y-2">
              <Label>{t("scheduleDayDialog.availablePersonnelTimeSlots")}</Label>
              <div className="max-h-64 space-y-4 overflow-y-auto rounded-md border bg-muted/15 p-3">
                {availableCrew.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    
                    {t("scheduleDayDialog.noOneFromTheSelectedSubs")}
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
                          const slotWindow = windowOf(slot.startTime, slot.endTime);
                          const taken = takenFor(employee.id);
                          const held = taken
                            .map((t) => ({ ...t, part: clip(t.window, slotWindow) }))
                            .filter((t): t is typeof t & { part: TimeWindow } => t.part !== null);
                          const free = freeWindows(slotWindow, taken.map((t) => t.window));
                          return (
                            <div key={slot.id} className="space-y-1">
                              {slot.stopLabel && <p className="text-xs font-medium text-muted-foreground">{slot.stopLabel}</p>}
                              {held.map((h, i) => (
                                <div
                                  key={`held-${i}`}
                                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                                    h.status === "confirmed"
                                      ? "border-green-300 bg-green-50 text-green-900"
                                      : "border-amber-300 bg-amber-50 text-amber-900"
                                  }`}
                                >
                                  <Lock className="h-3.5 w-3.5 shrink-0" />
                                  <span className="flex-1">
                                    {fmtTime(h.part.start)} – {fmtTime(h.part.end)} · {h.project}
                                  </span>
                                  <Badge variant="outline" className="shrink-0 bg-background/70 text-xs">
                                    {h.status === "confirmed" ? t("scheduleDayDialog.booked") : t("scheduleDayDialog.requested")}
                                  </Badge>
                                </div>
                              ))}
                              {free.map((w) => {
                                const key = `${employee.id}@${w.start}`;
                                const pick = picks[key];
                                return (
                                  <div
                                    key={key}
                                    className={`rounded-md border p-2 text-sm ${pick ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/50"}`}
                                  >
                                    <label className="flex cursor-pointer items-center gap-2">
                                      <Checkbox
                                        checked={!!pick}
                                        onCheckedChange={(checked) =>
                                          setPicks((prev) => {
                                            const next = { ...prev };
                                            if (checked) next[key] = { employeeId: employee.id, window: w, start: w.start, end: w.end };
                                            else delete next[key];
                                            return next;
                                          })
                                        }
                                      />
                                      <Clock className="h-3 w-3 text-muted-foreground" />
                                      <span className="flex-1">
                                        
                                        {t("scheduleDayDialog.free")}{" "}{fmtTime(w.start)} – {fmtTime(w.end)}
                                      </span>
                                    </label>
                                    {pick && (
                                      <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                                        <label className="space-y-1 text-xs text-muted-foreground">
                                          
                                          {t("scheduleDayDialog.bookFrom")}
                                          <Input
                                            type="time"
                                            value={pick.start}
                                            min={w.start}
                                            max={w.end === "24:00" ? undefined : w.end}
                                            onChange={(e) =>
                                              setPicks((prev) => ({ ...prev, [key]: { ...prev[key], start: e.target.value } }))
                                            }
                                          />
                                        </label>
                                        <label className="space-y-1 text-xs text-muted-foreground">
                                          {t("scheduleDayDialog.until")}
                                          <Input
                                            type="time"
                                            value={pick.end === "24:00" ? "23:59" : pick.end}
                                            min={w.start}
                                            max={w.end === "24:00" ? undefined : w.end}
                                            onChange={(e) =>
                                              setPicks((prev) => ({ ...prev, [key]: { ...prev[key], end: e.target.value } }))
                                            }
                                          />
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {free.length === 0 && held.length > 0 && (
                                <p className="pl-1 text-xs text-muted-foreground">{t("scheduleDayDialog.noFreeTimeLeftInThis")}</p>
                              )}
                            </div>
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
            <Label htmlFor="schedule-description">{t("scheduleDayDialog.descriptionWorkToBePerformed")}</Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("scheduleDayDialog.whatTheCrewWillBeDoing")}
              rows={3}
            />
          </div>

          {badPick && (
            <p className="text-sm text-destructive">
              
              {t("scheduleDayDialog.timesForAPickMustStay")}{fmtTime(badPick.window.start)} – {fmtTime(badPick.window.end)}).
            </p>
          )}
          <Button className="w-full" disabled={busy || pickedCount === 0 || !!badPick} onClick={() => void sendRequests()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            
            {t("scheduleDayDialog.sendRequest")}{pickedCount > 1 ? "s" : ""}
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

  // Luke: setting someone's hours on a project they aren't assigned to gets the same one-time exception warning.
  const [availAsk, setAvailAsk] = useState<{ name: string; project: string }[] | null>(null);
  const publishAvailability = (allowUnassigned = false) =>
    run(async () => {
      if (!availAllProjects && !allowUnassigned) {
        const misses: { name: string; project: string }[] = [];
        for (const projectId of availProjectIds) {
          const { employeeIds } = await api.get<{ employeeIds: string[] }>(`/projects/${projectId}/assignments`);
          for (const id of availFor) {
            if (!employeeIds.includes(id)) misses.push({ name: roster.find((e) => e.id === id)?.name ?? t("common.employee"), project: projectName(projectId) });
          }
        }
        if (misses.length > 0) {
          setAvailAsk(misses);
          return;
        }
      }
      setAvailAsk(null);
      // One entry per person: either for every project, or one per chosen project.
      const targets: (string | undefined)[] = availAllProjects ? [undefined] : availProjectIds;
      const blocks = multipleStops
        ? stops.map((stop, i) => ({ startTime: stop.start, endTime: stop.end, stopNumber: i + 1 }))
        : [{ startTime: availStart, endTime: availEnd, stopNumber: undefined }];
      if (blocks.some((b) => b.startTime >= b.endTime)) throw new Error(t("scheduleDayDialog.eachStartTimeMustBeBefore"));
      for (const employeeId of availFor) {
        for (const projectId of targets) {
          for (const block of blocks) {
            await api.post("/availability", {
              date: day,
              employeeId,
              allProjects: availAllProjects,
              projectId,
              ...block,
            });
          }
        }
      }
    });

  // "Assign Personnel to Job": people with hours posted today, placed on a connected project.
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignPeople, setAssignPeople] = useState<string[]>([]);
  const [assignStart, setAssignStart] = useState("07:00");
  const [assignEnd, setAssignEnd] = useState("15:30");
  const [assignNotifyGc, setAssignNotifyGc] = useState(true);
  const [unassignedAsk, setUnassignedAsk] = useState<BatchResult["unassigned"] | null>(null);
  const workingToday = roster.filter((e) => myAvailability.some((s) => s.employeeId === e.id));

  const pickToAssign = (employeeId: string, on: boolean) => {
    setUnassignedAsk(null);
    setAssignPeople((prev) => {
      // The first person picked sets the times to their posted hours.
      const slot = myAvailability.find((s) => s.employeeId === employeeId);
      if (on && prev.length === 0 && slot) {
        setAssignStart(slot.startTime.slice(0, 5));
        setAssignEnd(slot.endTime.slice(0, 5));
      }
      return on ? [...prev, employeeId] : prev.filter((id) => id !== employeeId);
    });
  };

  const assignToJob = (allowUnassigned: boolean) =>
    run(async () => {
      if (!(assignStart < assignEnd)) throw new Error(t("scheduleDayDialog.theStartTimeMustBeBefore"));
      const create = assignPeople.map((employeeId) => ({
        projectId: assignProjectId,
        subCompanyId: companyId ?? "",
        employeeIds: [employeeId],
        date: day ?? "",
        startTime: assignStart,
        endTime: assignEnd,
      }));
      if (!allowUnassigned) {
        const dry = await matrixApi.sendBatch({ create, cancel: [], dryRun: true });
        if (dry.skipped.length > 0) throw new Error(dry.skipped.map((s) => s.reason).join(" "));
        if (dry.unassigned.length > 0) {
          setUnassignedAsk(dry.unassigned);
          return;
        }
      }
      const res = await matrixApi.sendBatch({
        create,
        cancel: [],
        allowUnassigned,
        notify: { gcEmail: false, gcPush: assignNotifyGc, personnelEmail: false, personnelPush: false },
      });
      if (res.skipped.length > 0) throw new Error(res.skipped.map((s) => s.reason).join(" "));
      setUnassignedAsk(null);
      setAssignPeople([]);
    });

  const respond = (r: ScheduleRequest) =>
    hasPartialOrHigher && !locked ? (
      <>
        <Button size="sm" disabled={busy} onClick={() => void setStatus(r.id, "confirmed")}>
          
          {t("scheduleDayDialog.confirm")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(r.id, "rejected")}>
          
          {t("common.decline")}
        </Button>
      </>
    ) : null;

  const subView = (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>{t("scheduleDayDialog.pendingRequests")}</Label>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scheduleDayDialog.noRequestsWaitingOnYouFor")}</p>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                label={projectName(r.projectId)}
                names={namesOf(r)}
                actions={respond(r)}
                edited={editedFor(r, companyId)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmed.length > 0 && (
        <div className="space-y-2">
          <Label>{t("scheduleDayDialog.confirmedSchedules")}</Label>
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
                      
                      {t("common.cancel")}
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
          <Label className="text-red-600">{t("scheduleDayDialog.rejectedCancelled")}</Label>
          <div className="space-y-2">
            {closed.map((r) => (
              <RequestRow key={r.id} request={r} label={projectName(r.projectId)} names={namesOf(r)} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>{t("scheduleDayDialog.postedAvailability")}</Label>
        {myAvailability.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("scheduleDayDialog.noAvailabilityPostedForThisDay")}</p>
        ) : (
          <div className="space-y-1">
            {myAvailability.map((slot) => (
              <div key={slot.id} className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="flex-1">
                  {nameById.get(slot.employeeId) ?? t("scheduleDayDialog.employee")}
                  {slot.stopLabel ? ` (${slot.stopLabel})` : ""}: {fmtTime(slot.startTime)} - {fmtTime(slot.endTime)}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {slot.allProjects ? t("scheduleDayDialog.allProjects") : projectName(slot.projectId ?? "")}
                  </span>
                </span>
                {canRemove(slot) && !locked && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={t("scheduleDayDialog.removeAvailability")}
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

      {!locked && hasPartialOrHigher && connectedProjects.length > 0 && workingToday.length > 0 && (
        // Luke's "Assign Personnel to Job": the sub books its own crew (confirmed straight away).
        <div className="space-y-3 border-t pt-4">
          <Label htmlFor="assign-project">{t("scheduleDayDialog.assignPersonnelToJob")}</Label>
          <select
            id="assign-project"
            value={assignProjectId}
            onChange={(e) => {
              setAssignProjectId(e.target.value);
              setUnassignedAsk(null);
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("scheduleDayDialog.chooseAProject")}</option>
            {connectedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="space-y-1 rounded-md border p-2">
            {workingToday.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox checked={assignPeople.includes(e.id)} onCheckedChange={(value) => pickToAssign(e.id, !!value)} />
                {e.name}
                {titleOf(e) && <span className="text-muted-foreground"> - {titleOf(e)}</span>}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="assign-start" className="text-xs">
                
                {t("scheduleDayDialog.from")}
              </Label>
              <Input id="assign-start" type="time" value={assignStart} onChange={(e) => setAssignStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="assign-end" className="text-xs">
                
                {t("scheduleDayDialog.until")}
              </Label>
              <Input id="assign-end" type="time" value={assignEnd} onChange={(e) => setAssignEnd(e.target.value)} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={assignNotifyGc} onCheckedChange={(value) => setAssignNotifyGc(!!value)} />
            
            {t("scheduleDayDialog.notifyTheGeneralContractor")}
          </label>
          {unassignedAsk ? (
            <div role="alertdialog" aria-label={t("scheduleDayDialog.unassignedEmployeePlacement")} className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                
                {t("scheduleDayDialog.unassignedEmployeePlacement")}
              </p>
              <p className="text-sm text-muted-foreground">
                
                {t("scheduleDayDialog.youVeAssignedOneOrMore")}
              </p>
              <ul className="space-y-1 text-sm">
                {unassignedAsk.map((u) => (
                  <li key={u.employeeId}>
                    <span className="font-medium">{u.employeeName}</span>
                    {u.jobTitle && <span className="text-muted-foreground"> – {jobTitleLabel(u.jobTitle)}</span>}
                    <span className="text-muted-foreground"> {" "}{t("scheduleDayDialog.isNotAssignedTo")}{" "}</span>
                    <span className="font-medium">{u.projectName}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setUnassignedAsk(null)}>
                  
                  {t("common.cancel")}
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void assignToJob(true)}>
                  
                  {t("scheduleDayDialog.proceed")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={busy || !assignProjectId || assignPeople.length === 0}
              onClick={() => void assignToJob(false)}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              
              {t("scheduleDayDialog.assignToJob")}
            </Button>
          )}
        </div>
      )}

      {!locked && postable.length > 0 && (
        // Laid out like Lovable's "View Availability" panel.
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <Label>{t("scheduleDayDialog.whoIsAvailable")}</Label>
            {postable.length > 1 && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() =>
                  setAvailFor(availFor.length === postable.length ? [] : postable.map((e) => e.id))
                }
              >
                {availFor.length === postable.length ? t("scheduleDayDialog.clearAll") : t("scheduleDayDialog.selectAll")}
              </Button>
            )}
            <div className="space-y-2 rounded-md border p-2">
              {postable.map((e) => {
                const checked = availFor.includes(e.id);
                return (
                  <label
                    key={e.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm shadow-sm transition-colors ${
                      checked ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setAvailFor((prev) => (value ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                      }
                    />
                    <span>
                      {e.name}
                      {titleOf(e) && ` - ${titleOf(e)}`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border bg-muted/40 px-3 py-2.5 text-sm font-medium">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              
              {t("scheduleDayDialog.multipleStops")}
            </span>
            <Switch checked={multipleStops} onCheckedChange={setMultipleStops} aria-label={t("scheduleDayDialog.multipleStops2")} />
          </label>

          {multipleStops ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="stop-count">{t("scheduleDayDialog.numberOfStops")}</Label>
                <select
                  id="stop-count"
                  value={stops.length}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStops((prev) =>
                      Array.from({ length: n }, (_, i) => prev[i] ?? { start: prev[i - 1]?.end ?? "08:00", end: "17:00" }),
                    );
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {t(n === 1 ? "scheduleDayDialog.stops.one" : "scheduleDayDialog.stops.other", { count: n })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 rounded-md border p-2">
                {stops.map((stop, i) => (
                  <div key={i} className="space-y-2 rounded-md bg-muted/40 p-3">
                    <p className="text-sm font-medium">{t("scheduleDayDialog.stop")}{i + 1}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`stop-${i}-start`} className="text-xs">
                          
                          {t("common.start")}
                        </Label>
                        <Input
                          id={`stop-${i}-start`}
                          type="time"
                          value={stop.start}
                          onChange={(e) =>
                            setStops((prev) => prev.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`stop-${i}-end`} className="text-xs">
                          
                          {t("common.end")}
                        </Label>
                        <Input
                          id={`stop-${i}-end`}
                          type="time"
                          value={stop.end}
                          onChange={(e) =>
                            setStops((prev) => prev.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="avail-start">{t("common.start")}</Label>
                <Input id="avail-start" type="time" value={availStart} onChange={(e) => setAvailStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="avail-end">{t("common.end")}</Label>
                <Input id="avail-end" type="time" value={availEnd} onChange={(e) => setAvailEnd(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={availAllProjects} onCheckedChange={(value) => setAvailAllProjects(!!value)} />
              
              {t("scheduleDayDialog.availableForAllProjects")}
            </label>
            {!availAllProjects && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t("scheduleDayDialog.assignToSpecificProjectS")}</Label>
                <div className="space-y-1 rounded-md border p-2">
                  {connectedProjects.length === 0 ? (
                    <p className="p-1 text-sm text-muted-foreground">{t("scheduleDayDialog.youArenTConnectedToAny")}</p>
                  ) : (
                    connectedProjects.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={availProjectIds.includes(p.id)}
                          onCheckedChange={(value) =>
                            setAvailProjectIds((prev) => (value ? [...prev, p.id] : prev.filter((id) => id !== p.id)))
                          }
                        />
                        {p.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {availAsk ? (
            <div role="alertdialog" aria-label={t("scheduleDayDialog.unassignedEmployeePlacement")} className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                
                {t("scheduleDayDialog.unassignedEmployeePlacement")}
              </p>
              <p className="text-sm text-muted-foreground">
                
                {t("scheduleDayDialog.youVeAssignedOneOrMore2")}
              </p>
              <ul className="space-y-1 text-sm">
                {availAsk.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground"> {" "}{t("scheduleDayDialog.isNotAssignedTo")}{" "}</span>
                    <span className="font-medium">{m.project}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setAvailAsk(null)}>
                  
                  {t("common.cancel")}
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void publishAvailability(true)}>
                  
                  {t("scheduleDayDialog.yesProceedWithException")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              disabled={busy || availFor.length === 0 || (!availAllProjects && availProjectIds.length === 0)}
              onClick={() => void publishAvailability()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              
              {t("scheduleDayDialog.postAvailability")}
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {viewMode === "gc"
              ? t("schedule.scheduleSubcontractor")
              : locked
                ? t("schedule.viewAvailability")
                : t("schedule.setAvailability")}
          </DialogTitle>
          <DialogDescription>{date ? formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : ""}</DialogDescription>
        </DialogHeader>

        {locked && (
          <p className="flex items-center gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            
            {t("scheduleDayDialog.thisDayIsBeforeTheCurrent")}
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
