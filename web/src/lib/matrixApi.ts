/**
 * Contract for the rebuilt Weekly view (docs/WEEKLY_VIEW_REBUILD.md, section 2).
 * Owned by Claude Code; the screens (web/src/components/matrix/*, opencode) import from here.
 *
 * Until the backend endpoints land, build against `mockMatrix()`. Switching to the real API is one
 * line: call `matrixApi.load(...)` instead.
 */
import { api } from "@/lib/api";
import { tr } from "@/i18n/runtime";

export type CompanyType = "gc" | "sub";
export type BookingStatus = "pending" | "confirmed";
export type PermissionLevel = "basic" | "level_1" | "partial" | "full" | "account_holder";

export interface TimeSpan {
  /** "HH:MM", 24-hour; "24:00" = end of day. */
  start: string;
  end: string;
}

export interface MatrixProject {
  id: string;
  name: string;
  address: string | null;
  ownerCompanyId: string;
  ownerName: string;
}

export interface MatrixEmployee {
  id: string;
  name: string;
  jobTitle: string | null;
  /** Projects this person is officially assigned to (Team page). Dropping them elsewhere = red outline. */
  assignedProjectIds: string[];
}

export interface MatrixCrew {
  companyId: string;
  companyName: string;
  trade: string | null;
  /** The shown projects this crew can be placed on (GC: projects it's connected to; sub: all shown). */
  projectIds: string[];
  employees: MatrixEmployee[];
}

/** Posted hours, plus what is still free once requests/bookings on any project are taken out. */
export interface MatrixAvailability {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  stopLabel: string | null;
  projectId: string | null;
  allProjects: boolean;
  free: TimeSpan[];
}

export interface MatrixBooking {
  requestId: string;
  groupId: string | null;
  projectId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: BookingStatus;
  /** Created by the sub for its own crew (already confirmed). */
  assignedBySub: boolean;
  /** Held by a different GC: show the person as unavailable, without project details. */
  otherGc: boolean;
  /** The other side changed this request; the GC sees an "Edited" tag until Confirm Changes. */
  edited: boolean;
  lastEditedByCompanyId: string | null;
  /** The sub published without notifying the GC; it only shows up in the app. */
  silent: boolean;
}

export interface MatrixTask {
  id: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
}

export interface MatrixData {
  days: string[];
  viewer: {
    companyId: string;
    companyType: CompanyType;
    permissionLevel: PermissionLevel;
    canSchedule: boolean;
    canAssignOwnCrew: boolean;
    /** level_1 and up may confirm the "Unassigned employee placement" exception; basic gets a toast. */
    canMakeException: boolean;
  };
  projects: MatrixProject[];
  crews: MatrixCrew[];
  availability: MatrixAvailability[];
  bookings: MatrixBooking[];
  tasks: MatrixTask[];
}

export interface BatchCreate {
  projectId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}

/** Change an existing request: move it, or add/remove people (an empty list cancels it). */
export interface BatchUpdate {
  requestId: string;
  employeeIds: string[];
  date?: string;
  projectId?: string;
  startTime?: string;
  endTime?: string;
}

export interface NotifyChoice {
  gcEmail: boolean;
  gcPush: boolean;
  personnelEmail: boolean;
  personnelPush: boolean;
}

export interface BatchBody {
  create: BatchCreate[];
  update?: BatchUpdate[];
  /** Request ids to cancel. */
  cancel: string[];
  /** Validate only: report what would be created or skipped, change nothing. */
  dryRun?: boolean;
  /** The user confirmed the "Unassigned employee placement" dialog. */
  allowUnassigned?: boolean;
  /** Sub publish only (the "Notify General Contractors?" dialog). Omitted = silent. */
  notify?: NotifyChoice;
  editReason?: string;
}

export interface BatchResult {
  groupId: string;
  created: { requestId: string; index: number }[];
  updated: string[];
  cancelled: string[];
  /** `index` points into `create` (or `update` when `kind` is "update"); `reason` is ready to show. */
  skipped: { kind: "create" | "update"; index: number; reason: string }[];
  /** Placements of people on projects they aren't assigned to. A dry run fills this so the UI can ask first. */
  unassigned: { employeeId: string; employeeName: string; jobTitle: string | null; projectId: string; projectName: string; date: string }[];
  /** What was actually sent. Email is false when no mail domain is set up yet. */
  notified: { email: boolean; push: boolean };
}

export const matrixApi = {
  load: (params: { start: string; days: number; projectId?: string }) => {
    const q = new URLSearchParams({ start: params.start, days: String(params.days) });
    if (params.projectId) q.set("projectId", params.projectId);
    return api.get<MatrixData>(`/matrix?${q.toString()}`);
  },
  sendBatch: (body: BatchBody) => api.post<BatchResult>("/schedule-requests/batch", body),
  /** GC "Confirm Changes" on an Edited request. */
  acknowledgeEdit: (requestId: string) => api.post<{ ok: true }>(`/schedule-requests/${requestId}/acknowledge-edit`, {}),
};

// ---------------------------------------------------------------------------
// Mock data: enough to build every state of the screens (free, requested,
// booked, other-GC, two stops, tasks, weekend). Mirrors the demo seed.
// ---------------------------------------------------------------------------

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function mockMatrix(start: string, days = 14, viewer: CompanyType = "gc"): MatrixData {
  const base = new Date(`${start}T00:00:00`);
  const dayList = Array.from({ length: days }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const weekday = (date: string) => new Date(`${date}T00:00:00`).getDay(); // 0 Sun .. 6 Sat

  const projects: MatrixProject[] = [
    { id: "p-riverside", name: "Riverside Office Build", address: "4100 River Rd, College Park, MD", ownerCompanyId: "c-gc", ownerName: "Terrapin Builders" },
    { id: "p-mainst", name: "Main St Retail Fit-Out", address: "120 Main St, Hyattsville, MD", ownerCompanyId: "c-gc", ownerName: "Terrapin Builders" },
    { id: "p-elm", name: "Elm Street Clinic Renovation", address: "45 Elm St", ownerCompanyId: "c-gc", ownerName: "Terrapin Builders" },
  ];
  const crews: MatrixCrew[] = [
    {
      companyId: "c-plumbing", companyName: "Bao Plumbing", trade: "Plumbing", projectIds: ["p-riverside", "p-mainst"],
      employees: [
        { id: "e-mike", name: "Mike Rivera", jobTitle: "Foreman", assignedProjectIds: ["p-riverside", "p-mainst"] },
        { id: "e-pete", name: "Pete Alvarez", jobTitle: "Journeyman Plumber", assignedProjectIds: ["p-riverside"] },
        { id: "e-luis", name: "Luis Ortega", jobTitle: "Apprentice Plumber", assignedProjectIds: ["p-riverside"] },
      ],
    },
    {
      companyId: "c-drywall", companyName: "Capitol Drywall", trade: "Drywall", projectIds: ["p-riverside"],
      employees: [{ id: "e-marco", name: "Marco Diaz", jobTitle: "Drywall Hanger", assignedProjectIds: ["p-riverside", "p-mainst"] }],
    },
    {
      companyId: "c-electric", companyName: "Volt Electric", trade: "Electrical", projectIds: ["p-riverside", "p-mainst", "p-elm"],
      employees: [{ id: "e-dev", name: "Dev Patel", jobTitle: "Electrician", assignedProjectIds: ["p-mainst"] }],
    },
  ];

  const availability: MatrixAvailability[] = [];
  const bookings: MatrixBooking[] = [];
  let n = 0;
  const avail = (employeeId: string, date: string, startTime: string, endTime: string, free: TimeSpan[], stopLabel: string | null = null) =>
    availability.push({ id: `a${n++}`, employeeId, date, startTime, endTime, stopLabel, projectId: null, allProjects: true, free });

  dayList.forEach((date, i) => {
    const wd = weekday(date);
    const workday = wd >= 1 && wd <= 5;
    if (workday) {
      // Mike + Pete booked all day Mondays on Riverside; free other weekdays.
      if (wd === 1) {
        avail("e-mike", date, "07:00", "15:30", []);
        avail("e-pete", date, "07:00", "15:30", []);
        bookings.push({ requestId: `r${n++}`, groupId: "g1", projectId: "p-riverside", subCompanyId: "c-plumbing", employeeIds: ["e-mike", "e-pete"], date, startTime: "07:00", endTime: "15:30", status: "confirmed", assignedBySub: false, otherGc: false, edited: false, lastEditedByCompanyId: null, silent: false });
      } else {
        // Tuesdays: the sub put Mike on Main St itself (confirmed, "Edited" until the GC confirms it).
        if (wd === 2) {
          avail("e-mike", date, "07:00", "15:30", []);
          bookings.push({ requestId: `r${n++}`, groupId: "g2", projectId: "p-mainst", subCompanyId: "c-plumbing", employeeIds: ["e-mike"], date, startTime: "07:00", endTime: "15:30", status: "confirmed", assignedBySub: true, otherGc: false, edited: true, lastEditedByCompanyId: "c-plumbing", silent: false });
        } else {
          avail("e-mike", date, "07:00", "15:30", [{ start: "07:00", end: "15:30" }]);
        }
        avail("e-pete", date, "07:00", "15:30", [{ start: "07:00", end: "15:30" }]);
      }
      // Luis requested mornings on Wednesdays; afternoon still free.
      if (wd === 3) {
        avail("e-luis", date, "07:00", "15:30", [{ start: "12:00", end: "15:30" }]);
        bookings.push({ requestId: `r${n++}`, groupId: null, projectId: "p-riverside", subCompanyId: "c-plumbing", employeeIds: ["e-luis"], date, startTime: "07:00", endTime: "12:00", status: "pending", assignedBySub: false, otherGc: false, edited: false, lastEditedByCompanyId: null, silent: false });
      } else {
        avail("e-luis", date, "07:00", "15:30", [{ start: "07:00", end: "15:30" }]);
      }
      // Marco free Tue–Fri, booked by another GC on Thursdays.
      if (wd >= 2) {
        if (wd === 4) {
          avail("e-marco", date, "07:00", "15:00", []);
          bookings.push({ requestId: `r${n++}`, groupId: null, projectId: "other", subCompanyId: "c-drywall", employeeIds: ["e-marco"], date, startTime: "07:00", endTime: "15:00", status: "confirmed", assignedBySub: false, otherGc: true, edited: false, lastEditedByCompanyId: null, silent: false });
        } else {
          avail("e-marco", date, "07:00", "15:00", [{ start: "07:00", end: "15:00" }]);
        }
      }
      // Dev Mon/Wed/Fri.
      if (wd % 2 === 1) avail("e-dev", date, "08:00", "16:00", [{ start: "08:00", end: "16:00" }]);
    }
    // Mike at two sites on the first Saturday.
    if (wd === 6 && i < 7) {
      avail("e-mike", date, "06:00", "10:00", [{ start: "06:00", end: "10:00" }], "Stop #1");
      avail("e-mike", date, "13:00", "17:00", [{ start: "13:00", end: "17:00" }], "Stop #2");
    }
  });

  const tasks: MatrixTask[] = [
    { id: "t1", projectId: "p-riverside", name: "Plumbing rough-in", startDate: dayList[0], endDate: dayList[Math.min(4, days - 1)], color: "#0ea5e9" },
    { id: "t2", projectId: "p-riverside", name: "Drywall hang & finish", startDate: dayList[Math.min(3, days - 1)], endDate: dayList[days - 1], color: "#22c55e" },
    { id: "t3", projectId: "p-mainst", name: "Electrical rough-in", startDate: dayList[Math.min(2, days - 1)], endDate: dayList[Math.min(9, days - 1)], color: "#f59e0b" },
  ];

  const isGc = viewer === "gc";
  return {
    days: dayList,
    viewer: {
      companyId: isGc ? "c-gc" : "c-plumbing",
      companyType: viewer,
      permissionLevel: "account_holder",
      canSchedule: true,
      canAssignOwnCrew: !isGc,
      canMakeException: true,
    },
    projects: isGc ? projects : projects.filter((p) => p.id !== "p-elm"),
    crews: isGc ? crews : crews.filter((c) => c.companyId === "c-plumbing"),
    availability: isGc ? availability : availability.filter((a) => ["e-mike", "e-pete", "e-luis"].includes(a.employeeId)),
    bookings: isGc ? bookings : bookings.filter((b) => b.subCompanyId === "c-plumbing"),
    tasks,
  };
}

/**
 * Stand-in for `matrixApi.sendBatch` while the endpoint is being built. It applies the same checks the
 * server will: unassigned placements (dry run lists them; a real send skips them unless
 * `allowUnassigned`), and people with no free time covering the slot. Good enough to drive every dialog.
 */
export function mockSendBatch(data: MatrixData, body: BatchBody): BatchResult {
  const employees = new Map(data.crews.flatMap((c) => c.employees).map((e) => [e.id, e]));
  const projectName = (id: string) => data.projects.find((p) => p.id === id)?.name ?? "Project";
  const result: BatchResult = { groupId: "mock-group", created: [], updated: [], cancelled: [], skipped: [], unassigned: [], notified: { email: false, push: !!body.notify && (body.notify.gcPush || body.notify.personnelPush) } };

  body.create.forEach((c, index) => {
    for (const id of c.employeeIds) {
      const emp = employees.get(id);
      if (!emp) continue;
      if (data.viewer.companyType === "sub" && !emp.assignedProjectIds.includes(c.projectId)) {
        result.unassigned.push({ employeeId: id, employeeName: emp.name, jobTitle: emp.jobTitle, projectId: c.projectId, projectName: projectName(c.projectId), date: c.date });
        if (!body.dryRun && !body.allowUnassigned) {
          result.skipped.push({ kind: "create", index, reason: tr("matrixApi.isNotAssignedTo", { name: emp.name, projectId: projectName(c.projectId) }) });
          return;
        }
      }
      const free = data.availability.filter((a) => a.employeeId === id && a.date === c.date).flatMap((a) => a.free);
      const start = c.startTime ?? "00:00";
      const end = c.endTime ?? "24:00";
      if (!free.some((f) => f.start <= start && f.end >= end)) {
        result.skipped.push({ kind: "create", index, reason: tr("matrixApi.isnTFreeThenOnPick", { name: emp.name, date: c.date }) });
        return;
      }
    }
    if (!body.dryRun) result.created.push({ requestId: `mock-${index}`, index });
  });
  if (!body.dryRun) {
    result.updated = (body.update ?? []).map((u) => u.requestId);
    result.cancelled = [...body.cancel];
  }
  return result;
}
