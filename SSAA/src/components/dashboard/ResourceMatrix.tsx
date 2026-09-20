import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, pointerWithin, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { format, addDays, startOfWeek, parseISO } from 'date-fns';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import MatrixEmployeeCard, { MatrixEmployee, CardStatus } from './MatrixEmployeeCard';
import MatrixDraftBar, { DraftChange } from './MatrixDraftBar';
import MatrixSidebar from './MatrixSidebar';
import MatrixSubSidebar from './MatrixSubSidebar';
import NotifyOnAssignDialog from './NotifyOnAssignDialog';
import UnassignedAssignmentDialog, { UnassignedPair } from './UnassignedAssignmentDialog';
import { supabase } from '@/integrations/supabase/client';
import { sendNotification } from '@/hooks/useNotification';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useFirstClickTooltip } from '@/components/onboarding/useFirstClickTooltip';
import FirstClickTooltip from '@/components/onboarding/FirstClickTooltip';
import { getCalendarTipCopy, calendarTipKey, type TourRole } from '@/components/onboarding/tourSteps';

interface Project {
  id: string;
  name: string;
  company_id: string;
}

interface ScheduleRequest {
  id: string;
  project_id: string;
  sub_company_id: string;
  requesting_company_id: string;
  scheduled_date: string;
  status: string | null;
  employee_ids?: string[];
  sub_assigned?: boolean;
  cancelled_by_company_id?: string | null;
  request_group_id?: string | null;
  /** Per-employee stop selection: employee_id -> availability ids. Missing/empty = all stops. */
  employee_stops?: Record<string, string[]> | null;
}

interface TaskItem {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  project_id: string;
}

interface SubCompanyInfo {
  id: string;
  name: string;
  trade?: string | null;
}

interface AvailabilityRecord {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  all_projects: boolean | null;
  stop_number?: number | null;
  stop_label?: string | null;
}

interface ResourceMatrixProps {
  projects: Project[];
  employees: MatrixEmployee[];
  scheduleRequests: ScheduleRequest[];
  companyId: string;
  onDataChanged?: () => void;
  tasks?: TaskItem[];
  showTaskOverlay?: boolean;
  onToggleTaskOverlay?: (show: boolean) => void;
  singleProjectMode?: boolean;
  viewMode?: 'gc' | 'sub' | 'moa';
  connectedSubs?: SubCompanyInfo[];
  allEmployees?: MatrixEmployee[];
  availabilities?: AvailabilityRecord[];
  /** Set of `${employeeId}::${date}` keys for sub employees booked by ANOTHER GC.
   *  These employees are silently filtered from the GC's available roster. */
  crossGcBookings?: Set<string>;
  /** All projects owned by the active GC (used to label cross-project bookings within the same GC). */
  allCompanyProjects?: Project[];
  /** Map of employee_id -> Set of project_ids they're assigned to (sub side). */
  employeeProjectAssignments?: Map<string, Set<string>>;
  /** Permission level of the current user — controls whether unassigned exception is allowed. */
  permissionLevel?: 'standard' | 'partial' | 'full' | 'account_holder' | 'basic' | 'level_1' | null;
  /** Optional callback invoked when the sub opts to notify scheduled personnel immediately. */
  onNotifyPersonnel?: (requestId: string, options?: { email?: boolean; sms?: boolean }) => Promise<void> | void;
  /** Effective sender, including the impersonated user when an operator acts for them. */
  senderUserId?: string | null;
  /** True only for Level 3, Level 4, account-holder, or an unimpersonated MOA. */
  canActOnRequests?: boolean;
  /** Linked employee for a restricted personnel viewer. */
  viewerEmployeeId?: string | null;
  /** Map of sub-of-sub company id -> main subcontractor company id sitting between them and the GC. */
  intermediaryByCompanyId?: Record<string, string>;
}

// Droppable cell wrapper
const DroppableCell = ({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] p-1 transition-colors ${isOver ? 'bg-primary/10' : ''} ${className || ''}`}
    >
      {children}
    </div>
  );
};

const getDensity = (count: number): 'full' | 'compact' | 'minimal' => {
  if (count <= 3) return 'full';
  if (count <= 6) return 'compact';
  return 'minimal';
};

// Resolve the employee id from either dragId format:
//   matrix::<projectId>::<dateStr>::<empId>[::<stopId>]  → parts[3]
//   sidebar::<empId>[::<availId>]                         → parts[1]
const empIdFromDragId = (dragId: string): string | null => {
  const parts = dragId.split('::');
  if (parts[0] === 'matrix' && parts.length >= 4) return parts[3];
  if (parts[0] === 'sidebar' && parts.length >= 2) return parts[1];
  return null;
};

// Convert a UTC timestamp to YYYY-MM-DD using getUTC* (timezone agnostic).
const availabilityDateStr = (ts: string): string => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const ResourceMatrix = ({ projects, employees, scheduleRequests, companyId, onDataChanged, tasks = [], showTaskOverlay = false, onToggleTaskOverlay, singleProjectMode = false, viewMode = 'sub', connectedSubs = [], allEmployees = [], availabilities = [], crossGcBookings = new Set<string>(), allCompanyProjects, employeeProjectAssignments, permissionLevel, onNotifyPersonnel, senderUserId, canActOnRequests = true, viewerEmployeeId = null, intermediaryByCompanyId = {} }: ResourceMatrixProps) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const effectiveTourRole: TourRole =
    viewMode === 'sub'
      ? (Object.keys(intermediaryByCompanyId || {}).length > 0 ? 'mainsub' : 'sub')
      : 'gc';
  const weeklyTip = useFirstClickTooltip(calendarTipKey('weekly'));
  useEffect(() => {
    const timer = window.setTimeout(() => weeklyTip.trigger(), 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Company that owns a given employee (falls back to the acting company). */
  const employeeCompanyId = useCallback((employeeId: string): string => {
    const emp = employees.find(e => e.id === employeeId) || allEmployees.find(e => e.id === employeeId);
    return emp?.company_id || companyId;
  }, [employees, allEmployees, companyId]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableCellElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const mobileSentinelRef = useRef<HTMLDivElement>(null);

  const [weeksLoaded, setWeeksLoaded] = useState(1);
  const columnMinWidth = singleProjectMode
    ? (weeksLoaded === 1 ? 220 : weeksLoaded === 2 ? 180 : weeksLoaded === 3 ? 150 : 130)
    : (weeksLoaded === 1 ? 200 : weeksLoaded === 2 ? 160 : weeksLoaded === 3 ? 130 : 110);
  const [draftChanges, setDraftChanges] = useState<DraftChange[]>([]);
  
  // Copy schedule state
  const [copiedSchedule, setCopiedSchedule] = useState<{
    sourceDate: string;
    assignments: { projectId: string; employeeIds: string[] }[];
  } | null>(null);
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [showPasteConfirm, setShowPasteConfirm] = useState(false);
  const [activeEmployee, setActiveEmployee] = useState<MatrixEmployee | null>(null);
  // Multi-select on weekly grid: set of dragIds currently selected (chips can include stopId).
  const [selectedChipIds, setSelectedChipIds] = useState<Set<string>>(new Set());
  // Count of items being moved as a multi-select drag group (for DragOverlay badge).
  const [activeDragCount, setActiveDragCount] = useState(1);

  // Drag sensors: require 5px movement before starting a drag so plain clicks
  // (used for chip multi-select toggle) are not swallowed by dnd-kit.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Esc clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedChipIds(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleChipSelection = useCallback((dragId: string) => {
    setSelectedChipIds(prev => {
      const next = new Set(prev);
      if (next.has(dragId)) next.delete(dragId);
      else next.add(dragId);
      return next;
    });
  }, []);
  const [isPublishing, setIsPublishing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGridSubs, setCollapsedGridSubs] = useState<Set<string>>(new Set());
  const toggleGridSubCollapsed = useCallback((subId: string) => {
    setCollapsedGridSubs(prev => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId); else next.add(subId);
      return next;
    });
  }, []);
  // Weekly view: per-project collapse (desktop + mobile). Toggling NEVER touches chip selection.
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set());
  const toggleProjectCollapse = useCallback((projectId: string) => {
    if (!canActOnRequests) return;
    setCollapsedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }, [canActOnRequests]);
  const [selectedMobileProjects, setSelectedMobileProjects] = useState<string[]>([]);

  const [selectedWeeklyDate, setSelectedWeeklyDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // GC publish: notify-channel modal state
  const [showNotifyDialog, setShowNotifyDialog] = useState(false);
  // Sub publish: cross-project exception confirmation state
  const [showUnassignedDialog, setShowUnassignedDialog] = useState(false);
  const [pendingPublishNotify, setPendingPublishNotify] = useState<{ email: boolean; sms: boolean; notifyPersonnelEmail?: boolean; notifyPersonnelSms?: boolean } | null>(null);
  // Active drag chip's time/stop label for the DragOverlay.
  const [activeDragTimeLabel, setActiveDragTimeLabel] = useState<string | undefined>(undefined);
  const [activeDragStopLabel, setActiveDragStopLabel] = useState<string | undefined>(undefined);

  // Endless week loading: append a chunk of weeks whenever the user reaches the end.
  // The ceiling is a DOM-size safety net (~2 years), not a product limit.
  const WEEK_CHUNK = 4;
  const MAX_WEEKS = 104;

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const visibleDays = useMemo(() => {
    const days: Date[] = [];
    const totalDays = weeksLoaded * 7;
    for (let i = 0; i < totalDays; i++) {
      days.push(addDays(weekStart, i));
    }
    return days;
  }, [weekStart, weeksLoaded]);

  const visibleDateStrings = useMemo(() => visibleDays.map(d => format(d, 'yyyy-MM-dd')), [visibleDays]);

  // Lazy loading via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || isMobile || weeksLoaded >= MAX_WEEKS) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setWeeksLoaded(prev => Math.min(prev + WEEK_CHUNK, MAX_WEEKS));
        }
      },
      { root: scrollContainerRef.current, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [weeksLoaded, isMobile]);

  // Mobile: horizontal lazy loading — load more weeks of day columns as user scrolls right
  useEffect(() => {
    if (!isMobile || !mobileSentinelRef.current || weeksLoaded >= MAX_WEEKS) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setWeeksLoaded(prev => Math.min(prev + WEEK_CHUNK, MAX_WEEKS));
        }
      },
      { root: mobileScrollRef.current, threshold: 0.1, rootMargin: '0px 200px 0px 0px' }
    );
    observer.observe(mobileSentinelRef.current);
    return () => observer.disconnect();
  }, [weeksLoaded, isMobile, selectedMobileProjects.length]);

  // ---- Canonical stop identity -------------------------------------------------
  // The same real shift is stored once per project it was made available to, so one
  // shift can exist as several availability rows with different ids. Everything that
  // identifies a stop (chips, drafts, saved requests, sidebar filters) resolves through
  // this map so the same shift always compares equal, whichever duplicate row it came in as.
  const stopIdentity = useMemo(() => {
    const canonicalById = new Map<string, string>();
    const siblingsByCanonical = new Map<string, string[]>();
    const groups = new Map<string, string[]>();
    availabilities.forEach(a => {
      const d = new Date(a.start_time);
      const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const key = `${a.employee_id}::${ds}::${a.stop_number != null ? `stop::${a.stop_number}` : `range::${a.start_time}::${a.end_time}`}`;
      const list = groups.get(key) || [];
      list.push(a.id);
      groups.set(key, list);
    });
    groups.forEach(list => {
      const canonical = [...list].sort()[0];
      siblingsByCanonical.set(canonical, list);
      list.forEach(id => canonicalById.set(id, canonical));
    });
    return { canonicalById, siblingsByCanonical };
  }, [availabilities]);

  /** Resolve any availability row id to the one id that represents that real shift. */
  const canonicalStopId = useCallback(
    (id: string | null | undefined) => (id ? stopIdentity.canonicalById.get(id) || id : id),
    [stopIdentity]
  );


  // Helper: find which confirmed request an employee belongs to for a given project/date
  const findConfirmedRequest = useCallback((empId: string, projectId: string, dateStr: string) => {
    return scheduleRequests.find(r =>
      r.project_id === projectId &&
      r.scheduled_date === dateStr &&
      r.status === 'confirmed' &&
      r.employee_ids?.includes(empId)
    );
  }, [scheduleRequests]);

  // Helper: check if employee is confirmed anywhere on a given date
  const findConfirmedLocation = useCallback((empId: string, dateStr: string) => {
    for (const sr of scheduleRequests) {
      if (sr.scheduled_date === dateStr && sr.status === 'confirmed' && sr.employee_ids?.includes(empId)) {
        return { projectId: sr.project_id, requestId: sr.id };
      }
    }
    return null;
  }, [scheduleRequests]);

  // Effective employee lookup: in GC/MOA mode use allEmployees (to include sub employees);
  // in sub mode the existing GC-owned `employees` is the right set.
  const isGcMode = viewMode === 'gc' || viewMode === 'moa';
  const restrictedPersonnelView = !canActOnRequests && viewMode === 'sub';
  // Always resolve against the union so pending/confirmed people whose company
  // isn't in the primary list still render as chips (e.g. a sub viewing their
  // own personnel while `employees` holds a different scope).
  // Sub-side views are strictly company-scoped. GC / Guest GC views use the
  // complete employee union so connected subcontractor personnel remain visible.
  const employeeLookup = useMemo(() => {
    const byId = new Map<string, MatrixEmployee>();
    for (const e of employees) byId.set(e.id, e);
    for (const e of allEmployees) if (!byId.has(e.id)) byId.set(e.id, e);
    const list = Array.from(byId.values());
    const companyScoped = isGcMode ? list : list.filter(e => e.company_id === companyId);
    // Fail closed if a restricted personnel identity cannot be resolved.
    if (restrictedPersonnelView && !viewerEmployeeId) return [];
    return companyScoped;
  }, [employees, allEmployees, isGcMode, companyId, restrictedPersonnelView, viewerEmployeeId]);

  const restrictedScheduleScope = useMemo(() => {
    if (!restrictedPersonnelView) return null;
    const projects = new Set<string>();
    const dates = new Set<string>();
    if (!viewerEmployeeId) return { projects, dates };
    for (const request of scheduleRequests) {
      if (!request.employee_ids?.includes(viewerEmployeeId)) continue;
      // A restricted personnel view is the published schedule only; pending,
      // cancelled, and draft requests are not assignments for visibility.
      if (request.status !== 'confirmed') continue;
      projects.add(request.project_id);
      dates.add(request.scheduled_date);
    }
    return { projects, dates };
  }, [restrictedPersonnelView, viewerEmployeeId, scheduleRequests]);


  // Build effective matrix: confirmed data + draft modifications
  const matrixData = useMemo(() => {
    const map = new Map<string, Map<string, MatrixEmployee[]>>();

    // Step 1: Load confirmed AND cancelled schedule_requests
    // In GC/MOA mode also include pending requests so the GC can see who they've requested.
    scheduleRequests.forEach(sr => {
      const allowedStatuses = isGcMode
        ? ['confirmed', 'cancelled', 'pending']
        : ['confirmed', 'cancelled', 'pending'];
      if (!allowedStatuses.includes(sr.status || '')) return;
      // Restricted personnel see only published assignments from requests that
      // include them. Pending/cancelled/draft rows are never visible here.
      if (restrictedPersonnelView) {
        if (sr.status !== 'confirmed' || !viewerEmployeeId || !sr.employee_ids?.includes(viewerEmployeeId)) return;
      }
      // Sub mode: only surface pending rows that target this company's own personnel.
      if (!isGcMode && sr.status === 'pending' && sr.sub_company_id !== companyId) return;
      if (!sr.employee_ids?.length) return;
      if (!visibleDateStrings.includes(sr.scheduled_date)) return;
      if (restrictedScheduleScope && (!restrictedScheduleScope.projects.has(sr.project_id) || !restrictedScheduleScope.dates.has(sr.scheduled_date))) return;
      // Skip cancellations that the CURRENT viewer initiated — don't surface
      // them as red "needs acknowledgement" items on their own weekly view.
      if (sr.status === 'cancelled' && sr.cancelled_by_company_id === companyId) return;

      if (!map.has(sr.project_id)) map.set(sr.project_id, new Map());
      const dateMap = map.get(sr.project_id)!;
      if (!dateMap.has(sr.scheduled_date)) dateMap.set(sr.scheduled_date, []);

      const cellEmps = dateMap.get(sr.scheduled_date)!;
      sr.employee_ids.forEach(empId => {
        if (cellEmps.some(e => e.id === empId)) return;
        const emp = employeeLookup.find(e => e.id === empId);
        // Restricted personnel see only themselves and coworkers on one of
        // their own scheduled requests; all other users remain hidden.
        if (emp && (!restrictedPersonnelView || sr.employee_ids.includes(viewerEmployeeId || ''))) cellEmps.push(emp);
      });
    });

    // Step 2: Apply draft removals — remove from source cells. Restricted
    // personnel views never consume editor drafts or other transient state.
    if (restrictedPersonnelView) return map;

    // Stop-aware source removal: when only some of a person's stops were dragged
    // away, they stay in the source cell with their remaining stops. They only
    // leave the cell when the draft has no stop (whole person) or every stop moved.
    const rowDate = (ts: string) => {
      const d = new Date(ts);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const stopKeyOf = (a: AvailabilityRecord) =>
      a.stop_number != null ? `stop::${a.stop_number}` : `range::${a.start_time}::${a.end_time}`;
    const stopKeyById = new Map<string, string>();
    availabilities.forEach(a => stopKeyById.set(a.id, stopKeyOf(a)));

    const sourceStopKeys = (empId: string, projectId: string, dateStr: string): Set<string> => {
      const req = scheduleRequests.find(r =>
        r.project_id === projectId &&
        r.scheduled_date === dateStr &&
        ['confirmed', 'pending'].includes(r.status || '') &&
        r.employee_ids?.includes(empId)
      );
      const saved = req?.employee_stops?.[empId];
      if (saved && saved.length > 0) {
        return new Set(saved.map(id => stopKeyById.get(id) || id));
      }
      const rows = availabilities.filter(a =>
        a.employee_id === empId &&
        rowDate(a.start_time) === dateStr &&
        (a.all_projects || a.project_id === projectId || a.project_id === null)
      );
      return new Set(rows.map(stopKeyOf));
    };

    draftChanges.forEach(dc => {
      if (!dc.fromProjectId || !dc.fromDate) return;
      const fromDateMap = map.get(dc.fromProjectId);
      if (!fromDateMap) return;
      const fromCell = fromDateMap.get(dc.fromDate);
      if (!fromCell) return;
      const idx = fromCell.findIndex(e => e.id === dc.employeeId);
      if (idx === -1) return;

      if (!dc.stopId) {
        fromCell.splice(idx, 1);
        return;
      }

      const allKeys = sourceStopKeys(dc.employeeId, dc.fromProjectId, dc.fromDate);
      const goneKeys = new Set<string>();
      draftChanges.forEach(other => {
        if (other.employeeId !== dc.employeeId) return;
        if (other.fromProjectId !== dc.fromProjectId || other.fromDate !== dc.fromDate) return;
        if (!other.stopId) return;
        const k = stopKeyById.get(other.stopId);
        if (k) goneKeys.add(k);
      });
      const remaining = Array.from(allKeys).filter(k => !goneKeys.has(k));
      if (remaining.length === 0) fromCell.splice(idx, 1);
    });

    // Step 3: Apply draft placements — add to target cells
    draftChanges.forEach(dc => {
      if (dc.mode === 'remove') return; // removal-only drafts don't place anywhere
      if (!dc.toProjectId || !dc.toDate) return;

      if (!map.has(dc.toProjectId)) map.set(dc.toProjectId, new Map());
      const toDateMap = map.get(dc.toProjectId)!;
      if (!toDateMap.has(dc.toDate)) toDateMap.set(dc.toDate, []);
      const toCell = toDateMap.get(dc.toDate)!;
      const emp = employeeLookup.find(e => e.id === dc.employeeId);
      if (emp && !toCell.some(e => e.id === emp.id)) {
        toCell.push(emp);
      }
    });

    return map;
  }, [scheduleRequests, employeeLookup, visibleDateStrings, draftChanges, isGcMode, companyId, availabilities, restrictedPersonnelView, viewerEmployeeId, restrictedScheduleScope]);

  // Compute which employees are effectively scheduled (for sidebar)
  const effectiveScheduledIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [, dateMap] of matrixData) {
      for (const [dateStr, emps] of dateMap) {
        if (!visibleDateStrings.includes(dateStr)) continue;
        emps.forEach(e => ids.add(e.id));
      }
    }
    return ids;
  }, [matrixData, visibleDateStrings]);

  // Build scheduled entries list for sidebar day-filtering
  const scheduledEntries = useMemo(() => {
    const entries: { employeeId: string; projectId: string; date: string }[] = [];
    for (const [projectId, dateMap] of matrixData) {
      for (const [dateStr, emps] of dateMap) {
        emps.forEach(e => entries.push({ employeeId: e.id, projectId, date: dateStr }));
      }
    }
    return entries;
  }, [matrixData]);

  // Per-stop scheduled set: keys are `${employeeId}::${availabilityId}::${dateStr}`.
  // Used by the sidebar to filter out specific stops that are already drafted/confirmed,
  // while leaving the employee's other stops still draggable. A draft WITHOUT a stopId
  // (e.g. legacy "Assign to Project" button) hides every stop for that emp on that date.
  const scheduledStopKeys = useMemo(() => {
    const keys = new Set<string>();
    const empDateAllStops = new Set<string>(); // `${empId}::${dateStr}` — hide all stops

    // The same stop can exist as several availability rows (one per project it was
    // saved against). Blocking one row must block its twins, otherwise the stop keeps
    // showing as available under a different project's row.
    const siblings = new Map<string, string[]>();
    {
      const groups = new Map<string, string[]>();
      availabilities.forEach(a => {
        const d = new Date(a.start_time);
        const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const key = `${a.employee_id}::${ds}::${a.stop_number != null ? `stop::${a.stop_number}` : `range::${a.start_time}::${a.end_time}`}`;
        const list = groups.get(key) || [];
        list.push(a.id);
        groups.set(key, list);
      });
      groups.forEach(list => list.forEach(id => siblings.set(id, list)));
    }
    const idsFor = (stopId: string) => siblings.get(stopId) || [stopId];


    // Confirmed/pending requests: when the row records specific stops for an employee,
    // only those stops are blocked; otherwise the whole day is blocked (legacy rows).
    scheduleRequests.forEach(sr => {
      if (!sr.employee_ids?.length) return;
      const allowed = isGcMode
        ? ['confirmed', 'pending']
        : ['confirmed'];
      if (!allowed.includes(sr.status || '')) return;
      const stopMap = sr.employee_stops || {};
      sr.employee_ids.forEach(empId => {
        const stops = stopMap[empId];
        if (stops && stops.length > 0) {
          stops.forEach(stopId => idsFor(stopId).forEach(id => keys.add(`${empId}::${id}::${sr.scheduled_date}`)));
        } else {
          empDateAllStops.add(`${empId}::${sr.scheduled_date}`);
        }
      });
    });

    // Drafts: per-stop when stopId is set, else block all.
    draftChanges.forEach(dc => {
      if (dc.mode !== 'move' || !dc.toDate) return;
      // A removal draft from the same date should "free up" the stop again — handled below.
      if (dc.stopId) {
        idsFor(dc.stopId).forEach(id => keys.add(`${dc.employeeId}::${id}::${dc.toDate}`));
      } else {
        empDateAllStops.add(`${dc.employeeId}::${dc.toDate}`);
      }
    });

    // Removal drafts: free up the source stop so it reappears in the sidebar.
    // (Only meaningful for stop-scoped removals; non-stop removals can't selectively free.)
    draftChanges.forEach(dc => {
      if (dc.mode !== 'remove' || !dc.fromDate) return;
      if (dc.stopId) {
        idsFor(dc.stopId).forEach(id => keys.delete(`${dc.employeeId}::${id}::${dc.fromDate}`));
      }
    });

    return { perStop: keys, allStopsByEmpDate: empDateAllStops };
  }, [scheduleRequests, draftChanges, isGcMode, availabilities]);

  // Map: `${employeeId}::${date}` -> name of OTHER project of the SAME GC where this employee is scheduled.
  // Used to show a red-outlined warning chip on the sidebar/cell when a sub employee is double-booked
  // within the same GC's portfolio (e.g., "John Doe (Bridge Capital)" appearing on Acme HQ schedule).
  const sameGcOtherProjectMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isGcMode) return map;
    const visibleProjectIds = new Set(projects.map(p => p.id));
    const allOwnedProjects = allCompanyProjects ?? projects;
    const projectNameById = new Map(allOwnedProjects.map(p => [p.id, p.name]));
    scheduleRequests.forEach(sr => {
      if (sr.status !== 'confirmed') return;
      if (sr.requesting_company_id !== companyId) return;
      if (!sr.employee_ids?.length) return;
      sr.employee_ids.forEach(empId => {
        // Only flag if booked on a project NOT currently visible in this matrix view.
        if (visibleProjectIds.has(sr.project_id)) return;
        const key = `${empId}::${sr.scheduled_date}`;
        if (!map.has(key)) {
          map.set(key, projectNameById.get(sr.project_id) || 'Other project');
        }
      });
    });
    return map;
  }, [scheduleRequests, projects, allCompanyProjects, companyId, isGcMode]);

  // Default selectedDate to first visible day
  const effectiveSelectedDate = selectedDate ?? visibleDateStrings[0] ?? null;

  // Resolve card status for a given employee in a project/date cell
  const getCardStatus = useCallback((empId: string, projectId: string, dateStr: string): CardStatus => {
    // Check if this is a draft placement
    const moveDraft = draftChanges.find(dc =>
      dc.mode === 'move' &&
      dc.employeeId === empId &&
      dc.toProjectId === projectId &&
      dc.toDate === dateStr
    );
    if (moveDraft) return 'draft';

    // Check cancelled — but ignore cancellations that the CURRENT viewer initiated.
    const cancelledReq = scheduleRequests.find(r =>
      r.project_id === projectId &&
      r.scheduled_date === dateStr &&
      r.status === 'cancelled' &&
      r.cancelled_by_company_id !== companyId &&
      r.employee_ids?.includes(empId)
    );
    if (cancelledReq) return 'cancelled';

    // Check confirmed (and not removed by a draft)
    const confirmedReq = findConfirmedRequest(empId, projectId, dateStr);
    if (confirmedReq) {
      // Make sure there's no removal draft for this
      const removed = draftChanges.some(dc =>
        dc.employeeId === empId &&
        dc.fromProjectId === projectId &&
        dc.fromDate === dateStr
      );
      if (!removed) return 'confirmed';
    }

    // Check pending — GC mode shows these in yellow as "Pending Confirmation".
    // Sub mode also shows pending rows that target this company's own personnel,
    // so published-but-unconfirmed people never disappear from the grid.
    {
      const pendingReq = scheduleRequests.find(r =>
        r.project_id === projectId &&
        r.scheduled_date === dateStr &&
        r.status === 'pending' &&
        (isGcMode || r.sub_company_id === companyId) &&
        r.employee_ids?.includes(empId)
      );
      if (pendingReq) {
        const removed = draftChanges.some(dc =>
          dc.employeeId === empId &&
          dc.fromProjectId === projectId &&
          dc.fromDate === dateStr
        );
        if (!removed) return 'pending';
      }
    }

    return 'available';
  }, [draftChanges, scheduleRequests, findConfirmedRequest, isGcMode, companyId]);

  // Format a UTC timestamp string into a display time like "7:00 AM"
  const formatTimeLabel = useCallback((ts: string): string => {
    const d = new Date(ts);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }, []);

  // Helper: extract date string (YYYY-MM-DD) from UTC timestamp
  const dateFromTs = useCallback((ts: string): string => {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }, []);

  // Group an employee's availability rows for a date into one entry per real stop.
  // Availability is stored once per project a stop was saved against, so the same stop
  // can appear as several rows — they are collapsed here (keyed on stop number, falling
  // back to the exact start/end range). Each group keeps every underlying row id so that
  // a stop recorded on a request under one project still matches.
  const stopGroupsFor = useCallback((empId: string, dateStr: string) => {
    const rows = availabilities.filter(a =>
      a.employee_id === empId && dateFromTs(a.start_time) === dateStr
    );
    const map = new Map<string, { rep: AvailabilityRecord; rows: AvailabilityRecord[] }>();
    for (const a of rows) {
      const key = a.stop_number != null
        ? `stop::${a.stop_number}`
        : `range::${a.start_time}::${a.end_time}`;
      const g = map.get(key);
      if (!g) map.set(key, { rep: a, rows: [a] });
      else {
        g.rows.push(a);
        if (a.id < g.rep.id) g.rep = a;
      }
    }
    return Array.from(map.values()).sort((x, y) => x.rep.start_time.localeCompare(y.rep.start_time));
  }, [availabilities, dateFromTs]);

  const groupAppliesToProject = (g: { rows: AvailabilityRecord[] }, projectId: string) =>
    g.rows.some(a => a.all_projects || a.project_id === projectId || a.project_id === null);

  // For a given employee + project + date, return the relevant availability blocks (one per stop).
  // If there are draft "move" placements for this (emp, project, date) carrying explicit stopIds,
  // ONLY return those specific stops — so dragging one stop in doesn't visually grab the others.
  // Stops that were dragged AWAY from this cell are excluded so the person keeps only what stays.
  // Returns [] if none — caller should fall back to single-chip rendering.
  const getEmployeeStopsForCell = useCallback((empId: string, projectId: string, dateStr: string): AvailabilityRecord[] => {
    const groups = stopGroupsFor(empId, dateStr);

    // Collect explicit stopIds from "move" drafts targeting this cell for this employee.
    const draftStopIds = new Set<string>();
    let hasDraftWithoutStop = false;
    let hasAnyDraftHere = false;
    // Stops dragged away from THIS cell (moved elsewhere or removed).
    const movedAwayStopIds = new Set<string>();
    draftChanges.forEach(dc => {
      if (dc.employeeId !== empId) return;
      if (dc.mode === 'move' && dc.toProjectId === projectId && dc.toDate === dateStr) {
        hasAnyDraftHere = true;
        if (dc.stopId) draftStopIds.add(dc.stopId);
        else hasDraftWithoutStop = true;
        return;
      }
      if (dc.fromProjectId === projectId && dc.fromDate === dateStr && dc.stopId) {
        movedAwayStopIds.add(dc.stopId);
      }
    });

    const notMovedAway = (g: { rows: AvailabilityRecord[] }) =>
      !g.rows.some(r => movedAwayStopIds.has(r.id));

    // If a draft pins specific stops here AND no draft is "all stops", restrict to those —
    // regardless of which project the availability row was originally saved against.
    if (hasAnyDraftHere && draftStopIds.size > 0 && !hasDraftWithoutStop) {
      return groups
        .filter(g => g.rows.some(r => draftStopIds.has(r.id)))
        .map(g => g.rep);
    }

    // No drafts pinning stops here: honour the saved per-stop selection on the request.
    if (!hasAnyDraftHere) {
      const req = scheduleRequests.find(r =>
        r.project_id === projectId &&
        r.scheduled_date === dateStr &&
        ['confirmed', 'pending'].includes(r.status || '') &&
        r.employee_ids?.includes(empId)
      );
      const saved = req?.employee_stops?.[empId];
      if (saved && saved.length > 0) {
        const savedSet = new Set(saved);
        const filtered = groups
          .filter(g => g.rows.some(r => savedSet.has(r.id)))
          .filter(notMovedAway)
          .map(g => g.rep);
        if (filtered.length > 0) return filtered;
      }
    }

    return groups
      .filter(g => groupAppliesToProject(g, projectId))
      .filter(notMovedAway)
      .map(g => g.rep);
  }, [stopGroupsFor, draftChanges, scheduleRequests]);

  /** Every availability block (stop) an employee has on a project/date, ignoring drafts. */
  const allStopBlockIds = useCallback((empId: string, projectId: string, dateStr: string): string[] => {
    return stopGroupsFor(empId, dateStr)
      .filter(g => groupAppliesToProject(g, projectId))
      .map(g => g.rep.id);
  }, [stopGroupsFor]);

  /** Canonicalise + de-duplicate a saved list of stop ids. */
  const canonicalStopList = useCallback((ids: string[] | null | undefined): string[] => {
    if (!ids) return [];
    const out: string[] = [];
    ids.forEach(id => {
      const c = canonicalStopId(id) as string;
      if (c && !out.includes(c)) out.push(c);
    });
    return out;
  }, [canonicalStopId]);

  /** Canonicalise every employee's saved stop list on a request. */
  const canonicalStopMap = useCallback((map: Record<string, string[]> | null | undefined): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    Object.entries(map || {}).forEach(([empId, ids]) => {
      out[empId] = canonicalStopList(ids);
    });
    return out;
  }, [canonicalStopList]);

  /** Current stop selection for an employee on a request; falls back to all their stops. */
  const currentStopIds = useCallback((req: ScheduleRequest | undefined, empId: string, projectId: string, dateStr: string): string[] => {
    const saved = req?.employee_stops?.[empId];
    if (saved && saved.length > 0) return canonicalStopList(saved);
    return allStopBlockIds(empId, projectId, dateStr).map(id => canonicalStopId(id) as string);
  }, [allStopBlockIds, canonicalStopList, canonicalStopId]);

  // Add a removal draft (red X, drag to sidebar, drag off calendar)
  const addRemovalDraft = useCallback((empId: string, sourceProjectId: string, sourceDateStr: string) => {
    setDraftChanges(prev => {
      // Check if this is already a draft placement we can just delete
      const existingMoveDraft = prev.find(dc =>
        dc.mode === 'move' &&
        dc.employeeId === empId &&
        dc.toProjectId === sourceProjectId &&
        dc.toDate === sourceDateStr
      );

      if (existingMoveDraft) {
        // This employee was draft-placed here. Remove the draft.
        // If they had an original confirmed location, add a removal draft for that too? No —
        // removing the move draft means they go back to their original confirmed spot automatically.
        return prev.filter(dc => dc !== existingMoveDraft);
      }

      // This is a confirmed or pending employee — add a removal draft
      const confirmedSr = findConfirmedRequest(empId, sourceProjectId, sourceDateStr);
      const pendingSr = !confirmedSr ? scheduleRequests.find(r =>
        r.project_id === sourceProjectId &&
        r.scheduled_date === sourceDateStr &&
        r.status === 'pending' &&
        r.employee_ids?.includes(empId)
      ) : undefined;
      const sr = confirmedSr || pendingSr;
      // Don't add duplicate removal drafts
      const alreadyRemoved = prev.some(dc =>
        dc.mode === 'remove' &&
        dc.employeeId === empId &&
        dc.fromProjectId === sourceProjectId &&
        dc.fromDate === sourceDateStr
      );
      if (alreadyRemoved) return prev;

      return [...prev, {
        employeeId: empId,
        fromProjectId: sourceProjectId,
        fromDate: sourceDateStr,
        toProjectId: null,
        toDate: null,
        mode: 'remove' as const,
        originalRequestId: sr?.id,
      }];
    });
  }, [findConfirmedRequest, scheduleRequests]);

  const handleDragStart = (event: DragStartEvent) => {
    const emp = event.active.data.current?.employee as MatrixEmployee | undefined;
    setActiveEmployee(emp || null);
    const activeId = String(event.active.id);
    // If the dragged chip is part of multi-selection, count includes all selected.
    const count = selectedChipIds.has(activeId) ? selectedChipIds.size : 1;
    setActiveDragCount(count);

    // Resolve the active chip's stop info so the DragOverlay can show time/stop labels.
    const parts = activeId.split('::');
    let stopId: string | null = null;
    if (parts[0] === 'matrix' && parts.length === 5) stopId = parts[4];
    else if (parts[0] === 'sidebar' && parts.length >= 3) stopId = parts[2];
    if (stopId) {
      const avail = availabilities.find(a => a.id === stopId);
      if (avail) {
        setActiveDragTimeLabel(`${formatTimeLabel(avail.start_time)} – ${formatTimeLabel(avail.end_time)}`);
        setActiveDragStopLabel(avail.stop_number ? `Stop ${avail.stop_number}` : undefined);
        return;
      }
    }
    setActiveDragTimeLabel(undefined);
    setActiveDragStopLabel(undefined);
  };

  // Resolve a single chip's source location (projectId, dateStr, stopId) from its dragId.
  // Supports two formats:
  //   matrix::<projectId>::<dateStr>::<empId>[::<stopId>]
  //   sidebar::<empId>[::<availId>]   — availId becomes the stopId so per-stop drafts are tracked.
  // The stop id is always canonicalised, so a chip labelled with one duplicate row and a
  // draft recorded against another still refer to the same shift.
  const parseChipDragId = (dragId: string): { sourceProjectId: string | null; sourceDateStr: string | null; sourceStopId: string | null } => {
    const parts = dragId.split('::');
    if (parts[0] === 'matrix') {
      if (parts.length === 4) {
        return { sourceProjectId: parts[1], sourceDateStr: parts[2], sourceStopId: null };
      }
      if (parts.length === 5) {
        return { sourceProjectId: parts[1], sourceDateStr: parts[2], sourceStopId: canonicalStopId(parts[4]) ?? null };
      }
    }
    if (parts[0] === 'sidebar' && parts.length >= 3) {
      // Sidebar chips have no source project/date but carry the availability id as stopId.
      return { sourceProjectId: null, sourceDateStr: null, sourceStopId: canonicalStopId(parts[2]) ?? null };
    }
    return { sourceProjectId: null, sourceDateStr: null, sourceStopId: null };
  };

  // Apply a single chip drop. Mutates `pendingDrafts` in place to compute the new draft set
  // for one chip in a (possibly multi-) drop. Pass the working drafts array so that successive
  // chips in a multi-drop see prior drafts in this batch.
  const applyChipDrop = (
    workingDrafts: DraftChange[],
    chipDragId: string,
    emp: MatrixEmployee,
    targetProjectId: string | null,
    targetDateStr: string | null,
  ): DraftChange[] => {
    const { sourceProjectId, sourceDateStr, sourceStopId } = parseChipDragId(chipDragId);

    // --- Drop on sidebar / off calendar: REMOVE this stop only ---
    if (!targetProjectId || !targetDateStr) {
      if (!sourceProjectId || !sourceDateStr) return workingDrafts;
      // Mirror addRemovalDraft logic but per-stop.
      const existingMoveDraft = workingDrafts.find(dc =>
        dc.mode === 'move' &&
        dc.employeeId === emp.id &&
        dc.stopId === (sourceStopId ?? undefined) &&
        dc.toProjectId === sourceProjectId &&
        dc.toDate === sourceDateStr
      );
      if (existingMoveDraft) {
        return workingDrafts.filter(dc => dc !== existingMoveDraft);
      }
      const confirmedSr = findConfirmedRequest(emp.id, sourceProjectId, sourceDateStr);
      const pendingSr = !confirmedSr ? scheduleRequests.find(r =>
        r.project_id === sourceProjectId &&
        r.scheduled_date === sourceDateStr &&
        r.status === 'pending' &&
        r.employee_ids?.includes(emp.id)
      ) : undefined;
      const sr = confirmedSr || pendingSr;
      const alreadyRemoved = workingDrafts.some(dc =>
        dc.mode === 'remove' &&
        dc.employeeId === emp.id &&
        dc.stopId === (sourceStopId ?? undefined) &&
        dc.fromProjectId === sourceProjectId &&
        dc.fromDate === sourceDateStr
      );
      if (alreadyRemoved) return workingDrafts;
      return [...workingDrafts, {
        employeeId: emp.id,
        fromProjectId: sourceProjectId,
        fromDate: sourceDateStr,
        toProjectId: null,
        toDate: null,
        mode: 'remove' as const,
        originalRequestId: sr?.id,
        stopId: sourceStopId ?? undefined,
      }];
    }

    // --- Drop on a cell ---
    let originalFromProjectId: string | null = null;
    let originalFromDate: string | null = null;
    let originalRequestId: string | undefined;

    if (sourceProjectId && sourceDateStr) {
      // Check if dragging from a draft-placed position (per-stop)
      const existingDraft = workingDrafts.find(dc =>
        dc.mode === 'move' &&
        dc.employeeId === emp.id &&
        dc.stopId === (sourceStopId ?? undefined) &&
        dc.toProjectId === sourceProjectId &&
        dc.toDate === sourceDateStr
      );
      if (existingDraft) {
        originalFromProjectId = existingDraft.fromProjectId;
        originalFromDate = existingDraft.fromDate;
        originalRequestId = existingDraft.originalRequestId;
      } else {
        originalFromProjectId = sourceProjectId;
        originalFromDate = sourceDateStr;
        const sr = findConfirmedRequest(emp.id, sourceProjectId, sourceDateStr)
          || scheduleRequests.find(r =>
            r.project_id === sourceProjectId &&
            r.scheduled_date === sourceDateStr &&
            r.status === 'pending' &&
            r.employee_ids?.includes(emp.id)
          );
        originalRequestId = sr?.id;
      }
    } else {
      // From sidebar — cancel a removal draft on the target if any
      const existingRemoval = workingDrafts.find(dc =>
        dc.mode === 'remove' &&
        dc.employeeId === emp.id &&
        dc.fromProjectId === targetProjectId &&
        dc.fromDate === targetDateStr
      );
      if (existingRemoval) {
        return workingDrafts.filter(dc => dc !== existingRemoval);
      }
      const confirmedLoc = findConfirmedLocation(emp.id, targetDateStr);
      if (confirmedLoc && confirmedLoc.projectId !== targetProjectId) {
        originalFromProjectId = confirmedLoc.projectId;
        originalFromDate = targetDateStr;
        const sr = findConfirmedRequest(emp.id, confirmedLoc.projectId, targetDateStr);
        originalRequestId = sr?.id;
      }
    }

    // If dropping back to original location for THIS stop, cancel its drafts
    if (originalFromProjectId === targetProjectId && originalFromDate === targetDateStr) {
      return workingDrafts.filter(dc => !(
        dc.employeeId === emp.id &&
        dc.stopId === (sourceStopId ?? undefined) &&
        ((dc.mode === 'move' && dc.fromProjectId === originalFromProjectId && dc.fromDate === originalFromDate) ||
         (dc.mode === 'remove' && dc.fromProjectId === targetProjectId && dc.fromDate === targetDateStr))
      ));
    }

    // Remove conflicting drafts for THIS (employee, stop) pair only
    let updated = workingDrafts.filter(dc => {
      if (dc.employeeId !== emp.id) return true;
      if (dc.stopId !== (sourceStopId ?? undefined)) return true;
      // Same employee + stop:
      if (dc.mode === 'move' && dc.toProjectId === sourceProjectId && dc.toDate === sourceDateStr) return false;
      if (dc.mode === 'remove' && dc.fromProjectId === targetProjectId && dc.fromDate === targetDateStr) return false;
      if (dc.mode === 'move' && dc.toDate === targetDateStr) return false;
      return true;
    });

    updated.push({
      employeeId: emp.id,
      fromProjectId: originalFromProjectId,
      fromDate: originalFromDate,
      toProjectId: targetProjectId,
      toDate: targetDateStr,
      mode: 'move',
      originalRequestId,
      stopId: sourceStopId ?? undefined,
    });

    return updated;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canActOnRequests) return;
    setActiveEmployee(null);
    setActiveDragCount(1);
    setActiveDragTimeLabel(undefined);
    setActiveDragStopLabel(undefined);
    const { active, over } = event;
    const emp = active.data.current?.employee as MatrixEmployee | undefined;
    if (!emp) return;

    const activeId = String(active.id);
    const overId = over ? String(over.id) : null;

    // Resolve target
    let targetProjectId: string | null = null;
    let targetDateStr: string | null = null;
    if (overId && overId.startsWith('cell::')) {
      const overParts = overId.split('::');
      if (overParts.length === 3) {
        targetProjectId = overParts[1];
        targetDateStr = overParts[2];
      }
    } else if (overId === 'sidebar-drop' || !overId) {
      // remove
      targetProjectId = null;
      targetDateStr = null;
    } else {
      return;
    }

    // Determine the chip set: if active chip is in selection, drag the whole group; else just one.
    const chipsToProcess: Array<{ dragId: string; emp: MatrixEmployee }> = [];
    const empPool = allEmployees.length > 0 ? allEmployees : employees;
    if (selectedChipIds.has(activeId) && selectedChipIds.size > 1) {
      selectedChipIds.forEach(dragId => {
        const empId = empIdFromDragId(dragId);
        if (!empId) return;
        const found = empPool.find(e => e.id === empId);
        if (found) chipsToProcess.push({ dragId, emp: found });
      });
    } else {
      chipsToProcess.push({ dragId: activeId, emp });
    }

    // Apply each chip drop sequentially to the working drafts array.
    setDraftChanges(prev => {
      let working = [...prev];
      for (const chip of chipsToProcess) {
        working = applyChipDrop(working, chip.dragId, chip.emp, targetProjectId, targetDateStr);
      }
      return working;
    });

    // Clear selection after a successful drop
    setSelectedChipIds(new Set());
  };

  /** Mobile tap-to-place: apply the currently selected chips to a target cell
   *  (or remove them when target is null). Mirrors the desktop drag-drop path. */
  const applySelectedChipsToTarget = (targetProjectId: string | null, targetDateStr: string | null) => {
    if (!canActOnRequests) return;
    const empPool = allEmployees.length > 0 ? allEmployees : employees;
    const chips: Array<{ dragId: string; emp: MatrixEmployee }> = [];
    selectedChipIds.forEach(dragId => {
      const empId = empIdFromDragId(dragId);
      if (!empId) return;
      const found = empPool.find(e => e.id === empId);
      if (found) chips.push({ dragId, emp: found });
    });
    if (chips.length === 0) return;
    setDraftChanges(prev => {
      let working = [...prev];
      for (const chip of chips) {
        working = applyChipDrop(working, chip.dragId, chip.emp, targetProjectId, targetDateStr);
      }
      return working;
    });
    setSelectedChipIds(new Set());
  };



  // Handle "Assign to Project" button click
  const handleAssign = (empId: string, projectId: string, dateStr: string) => {
    if (!canActOnRequests) return;
    // Find current confirmed location for this date if any
    const confirmedLoc = findConfirmedLocation(empId, dateStr);
    let fromProjectId: string | null = confirmedLoc?.projectId || null;
    let fromDate: string | null = confirmedLoc ? dateStr : null;
    let originalRequestId = confirmedLoc?.requestId;

    if (fromProjectId === projectId) return; // Already confirmed there

    setDraftChanges(prev => {
      // Remove any existing drafts for this employee on this date
      let updated = prev.filter(dc => !(dc.employeeId === empId && dc.toDate === dateStr));
      updated = updated.filter(dc => !(dc.mode === 'remove' && dc.employeeId === empId && dc.fromDate === dateStr));

      updated.push({
        employeeId: empId,
        fromProjectId,
        fromDate,
        toProjectId: projectId,
        toDate: dateStr,
        mode: 'move',
        originalRequestId,
      });
      return updated;
    });
  };

  // Handle clicking a cancelled card — accept the cancellation.
  // Mirrors monthly's `handleAcknowledgeRejection`: delete the SR record entirely so
  // that both monthly and weekly views clear the badge via realtime + shared state.
  const handleCancelClick = async (empId: string, projectId: string, dateStr: string) => {
    if (!canActOnRequests) return;
    const sr = scheduleRequests.find(r =>
      r.project_id === projectId &&
      r.scheduled_date === dateStr &&
      r.status === 'cancelled' &&
      r.employee_ids?.includes(empId)
    );
    if (!sr) return;

    const { error } = await supabase.from('schedule_requests').delete().eq('id', sr.id);
    if (error) {
      toast({ title: 'Error', description: 'Could not accept the cancellation.', variant: 'destructive' });
      return;
    }

    toast({ title: 'Cancellation accepted', description: 'The request has been cleared.' });
    onDataChanged?.();
  };

  const handleRevert = () => { if (!canActOnRequests) return; setDraftChanges([]); setCopiedSchedule(null); };

  // Copy schedule from selected date
  const handleCopySchedule = (date: string) => {
    if (!canActOnRequests) return;
    const assignments: { projectId: string; employeeIds: string[] }[] = [];
    for (const [projectId, dateMap] of matrixData) {
      const emps = dateMap.get(date);
      if (emps && emps.length > 0) {
        assignments.push({ projectId, employeeIds: emps.map(e => e.id) });
      }
    }
    if (assignments.length === 0) {
      toast({ title: 'Nothing to copy', description: 'No assignments found for this date.' });
      return;
    }
    setCopiedSchedule({ sourceDate: date, assignments });
    toast({ title: 'Schedule copied', description: `Copied schedule from ${format(parseISO(date), 'EEE, MMM d')}. Click a day header to paste.` });
  };

  // Paste copied schedule to target date
  const executePaste = (targetDate: string) => {
    if (!canActOnRequests) return;
    if (!copiedSchedule) return;
    setDraftChanges(prev => {
      let updated = [...prev];
      for (const assignment of copiedSchedule.assignments) {
        for (const empId of assignment.employeeIds) {
          // Skip if already has a draft for this emp on target date
          if (updated.some(dc => dc.employeeId === empId && dc.toDate === targetDate)) continue;
          // Check if confirmed at same location already
          const alreadyConfirmed = scheduleRequests.some(r =>
            r.project_id === assignment.projectId &&
            r.scheduled_date === targetDate &&
            r.status === 'confirmed' &&
            r.employee_ids?.includes(empId)
          );
          if (alreadyConfirmed) continue;
          updated.push({
            employeeId: empId,
            fromProjectId: null,
            fromDate: null,
            toProjectId: assignment.projectId,
            toDate: targetDate,
            mode: 'move',
          });
        }
      }
      return updated;
    });
    toast({ title: 'Schedule pasted', description: `Pasted to ${format(parseISO(targetDate), 'EEE, MMM d')}. Review and publish.` });
  };

  const handleDayHeaderClick = (dateStr: string) => {
    if (!canActOnRequests) return;
    if (copiedSchedule) {
      // Check if target date has existing assignments
      const hasExisting = projects.some(p => {
        const emps = matrixData.get(p.id)?.get(dateStr);
        return emps && emps.length > 0;
      });
      if (hasExisting) {
        setPasteTarget(dateStr);
        setShowPasteConfirm(true);
      } else {
        executePaste(dateStr);
      }
    } else {
      setSelectedDate(dateStr);
    }
  };

  // Helper: is this (employee, project) pair NOT in the assignment table?
  // Only meaningful in sub mode; in GC mode we don't gate on this.
  const isUnassignedPair = useCallback((empId: string, projectId: string): boolean => {
    if (isGcMode) return false;
    if (!employeeProjectAssignments) return false;
    const assigned = employeeProjectAssignments.get(empId);
    if (!assigned) return true;
    return !assigned.has(projectId);
  }, [isGcMode, employeeProjectAssignments]);

  const displayProjects = useMemo(() => {
    if (!restrictedScheduleScope) return projects;
    return projects.filter(project => restrictedScheduleScope.projects.has(project.id));
  }, [projects, restrictedScheduleScope]);

  // Compute draft pairs whose (employee, target project) is NOT in the assignment table.
  // Used to (a) render warning chip styling and (b) gate the publish flow.
  const unassignedDraftPairs = useMemo<UnassignedPair[]>(() => {
    if (isGcMode) return [];
    const pairs: UnassignedPair[] = [];
    const seen = new Set<string>();
    const empPool = allEmployees.length > 0 ? allEmployees : employees;
    const projectNameById = new Map(projects.map(p => [p.id, p.name]));
    for (const dc of draftChanges) {
      if (dc.mode !== 'move' || !dc.toProjectId) continue;
      if (!isUnassignedPair(dc.employeeId, dc.toProjectId)) continue;
      const key = `${dc.employeeId}::${dc.toProjectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const emp = empPool.find(e => e.id === dc.employeeId);
      pairs.push({
        employeeId: dc.employeeId,
        employeeName: emp?.name || 'Employee',
        jobTitle: emp?.job_title ?? null,
        projectId: dc.toProjectId,
        projectName: projectNameById.get(dc.toProjectId) || 'Project',
        date: dc.toDate ?? undefined,
      });
    }
    return pairs;
  }, [draftChanges, isGcMode, isUnassignedPair, allEmployees, employees, projects]);

  // GC mode wrapper: intercept publish to ask via NotifyOnAssignDialog first.
  // MatrixDraftBar (mode='gc') calls this with {email:false, sms:false}; we ignore that
  // and open the dialog. The dialog's onChoose then calls doPublish with the real choice.
  const handlePublish = (notify: { email: boolean; sms: boolean; notifyPersonnelEmail?: boolean; notifyPersonnelSms?: boolean; editReason?: string }) => {
    if (!canActOnRequests) return;
    if (isGcMode && !showNotifyDialog && draftChanges.length > 0) {
      setShowNotifyDialog(true);
      return;
    }
    // Sub mode: if any draft places an employee on a project they're not assigned to,
    // gate the publish behind the unassigned-exception flow.
    if (!isGcMode && draftChanges.length > 0 && unassignedDraftPairs.length > 0) {
      const canMakeException = permissionLevel === 'partial'
        || permissionLevel === 'full'
        || permissionLevel === 'account_holder'
        || permissionLevel === 'level_1';
      if (!canMakeException) {
        toast({
          title: 'Permission required',
          description: 'You do not have permission to assign employees to projects they are not assigned to. Ask an admin to update assignments in Manage Team Profiles.',
          variant: 'destructive',
        });
        return;
      }
      setPendingPublishNotify(notify);
      setShowUnassignedDialog(true);
      return;
    }
    void doPublish(notify);
  };

  const doPublish = async (notify: { email: boolean; sms: boolean; notifyPersonnelEmail?: boolean; notifyPersonnelSms?: boolean; editReason?: string }) => {
    const editReason = notify.editReason ?? null;
    if (draftChanges.length === 0) return;
    setIsPublishing(true);

    try {
      // === GC / MOA mode ===
      // Drafts represent requests/edits the GC is sending to subcontractor(s).
      // - Drafts WITH originalRequestId: edit the existing schedule_request (move date /
      //   modify employee_ids); status reverts to 'pending' so the sub can re-confirm.
      // - Drafts WITHOUT originalRequestId: create a new pending schedule_request.
      //   Group by (project, date, sub_company_id) into one row when possible.
      // No email/SMS — request shows up in-app via realtime.
      if (isGcMode) {
        // Process removals first (drafts with originalRequestId and mode === 'remove' or
        // moves where fromProjectId !== toProjectId). For each affected original request,
        // build the final desired employee_ids based on the current matrixData.
        const affectedRequestIds = new Set<string>();
        draftChanges.forEach(dc => {
          if (dc.originalRequestId) affectedRequestIds.add(dc.originalRequestId);
        });

        // 1) Update each affected original request: rebuild employee_ids by removing
        //    employees whose drafts move/remove them away from this request.
        for (const reqId of affectedRequestIds) {
          const existing = scheduleRequests.find(r => r.id === reqId);
          if (!existing) continue;
          const removedEmpIds = new Set<string>();
          const remainingStops: Record<string, string[]> = canonicalStopMap(existing.employee_stops);
          // Group drafts targeting this request by employee so we can decide whether
          // to fully remove them or keep them (if at least one stop stayed put).
          const draftsByEmp = new Map<string, DraftChange[]>();
          draftChanges.forEach(dc => {
            if (dc.originalRequestId !== reqId) return;
            if (!draftsByEmp.has(dc.employeeId)) draftsByEmp.set(dc.employeeId, []);
            draftsByEmp.get(dc.employeeId)!.push(dc);
          });
          for (const [empId, drafts] of draftsByEmp) {
            // Drafts that move/remove this emp AWAY from this request.
            const movedAway = drafts.filter(dc => {
              if (dc.mode === 'remove') return true;
              if (dc.mode === 'move') {
                return !(dc.toProjectId === existing.project_id && dc.toDate === existing.scheduled_date);
              }
              return false;
            });
            if (movedAway.length === 0) continue;
            // A draft without a stopId means the whole person moved.
            if (movedAway.some(d => !d.stopId)) {
              removedEmpIds.add(empId);
              delete remainingStops[empId];
              continue;
            }
            const movedStopIds = new Set(movedAway.map(d => d.stopId!));
            const before = currentStopIds(existing, empId, existing.project_id, existing.scheduled_date);
            const left = before.filter(id => !movedStopIds.has(id));
            if (left.length === 0) {
              removedEmpIds.add(empId);
              delete remainingStops[empId];
            } else {
              remainingStops[empId] = left;
            }
          }
          const newIds = (existing.employee_ids || []).filter(id => !removedEmpIds.has(id));
          if (newIds.length === 0) {
            // No personnel left → delete the request entirely
            await supabase.from('schedule_requests').delete().eq('id', reqId);
          } else {
            // Revert to pending so the sub re-confirms the edit
            await supabase
              .from('schedule_requests')
              .update({
                employee_ids: newIds,
                employee_stops: remainingStops,
                status: 'pending',
                edited: true,
                last_edited_by_company_id: companyId,
                edit_reason: editReason,
              } as any)
              .eq('id', reqId);
          }
        }

        // 2) Create / merge new requests for "move" drafts placing employees at a target.
        //    Group by (project_id, scheduled_date, sub_company_id).
        type GroupKey = string;
        const groups = new Map<GroupKey, { projectId: string; date: string; subCompanyId: string; empIds: string[]; stops: Record<string, string[] | null> }>();
        for (const dc of draftChanges) {
          if (dc.mode !== 'move' || !dc.toProjectId || !dc.toDate) continue;
          const emp = employeeLookup.find(e => e.id === dc.employeeId);
          if (!emp) continue;
          const key = `${dc.toProjectId}::${dc.toDate}::${emp.company_id}`;
          if (!groups.has(key)) {
            groups.set(key, {
              projectId: dc.toProjectId,
              date: dc.toDate,
              subCompanyId: emp.company_id,
              empIds: [],
              stops: {},
            });
          }
          const g = groups.get(key)!;
          if (!g.empIds.includes(dc.employeeId)) g.empIds.push(dc.employeeId);
          // null = "all stops" (a draft without a stop id wins over stop-scoped ones)
          if (!dc.stopId) {
            g.stops[dc.employeeId] = null;
          } else if (g.stops[dc.employeeId] !== null) {
            const list = g.stops[dc.employeeId] || [];
            if (!list.includes(dc.stopId)) g.stops[dc.employeeId] = [...list, dc.stopId];
            else g.stops[dc.employeeId] = list;
          }
        }

        for (const [, g] of groups) {
          // If there's already a pending/confirmed request for this group, MERGE into it
          // (append employee_ids and revert to pending).
          const existing = scheduleRequests.find(r =>
            r.project_id === g.projectId &&
            r.scheduled_date === g.date &&
            r.sub_company_id === g.subCompanyId &&
            ['pending', 'confirmed'].includes(r.status || '')
          );

          const mergedStops = (base: Record<string, string[]> | null | undefined) => {
            const out: Record<string, string[]> = canonicalStopMap(base);
            for (const empId of g.empIds) {
              const incoming = g.stops[empId];
              if (incoming === null || incoming === undefined) {
                delete out[empId]; // all stops
              } else {
                out[empId] = Array.from(new Set([...(out[empId] || []), ...incoming]));
              }
            }
            return out;
          };

          if (existing) {
            const merged = Array.from(new Set([...(existing.employee_ids || []), ...g.empIds]));
            await supabase
              .from('schedule_requests')
              .update({
                employee_ids: merged,
                employee_stops: mergedStops(existing.employee_stops),
                status: 'pending',
                edited: true,
                last_edited_by_company_id: companyId,
                edit_reason: editReason,
              } as any)
              .eq('id', existing.id);
          } else {
            const { error } = await supabase.from('schedule_requests').insert({
              project_id: g.projectId,
              sub_company_id: g.subCompanyId,
              requesting_company_id: companyId,
              ...(intermediaryByCompanyId[g.subCompanyId]
                ? { intermediary_company_id: intermediaryByCompanyId[g.subCompanyId] }
                : {}),
              scheduled_date: g.date,
              status: 'pending',
              employee_ids: g.empIds,
              employee_stops: mergedStops(null),
              sub_assigned: false,
              silent_assignment: false,
            } as any);
            if (error) {
              console.error('Error creating GC request:', error);
              toast({ title: 'Error', description: error.message, variant: 'destructive' });
              setIsPublishing(false);
              return;
            }
          }
        }

        // 3) GC notification fan-out — email keeps the existing behavior. Push also
        // creates the matching People DM for project-assigned approval recipients.
        if (notify.email || notify.sms) {
          const subGroups = new Map<string, { projectIds: Set<string>; dates: Set<string>; empCount: number }>();
          for (const dc of draftChanges) {
            if (dc.mode !== 'move' || !dc.toProjectId || !dc.toDate) continue;
            const emp = employeeLookup.find(e => e.id === dc.employeeId);
            if (!emp) continue;
            if (!subGroups.has(emp.company_id)) {
              subGroups.set(emp.company_id, { projectIds: new Set(), dates: new Set(), empCount: 0 });
            }
            const g = subGroups.get(emp.company_id)!;
            g.projectIds.add(dc.toProjectId);
            g.dates.add(dc.toDate);
            g.empCount += 1;
          }

          for (const [subCompanyId, g] of subGroups) {
            try {
              const projectId = Array.from(g.projectIds)[0];
              const { data: subProfiles } = await supabase
                .from('profiles')
                .select('user_id, email')
                .eq('company_id', subCompanyId);
              if (!subProfiles?.length) continue;

              const projectName = projects.find(p => g.projectIds.has(p.id))?.name || 'a project';
              const datesArr = Array.from(g.dates).sort();
              const dateLabel = datesArr.length === 1
                ? format(parseISO(datesArr[0]), 'MMM d, yyyy')
                : `${format(parseISO(datesArr[0]), 'MMM d')} – ${format(parseISO(datesArr[datesArr.length - 1]), 'MMM d, yyyy')}`;
              const { data: gcCompany } = await supabase
                .from('companies')
                .select('name')
                .eq('id', companyId)
                .maybeSingle();
              const variables = {
                gc_company_name: gcCompany?.name || 'A general contractor',
                project_name: projectName,
                scheduled_date: dateLabel,
                employee_count: String(g.empCount),
                message: `${gcCompany?.name || 'A general contractor'} has requested ${g.empCount} assignment(s) for ${projectName} on ${dateLabel}.`,
              };

              if (notify.email) {
                await sendNotification({
                  eventType: 'schedule_created',
                  recipientEmails: subProfiles.map(p => p.email).filter(Boolean) as string[],
                  recipientCompanyId: subCompanyId,
                  projectId,
                  variables,
                });
              }
              if (notify.sms) {
                // The RPC preserves the existing project-assignment and permission
                // rules: partial (Level 3), full (Level 4), and account holder.
                const { data: assignedUsers, error: assignedUsersError } = await supabase.rpc('get_project_notification_user_ids', {
                  p_project_id: projectId,
                  p_company_id: subCompanyId,
                } as any);
                if (assignedUsersError) throw assignedUsersError;
                const userIds = ((assignedUsers || []) as Array<{ user_id: string }>)
                  .map(row => row.user_id)
                  .filter(Boolean);
                if (userIds.length > 0) {
                  await sendNotification({
                    eventType: 'schedule_created',
                    recipientEmails: [],
                    recipientUserIds: userIds,
                    recipientCompanyId: subCompanyId,
                    projectId,
                    senderUserId,
                    variables,
                  });
                }
              }
            } catch (err) {
              console.error('GC notify error for sub', subCompanyId, err);
            }
          }
        }

        toast({
          title: 'Request sent',
          description: `${draftChanges.length} change(s) sent to subcontractor(s).`,
        });
        setDraftChanges([]);
        onDataChanged?.();
        setIsPublishing(false);
        return;
      }

      // === Sub mode (unchanged) ===
      // Group all inserts in this publish under one request_group_id so the
      // system message trigger collapses them into a single "Schedule edited" card.
      const subRequestGroupId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const shouldNotify = notify.email || notify.sms;

      // Pass 1: Remove employees from old confirmed requests (move-away cleanup).
      // Aggregate removals per original request so we only update each row once.
      const removalsByReq = new Map<string, Map<string, DraftChange[]>>();
      for (const dc of draftChanges) {
        if (dc.fromProjectId && dc.originalRequestId) {
          if (!removalsByReq.has(dc.originalRequestId)) {
            removalsByReq.set(dc.originalRequestId, new Map());
          }
          const byEmp = removalsByReq.get(dc.originalRequestId)!;
          if (!byEmp.has(dc.employeeId)) byEmp.set(dc.employeeId, []);
          byEmp.get(dc.employeeId)!.push(dc);
        }
      }
      for (const [reqId, byEmp] of removalsByReq) {
        const existingReq = scheduleRequests.find(r => r.id === reqId);
        if (!existingReq?.employee_ids) continue;
        const removed = new Set<string>();
        const remainingStops: Record<string, string[]> = canonicalStopMap(existingReq.employee_stops);
        for (const [empId, drafts] of byEmp) {
          if (drafts.some(d => !d.stopId)) {
            removed.add(empId);
            delete remainingStops[empId];
            continue;
          }
          const movedStopIds = new Set(drafts.map(d => d.stopId!));
          const before = currentStopIds(existingReq, empId, existingReq.project_id, existingReq.scheduled_date);
          const left = before.filter(id => !movedStopIds.has(id));
          if (left.length === 0) {
            removed.add(empId);
            delete remainingStops[empId];
          } else {
            remainingStops[empId] = left;
          }
        }
        const newIds = existingReq.employee_ids.filter(id => !removed.has(id));
        if (newIds.length === 0) {
          await supabase.from('schedule_requests').delete().eq('id', reqId);
        } else {
          await supabase.from('schedule_requests')
            .update({ employee_ids: newIds, employee_stops: remainingStops } as any)
            .eq('id', reqId);
        }
      }

      // Pass 2: Group "move" placements by (project, date, owning company) and
      // either merge into an existing pending/confirmed request or insert one row.
      // Personnel owned by a sub-of-sub become PENDING REQUESTS to that company
      // (the main sub can never self-confirm someone else's personnel).
      type SubGroup = { projectId: string; date: string; ownerCompanyId: string; empIds: string[]; stops: Record<string, string[] | null> };
      const subGroups = new Map<string, SubGroup>();
      for (const dc of draftChanges) {
        if (dc.mode !== 'move' || !dc.toProjectId || !dc.toDate) continue;
        const ownerCompanyId = employeeCompanyId(dc.employeeId);
        const key = `${dc.toProjectId}::${dc.toDate}::${ownerCompanyId}`;
        if (!subGroups.has(key)) {
          subGroups.set(key, { projectId: dc.toProjectId, date: dc.toDate, ownerCompanyId, empIds: [], stops: {} });
        }
        const g = subGroups.get(key)!;
        if (!g.empIds.includes(dc.employeeId)) g.empIds.push(dc.employeeId);
        if (!dc.stopId) {
          g.stops[dc.employeeId] = null;
        } else if (g.stops[dc.employeeId] !== null) {
          const list = g.stops[dc.employeeId] || [];
          g.stops[dc.employeeId] = list.includes(dc.stopId) ? list : [...list, dc.stopId];
        }
      }

      const mergeSubStops = (g: SubGroup, base: Record<string, string[]> | null | undefined) => {
        const out: Record<string, string[]> = canonicalStopMap(base);
        for (const empId of g.empIds) {
          const incoming = g.stops[empId];
          if (incoming === null || incoming === undefined) delete out[empId];
          else out[empId] = Array.from(new Set([...(out[empId] || []), ...incoming]));
        }
        return out;
      };

      const affectedRequestIds: string[] = [];
      let requestedOtherCompany = false;
      for (const [, g] of subGroups) {
        const isOwn = g.ownerCompanyId === companyId;
        if (!isOwn) requestedOtherCompany = true;
        const existing = scheduleRequests.find(r =>
          r.project_id === g.projectId &&
          r.scheduled_date === g.date &&
          r.sub_company_id === g.ownerCompanyId &&
          ['pending', 'confirmed'].includes(r.status || '')
        );

        if (existing) {
          const merged = Array.from(new Set([...(existing.employee_ids || []), ...g.empIds]));
          const { error } = await supabase
            .from('schedule_requests')
            .update({
              employee_ids: merged,
              employee_stops: mergeSubStops(g, existing.employee_stops),
              edited: true,
              last_edited_by_company_id: companyId,
              edit_reason: editReason,
              // Own personnel: the sub is the scheduler, so the merged row becomes a
              // confirmed sub-assignment. Other companies' personnel stay a pending request.
              ...(isOwn
                ? { status: 'confirmed', sub_assigned: true, silent_assignment: !shouldNotify }
                : { status: 'pending' }),
              ...(existing.request_group_id ? {} : { request_group_id: subRequestGroupId }),
            } as any)
            .eq('id', existing.id);
          if (error) {
            console.error('Error merging sub request:', error);
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
            setIsPublishing(false);
            return;
          }
          affectedRequestIds.push(existing.id);
        } else {
          const { data: inserted, error } = await supabase.from('schedule_requests').insert({
            project_id: g.projectId,
            sub_company_id: g.ownerCompanyId,
            requesting_company_id: companyId,
            ...(isOwn ? {} : { intermediary_company_id: companyId }),
            scheduled_date: g.date,
            status: isOwn ? 'confirmed' : 'pending',
            employee_ids: g.empIds,
            employee_stops: mergeSubStops(g, null),
            sub_assigned: isOwn,
            silent_assignment: isOwn ? !shouldNotify : false,
            edited: true,
            last_edited_by_company_id: companyId,
            edit_reason: editReason,
            request_group_id: subRequestGroupId,
          } as any).select('id').single();
          if (error) {
            console.error('Error publishing draft:', error);
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
            setIsPublishing(false);
            return;
          }
          if (inserted?.id) affectedRequestIds.push(inserted.id);
        }
      }

      // Notify from the request data written in this publish cycle. The parent refresh is
      // intentionally separate so a state-update race cannot suppress the notification.
      const shouldNotifyPersonnel = !!(notify.notifyPersonnelEmail || notify.notifyPersonnelSms);
      if (shouldNotifyPersonnel && onNotifyPersonnel && affectedRequestIds.length > 0) {
        await Promise.all(affectedRequestIds.map(async (id) => {
          try {
            await onNotifyPersonnel(id, {
              email: !!notify.notifyPersonnelEmail,
              sms: !!notify.notifyPersonnelSms,
            });
          } catch (e) {
            console.error('notify personnel failed', e);
          }
        }));
      }
      onDataChanged?.();

      // Send notifications if opted in
      if (notify.email || notify.sms) {
        const affectedProjectIds = [...new Set(draftChanges.filter(dc => dc.toProjectId).map(dc => dc.toProjectId!))];
        for (const projectId of affectedProjectIds) {
          const project = projects.find(p => p.id === projectId);
          if (!project || project.company_id === companyId) continue;

          try {
            const { data: gcProfiles } = await supabase
              .from('profiles')
              .select('user_id, email, phone')
              .eq('company_id', project.company_id);

            if (gcProfiles?.length) {
              if (notify.email) {
                await sendNotification({
                  eventType: 'schedule_created',
                  recipientEmails: (gcProfiles.map(p => p.email).filter(Boolean) as string[]),
                  recipientCompanyId: project.company_id,
                  projectId,
                  variables: {
                    project_name: project.name,
                    message: 'Schedule has been updated by your subcontractor.',
                  },
                });
              }
              if (notify.sms) {
                const pushUserIds = gcProfiles.map(p => p.user_id).filter(Boolean) as string[];
                if (pushUserIds.length > 0) {
                  await sendNotification({
                    eventType: 'schedule_created',
                    recipientEmails: [],
                    recipientUserIds: pushUserIds,
                    recipientCompanyId: project.company_id,
                    projectId,
                    variables: {
                      project_name: project.name,
                      message: 'Schedule has been updated by your subcontractor.',
                    },
                  });
                }
              }
            }
          } catch (err) {
            console.error('Notification error:', err);
          }
        }
      }

      toast({
        title: requestedOtherCompany ? 'Schedule published — requests sent' : 'Schedule published',
        description: requestedOtherCompany
          ? `${draftChanges.length} change(s) saved. Personnel from connected subcontractors were sent as requests awaiting their approval.`
          : `${draftChanges.length} change(s) saved successfully.`,
      });
      setDraftChanges([]);
      onDataChanged?.();
    } catch (err) {
      console.error('Publish error:', err);
      toast({ title: 'Error', description: 'Failed to publish schedule', variant: 'destructive' });
    } finally {
      setIsPublishing(false);
    }
  };

  const relevantProjects = useMemo(() => displayProjects, [displayProjects]);

  // Mobile: default the project filter to ALL relevant projects so the weekly
  // view isn't empty on first load. Union-merge so newly-added projects show up
  // automatically without overriding the user's manual deselections.
  useEffect(() => {
    if (!isMobile) return;
    const allIds = relevantProjects.map(p => p.id);
    setSelectedMobileProjects(prev => {
      if (prev.length === 0) return allIds;
      const missing = allIds.filter(id => !prev.includes(id));
      return missing.length === 0 ? prev : [...prev, ...missing];
    });
  }, [isMobile, relevantProjects]);

  // Build task row layout per project: assign each overlapping task a row index so they stack without overlap
  const projectTaskLayout = useMemo(() => {
    const layout = new Map<string, { task: TaskItem; row: number }[]>();
    for (const project of projects) {
      const projTasks = tasks
        .filter(t => t.project_id === project.id && t.end_date >= visibleDateStrings[0] && t.start_date <= visibleDateStrings[visibleDateStrings.length - 1])
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
      const rowEnds: string[] = []; // rowEnds[i] = end_date of last task in row i
      const placed: { task: TaskItem; row: number }[] = [];
      for (const t of projTasks) {
        let row = rowEnds.findIndex(end => end < t.start_date);
        if (row === -1) { row = rowEnds.length; rowEnds.push(t.end_date); }
        else { rowEnds[row] = t.end_date; }
        placed.push({ task: t, row });
      }
      layout.set(project.id, placed);
    }
    return layout;
  }, [projects, tasks, visibleDateStrings]);

  // ---- Mobile roster (same data the desktop sidebars use) -------------------
  // Groups of chips shown inside the mobile "Employees" dropdown. GC/MOA views
  // group by subcontractor company; a sub sees a single group of its own people.
  type MobileChip = {
    dragId: string;
    emp: MatrixEmployee;
    timeLabel?: string;
    stopLabel?: string;
    scheduled: boolean;
    warningLabel?: string;
  };
  const mobileRosterGroups = useMemo(() => {
    if (!isMobile) return [] as { id: string; name: string; chips: MobileChip[] }[];
    const dayFilter = selectedWeeklyDate ? [selectedWeeklyDate] : visibleDateStrings;
    const dayFilterSet = new Set(dayFilter);
    const label = (a: AvailabilityRecord) => `${formatTimeLabel(a.start_time)} – ${formatTimeLabel(a.end_time)}`;

    const buildForCompany = (empList: MatrixEmployee[]): MobileChip[] => {
      const chips: MobileChip[] = [];
      const scheduledIds = new Set<string>();
      // Scheduled chips first (already placed somewhere in the visible window)
      scheduledEntries.forEach(se => {
        if (!dayFilterSet.has(se.date)) return;
        const emp = empList.find(e => e.id === se.employeeId);
        if (!emp) return;
        if (scheduledIds.has(emp.id)) return;
        scheduledIds.add(emp.id);
        const projName = projects.find(p => p.id === se.projectId)?.name;
        chips.push({
          dragId: `sidebar::${emp.id}`,
          emp,
          timeLabel: projName ? `${projName} · ${format(parseISO(se.date), 'EEE MMM d')}` : undefined,
          scheduled: true,
        });
      });

      // Available stops
      empList.forEach(emp => {
        if (scheduledIds.has(emp.id)) return;
        const blocks = availabilities
          .filter(a => a.employee_id === emp.id && dayFilterSet.has(availabilityDateStr(a.start_time)))
          .filter(a => {
            if (singleProjectMode && projects[0]) {
              return a.all_projects === true || a.project_id === projects[0].id || a.project_id === null;
            }
            return true;
          })
          .sort((a, b) => a.start_time.localeCompare(b.start_time));

        // Dedupe identical stops saved against multiple projects
        const seen = new Map<string, AvailabilityRecord>();
        for (const a of blocks) {
          const ds = availabilityDateStr(a.start_time);
          const key = a.stop_number != null ? `${ds}::stop::${a.stop_number}` : `${ds}::range::${a.start_time}::${a.end_time}`;
          const existing = seen.get(key);
          if (!existing || a.id < existing.id) seen.set(key, a);
        }
        const unique = Array.from(seen.values()).sort((a, b) => a.start_time.localeCompare(b.start_time));

        if (unique.length === 0) {
          if (selectedWeeklyDate && scheduledStopKeys.allStopsByEmpDate.has(`${emp.id}::${selectedWeeklyDate}`)) return;
          if (isGcMode) return; // GCs only ever place from real availability
          chips.push({ dragId: `sidebar::${emp.id}::single`, emp, scheduled: false });
          return;
        }

        unique.forEach(avail => {
          const ds = availabilityDateStr(avail.start_time);
          if (scheduledStopKeys.perStop.has(`${emp.id}::${avail.id}::${ds}`)) return;
          if (scheduledStopKeys.allStopsByEmpDate.has(`${emp.id}::${ds}`)) return;
          if (crossGcBookings.has(`${emp.id}::${ds}`)) return;
          chips.push({
            dragId: `sidebar::${emp.id}::${avail.id}`,
            emp,
            timeLabel: `${selectedWeeklyDate ? '' : `${format(parseISO(ds), 'EEE MMM d')} · `}${label(avail)}`,
            stopLabel: avail.stop_number ? `Stop ${avail.stop_number}` : undefined,
            scheduled: false,
            warningLabel: sameGcOtherProjectMap.get(`${emp.id}::${ds}`),
          });
        });
      });
      return chips;
    };

    const groups: { id: string; name: string; chips: MobileChip[] }[] = [];

    if (!isGcMode) {
      const ownList = employees.filter(e => e.company_id === companyId);
      const ownChips = buildForCompany(ownList);
      if (ownChips.length > 0) groups.push({ id: companyId, name: 'My Team', chips: ownChips });
      return groups;
    }

    connectedSubs
      .filter(sub => sub.id !== companyId)
      .forEach(sub => {
        const chips = buildForCompany(allEmployees.filter(e => e.company_id === sub.id));
        if (chips.length > 0) groups.push({ id: sub.id, name: sub.name, chips });
      });

    return groups;

  }, [isMobile, selectedWeeklyDate, visibleDateStrings, availabilities, scheduledEntries, scheduledStopKeys, crossGcBookings, sameGcOtherProjectMap, isGcMode, connectedSubs, allEmployees, employees, companyId, projects, singleProjectMode, formatTimeLabel]);

  const mobileRosterCount = useMemo(
    () => mobileRosterGroups.reduce((sum, g) => sum + g.chips.length, 0),
    [mobileRosterGroups]
  );


  // Dialogs shared by the mobile and desktop layouts (paste confirm, publish flows).
  const sharedDialogs = (
    <>
      <AlertDialog open={showPasteConfirm} onOpenChange={setShowPasteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Override existing schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pasteTarget && `This will add assignments to ${format(parseISO(pasteTarget), 'EEE, MMM d')} which already has scheduled employees. Existing confirmed assignments will be kept. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setShowPasteConfirm(false); setPasteTarget(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pasteTarget) executePaste(pasteTarget);
              setShowPasteConfirm(false);
              setPasteTarget(null);
            }}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isGcMode && (() => {
        const subIds = new Set<string>();
        const allDates = new Set<string>();
        let assignmentCount = 0;
        for (const dc of draftChanges) {
          if (dc.mode !== 'move' || !dc.toDate) continue;
          assignmentCount += 1;
          allDates.add(dc.toDate);
          const emp = employeeLookup.find(e => e.id === dc.employeeId);
          if (emp) subIds.add(emp.company_id);
        }
        const subNameMap = new Map(connectedSubs.map(s => [s.id, s.name]));
        const subSummary = subIds.size === 1
          ? (subNameMap.get(Array.from(subIds)[0]) || 'The subcontractor')
          : `${subIds.size} subcontractors`;
        const datesArr = Array.from(allDates).sort();
        const dateRangeLabel = datesArr.length === 0
          ? undefined
          : datesArr.length === 1
            ? format(parseISO(datesArr[0]), 'MMM d, yyyy')
            : `${format(parseISO(datesArr[0]), 'MMM d')} – ${format(parseISO(datesArr[datesArr.length - 1]), 'MMM d, yyyy')}`;
        return (
          <NotifyOnAssignDialog
            open={showNotifyDialog}
            onOpenChange={setShowNotifyDialog}
            subSummary={subSummary}
            assignmentCount={assignmentCount}
            dateRangeLabel={dateRangeLabel}
            onChoose={(choice) => { void doPublish(choice); }}
          />
        );
      })()}

      <UnassignedAssignmentDialog
        open={showUnassignedDialog}
        onOpenChange={setShowUnassignedDialog}
        pairs={unassignedDraftPairs}
        onConfirm={() => {
          const notify = pendingPublishNotify ?? { email: false, sms: false };
          setPendingPublishNotify(null);
          void doPublish(notify);
        }}
        onCancel={() => {
          setPendingPublishNotify(null);
        }}
      />
    </>
  );

  // Mobile layout — same capabilities as desktop, driven by tap-to-place instead of drag.
  if (isMobile) {
    const DAY_COL_WIDTH = 132; // px per day column on mobile
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const placing = selectedChipIds.size > 0;
    const mobileVisibleProjects = relevantProjects.filter(p => selectedMobileProjects.includes(p.id));

    const handleMobileDayTap = (dateStr: string) => {
      if (!canActOnRequests) return;
      if (copiedSchedule) {
        const hasExisting = projects.some(p => {
          const emps = matrixData.get(p.id)?.get(dateStr);
          return emps && emps.length > 0;
        });
        if (hasExisting) { setPasteTarget(dateStr); setShowPasteConfirm(true); }
        else executePaste(dateStr);
        return;
      }
      setSelectedWeeklyDate(prev => (prev === dateStr ? null : dateStr));
      setSelectedDate(dateStr);
    };
    const handleCellTap = (projectId: string, dateStr: string) => {
      if (!placing) return;
      applySelectedChipsToTarget(projectId, dateStr);
    };

    return (
      <TooltipProvider>
        <div className="flex flex-col h-full">
          {/* Project filter chips (filter only — collapsing lives on each project row) */}
          <div className="bg-background border-b border-border p-2 overflow-x-auto flex items-center gap-2 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
            <span className="flex-shrink-0 text-[10px] uppercase font-semibold text-muted-foreground pr-1">Filter</span>

            {relevantProjects.map(p => (
              <button
                key={p.id}
                disabled={!canActOnRequests}
                onClick={canActOnRequests ? () => setSelectedMobileProjects(prev =>
                  prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                ) : undefined}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  selectedMobileProjects.includes(p.id)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {p.name}
              </button>
            ))}
            {relevantProjects.length === 0 && (
              <span className="text-xs text-muted-foreground px-2 py-1.5">No projects to display</span>
            )}
          </div>

          {/* Toolbar: overlay + copy on the left, Employees dropdown on the right */}
          <div className="bg-background border-b border-border px-2 py-2 flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1">
              <Checkbox
                id="matrix-task-overlay-mobile"
                checked={showTaskOverlay}
                onCheckedChange={(checked) => onToggleTaskOverlay?.(!!checked)}
                className="h-4 w-4"
              />
              <label htmlFor="matrix-task-overlay-mobile" className="text-[11px] text-muted-foreground whitespace-nowrap">
                Overlay
              </label>
            </div>

            {canActOnRequests && (copiedSchedule ? (
              <button
                onClick={() => setCopiedSchedule(null)}
                className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary truncate max-w-[38%]"
              >
                Copied {format(parseISO(copiedSchedule.sourceDate), 'MMM d')} — tap a day
              </button>
            ) : (
              <button
                onClick={() => handleCopySchedule(selectedWeeklyDate || visibleDateStrings[0])}
                className="text-[11px] px-2 py-1 rounded-md bg-muted text-foreground whitespace-nowrap"
              >
                Copy day
              </button>
            ))}

            {canActOnRequests && <div className="ml-auto flex items-center gap-2">
              {selectedWeeklyDate && (
                <button onClick={() => setSelectedWeeklyDate(null)} className="text-[11px] text-muted-foreground underline">
                  Clear day
                </button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors max-w-[55vw]">
                    <span className="truncate">
                      {selectedWeeklyDate
                        ? `Employees — ${format(parseISO(selectedWeeklyDate), 'EEE, MMM d')}`
                        : `Employees (${mobileRosterCount})`}
                    </span>
                    <ChevronDown className="h-3 w-3 flex-shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" className="w-[85vw] max-w-sm p-0 max-h-[60vh] overflow-y-auto">
                  <div className="p-2 border-b border-border text-[11px] text-muted-foreground">
                    {selectedWeeklyDate
                      ? 'Tap people to select, then tap a project day to place them.'
                      : 'Tap a day above to filter by date. Tap people to select.'}
                  </div>
                  {mobileRosterGroups.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">No available personnel.</div>
                  ) : (
                    <div className="p-2 space-y-3">
                      {mobileRosterGroups.map(group => (
                        <div key={group.id}>
                          <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 px-1 truncate">
                            {group.name}
                          </div>
                          <div className="space-y-1.5">
                            {group.chips.map(chip => (
                              <MatrixEmployeeCard
                                key={chip.dragId}
                                employee={chip.emp}
                                density="compact"
                                status={chip.scheduled ? 'confirmed' : 'available'}
                                dragId={chip.dragId}
                                draggable={false}
                                timeLabel={chip.warningLabel ? `${chip.timeLabel ?? ''} · ${chip.warningLabel}` : chip.timeLabel}
                                stopLabel={chip.stopLabel}
                                selected={selectedChipIds.has(chip.dragId)}
                                onToggleSelect={() => toggleChipSelection(chip.dragId)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>}
          </div>

          {/* Selection action bar */}
          {canActOnRequests && placing && (
            <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20 flex-shrink-0">
              <span className="text-xs font-medium text-primary truncate">
                {selectedChipIds.size} selected · tap a project day to place
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => applySelectedChipsToTarget(null, null)}
                  className="text-[11px] px-2 py-1 rounded-md bg-destructive/10 text-destructive"
                >
                  Remove
                </button>
                <button
                  onClick={() => setSelectedChipIds(new Set())}
                  className="text-[11px] px-2 py-1 rounded-md bg-muted text-muted-foreground"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Scrollable week grid: day header + per-project rows */}
          <div ref={mobileScrollRef} className="flex-1 overflow-auto pb-24">
            <div style={{ minWidth: `${DAY_COL_WIDTH * visibleDays.length}px` }}>
              {/* Day-of-week header */}
              <div className="sticky top-0 z-10 bg-background border-b border-border flex">
                {visibleDays.map((day, i) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isToday = dateStr === todayStr;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const isSelected = dateStr === selectedWeeklyDate;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={canActOnRequests ? () => handleMobileDayTap(dateStr) : undefined}
                      style={{ width: `${DAY_COL_WIDTH}px` }}
                      className={`flex-shrink-0 px-1 py-2 text-center border-r border-border last:border-r-0 transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : isToday
                            ? 'bg-primary/10 text-primary'
                            : isWeekend
                              ? 'bg-muted/40 text-muted-foreground'
                              : 'text-muted-foreground hover:bg-muted/30'
                      }`}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide">{format(day, 'EEE')}</div>
                      <div className="text-[10px]">{format(day, 'MMM d')}</div>
                    </button>
                  );
                })}
                {/* Horizontal lazy-load sentinel */}
                <div ref={mobileSentinelRef} style={{ width: '4px' }} className="flex-shrink-0" />
              </div>

              {/* Project rows — never blank out: if the filter is empty, show all */}
              {relevantProjects.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No projects to display.
                </div>
              ) : (
                <div>
                  {(mobileVisibleProjects.length > 0 ? mobileVisibleProjects : relevantProjects)
                    .map(project => {
                      const dateMap = matrixData.get(project.id);
                      const projTasks = projectTaskLayout.get(project.id) || [];
                      const projectCollapsed = collapsedProjectIds.has(project.id);
                      return (
                        <div key={project.id} className="border-b border-border">
                          <div
                            className="sticky left-0 z-[5] flex items-center gap-2 px-2 py-2 text-sm font-medium bg-background"
                            style={{ width: '100vw', maxWidth: '100%' }}
                          >
                            <button
                              type="button"
                              aria-expanded={!projectCollapsed}
                              aria-label={projectCollapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
                              disabled={!canActOnRequests}
                              onClick={canActOnRequests ? (e) => { e.stopPropagation(); toggleProjectCollapse(project.id); } : undefined}
                              className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-md border border-border bg-muted/40 text-foreground active:bg-muted"
                            >
                              {projectCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                            </button>
                            <span className="truncate text-left flex-1">{project.name}</span>
                          </div>

                          {!projectCollapsed && (
                            <div className="flex pb-2">
                              {visibleDays.map((day, i) => {

                                const dateStr = format(day, 'yyyy-MM-dd');
                                const cellEmps = dateMap?.get(dateStr) || [];
                                const isToday = dateStr === todayStr;
                                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                                const cellTasks = showTaskOverlay
                                  ? projTasks.filter(({ task }) => dateStr >= task.start_date && dateStr <= task.end_date)
                                  : [];
                                return (
                                    <div
                                      key={i}
                                      onClick={canActOnRequests ? () => handleCellTap(project.id, dateStr) : undefined}
                                      style={{ width: `${DAY_COL_WIDTH}px` }}
                                      className={`flex-shrink-0 border-r border-border last:border-r-0 p-1 min-h-[80px] ${
                                        canActOnRequests && placing ? 'ring-1 ring-inset ring-primary/30 cursor-pointer' : ''
                                    } ${isToday ? 'bg-primary/5' : isWeekend ? 'bg-muted/20' : ''}`}
                                  >
                                    {cellTasks.length > 0 && (
                                      <div className="flex flex-col gap-0.5 mb-1">
                                        {cellTasks.map(({ task }) => (
                                          <div
                                            key={task.id}
                                            className="text-[9px] font-medium text-white truncate rounded-sm px-1 py-0.5"
                                            style={{ backgroundColor: task.color }}
                                          >
                                            {task.name}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {cellEmps.length === 0 ? (
                                      <div className="text-[10px] text-muted-foreground/50 italic text-center pt-2">
                                        {placing ? 'Tap to place' : '—'}
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-1">
                                        {cellEmps.map(emp => {
                                          const status = getCardStatus(emp.id, project.id, dateStr);
                                          if (status === 'available') return null;
                                          const stops = getEmployeeStopsForCell(emp.id, project.id, dateStr);
                                          const renderChips = stops.length > 0 ? stops : [null];
                                          return renderChips.map((stop, idx) => {
                                            const timeLabel = stop ? `${formatTimeLabel(stop.start_time)} – ${formatTimeLabel(stop.end_time)}` : undefined;
                                            const stopLabel = stop?.stop_number ? `Stop ${stop.stop_number}` : undefined;
                                            const key = stop ? `${emp.id}::${stop.id}` : `${emp.id}::single`;
                                            const dragIdStr = `matrix::${project.id}::${dateStr}::${emp.id}${stop ? `::${stop.id}` : ''}`;
                                            return (
                                              <div key={key} onClick={(e) => e.stopPropagation()}>
                                                <MatrixEmployeeCard
                                                  employee={emp}
                                                  density="compact"
                                                  status={status}
                                                  dragId={dragIdStr}
                                                  draggable={false}
                                                  onCancelClick={canActOnRequests ? () => handleCancelClick(emp.id, project.id, dateStr) : undefined}
                                                  onRemove={canActOnRequests && (status === 'draft' || status === 'confirmed' || status === 'pending') && idx === 0
                                                    ? () => addRemovalDraft(emp.id, project.id, dateStr)
                                                    : undefined}
                                                  timeLabel={timeLabel}
                                                  stopLabel={stopLabel}
                                                  selected={canActOnRequests && selectedChipIds.has(dragIdStr)}
                                                  onToggleSelect={canActOnRequests ? () => toggleChipSelection(dragIdStr) : undefined}
                                                  unassignedWarning={status === 'draft' && isUnassignedPair(emp.id, project.id)}
                                                />
                                              </div>
                                            );
                                          });
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>

              )}
            </div>
          </div>
        </div>

        {canActOnRequests && <MatrixDraftBar changes={draftChanges} onRevert={handleRevert} onPublish={handlePublish} isPublishing={isPublishing} mode={isGcMode ? 'gc' : 'sub'} />}

        {sharedDialogs}
      </TooltipProvider>
    );
  }


  // Desktop Gantt matrix
  return (
    <TooltipProvider>
      <DndContext
        sensors={canActOnRequests ? sensors : []}
        onDragStart={canActOnRequests ? handleDragStart : undefined}
        onDragEnd={canActOnRequests ? handleDragEnd : undefined}
        collisionDetection={pointerWithin}
      >
        <div className="flex h-full" ref={(el) => weeklyTip.setAnchor(el)}>
          {weeklyTip.show && (
            <FirstClickTooltip
              anchor={weeklyTip.anchor}
              copy={getCalendarTipCopy(effectiveTourRole, 'weekly')}
              onDismiss={weeklyTip.dismiss}
            />
          )}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div ref={scrollContainerRef} className="flex-1 overflow-auto relative">
              <table className="border-collapse w-max min-w-full">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <th className="sticky left-0 z-30 bg-muted border border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground min-w-[160px] max-w-[200px]">
                      <div className="flex flex-col gap-1">
                        <span>Projects</span>
                        <div className="flex items-center gap-1">
                          <Checkbox
                            id="matrix-task-overlay"
                            checked={showTaskOverlay}
                            disabled={!canActOnRequests}
                            onCheckedChange={canActOnRequests ? (checked) => onToggleTaskOverlay?.(!!checked) : undefined}
                            className="h-3 w-3"
                          />
                          <label htmlFor="matrix-task-overlay" className="text-[10px] font-normal text-muted-foreground cursor-pointer whitespace-nowrap">
                            Schedule Overlay
                          </label>
                        </div>
                      </div>
                    </th>
                    {visibleDays.map((day, i) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      const isSelected = dateStr === effectiveSelectedDate;
                      return (
                        <th
                          key={i}
                          onClick={() => handleDayHeaderClick(dateStr)}
                          style={{ minWidth: `${columnMinWidth}px` }}
                          className={`border border-border px-2 py-2 text-center text-xs font-medium cursor-pointer select-none transition-colors ${
                            isSelected ? 'bg-primary/20 text-primary ring-2 ring-inset ring-primary/40' : isToday ? 'bg-primary/10 text-primary' : isWeekend ? 'bg-muted/50 text-muted-foreground' : 'bg-muted text-muted-foreground'
                          } hover:bg-primary/15`}
                        >
                          <div className="font-semibold">{format(day, 'EEE')}</div>
                          <div className="text-[10px]">{format(day, 'MMM d')}</div>
                        </th>
                      );
                    })}
                    <th ref={sentinelRef} className="w-4 border-none" />
                  </tr>
                </thead>

                <tbody>
                  {relevantProjects.map(project => {
                    const projectCollapsed = collapsedProjectIds.has(project.id);
                    return (
                    <tr key={project.id}>
                      <td className="sticky left-0 z-10 bg-card border border-border px-3 py-2 text-sm font-medium min-w-[160px] max-w-[200px]">
                        <div className="flex items-center gap-1">
                          <span className="truncate flex-1">{project.name}</span>
                          <button
                            type="button"
                            aria-expanded={!projectCollapsed}
                            aria-label={projectCollapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
                            title={projectCollapsed ? 'Expand' : 'Collapse'}
                            disabled={!canActOnRequests}
                            onClick={canActOnRequests ? (e) => { e.stopPropagation(); toggleProjectCollapse(project.id); } : undefined}
                            className="flex-shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          >
                            {projectCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      {visibleDays.map((day, i) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const cellId = `cell::${project.id}::${dateStr}`;
                        const cellEmps = matrixData.get(project.id)?.get(dateStr) || [];
                        const density = getDensity(cellEmps.length);
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                        if (projectCollapsed) {
                          return (
                            <td
                              key={i}
                              style={{ minWidth: `${columnMinWidth}px` }}
                              className={`border border-border p-0 h-6 ${isWeekend ? 'bg-muted/20' : ''}`}
                            />
                          );
                        }

                        return (

                          <td key={i} className={`border border-border p-0 align-top ${isWeekend ? 'bg-muted/20' : ''}`}>
                            <DroppableCell id={cellId}>
                              {/* Task overlay: connected horizontal bars, names on first day */}
                              {showTaskOverlay && (() => {
                                const projTasks = projectTaskLayout.get(project.id) || [];
                                const cellTasks = projTasks.filter(({ task }) => dateStr >= task.start_date && dateStr <= task.end_date);
                                if (cellTasks.length === 0) return null;
                                const maxRow = Math.max(...cellTasks.map(ct => ct.row));
                                const rows: ({ task: TaskItem; row: number } | null)[] = Array(maxRow + 1).fill(null);
                                cellTasks.forEach(ct => { rows[ct.row] = ct; });
                                const prevDateStr = i > 0 ? format(visibleDays[i - 1], 'yyyy-MM-dd') : null;
                                const nextDateStr = i < visibleDays.length - 1 ? format(visibleDays[i + 1], 'yyyy-MM-dd') : null;
                                return (
                                  <div className="flex flex-col gap-0.5 mb-1 pb-1 border-b border-border/60">
                                    {rows.map((ct, rowIdx) => {
                                      if (!ct) return <div key={rowIdx} className="h-[14px]" />;
                                      const { task } = ct;
                                      const isStart = task.start_date === dateStr || prevDateStr === null || task.start_date > (prevDateStr || '');
                                      const isEnd = task.end_date === dateStr || nextDateStr === null || task.end_date < (nextDateStr || '');
                                      return (
                                        <Tooltip key={task.id}>
                                          <TooltipTrigger asChild>
                                            <div
                                              className={`h-[14px] flex items-center px-1 text-[9px] font-medium text-white truncate cursor-default ${isStart ? 'rounded-l-sm' : '-ml-px'} ${isEnd ? 'rounded-r-sm' : '-mr-px'}`}
                                              style={{ backgroundColor: task.color }}
                                            >
                                              {isStart && <span className="truncate">{task.name}</span>}
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs">
                                            {task.name} ({task.start_date} → {task.end_date})
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {(() => {
                                // GC/MOA mode: group chips by sub company so the GC sees who's
                                // scheduled per subcontractor on each day.
                                if (isGcMode && cellEmps.length > 0) {
                                  const subNameMap = new Map(connectedSubs.map(s => [s.id, s.name]));
                                  const groups = new Map<string, MatrixEmployee[]>();
                                  cellEmps.forEach(emp => {
                                    const key = emp.company_id;
                                    if (!groups.has(key)) groups.set(key, []);
                                    groups.get(key)!.push(emp);
                                  });
                                  // Status priority for stable sort: confirmed > draft > pending > others
                                  const statusOrder: Record<string, number> = { confirmed: 0, draft: 1, pending: 2, cancelled: 3, available: 4 };
                                  return (
                                    <div className="flex flex-col gap-1">
                                      {Array.from(groups.entries()).map(([subId, emps]) => {
                                        const sortedEmps = [...emps].sort((a, b) => {
                                          const sa = getCardStatus(a.id, project.id, dateStr);
                                          const sb = getCardStatus(b.id, project.id, dateStr);
                                          return (statusOrder[sa] ?? 99) - (statusOrder[sb] ?? 99);
                                        });
                                        const isCollapsed = collapsedGridSubs.has(subId);
                                        const visibleCount = sortedEmps.filter(e => getCardStatus(e.id, project.id, dateStr) !== 'available').length;
                                        return (
                                          <div key={subId} className="flex flex-col gap-0.5">
                                            <button
                                              type="button"
                                              disabled={!canActOnRequests}
                                              onClick={canActOnRequests ? (e) => { e.stopPropagation(); toggleGridSubCollapsed(subId); } : undefined}
                                              className="flex items-center gap-1 text-[9px] font-semibold uppercase text-muted-foreground hover:text-foreground px-0.5 w-full text-left"
                                              title={isCollapsed ? 'Expand' : 'Collapse'}
                                            >
                                              {isCollapsed ? <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 flex-shrink-0" />}
                                              <span className="truncate">{subNameMap.get(subId) || 'Subcontractor'}</span>
                                              {isCollapsed && visibleCount > 0 && (
                                                <span className="ml-auto normal-case font-normal">({visibleCount})</span>
                                              )}
                                            </button>
                                            {!isCollapsed && (
                                              <div className={`flex flex-col gap-0.5 ${density === 'minimal' ? 'flex-wrap flex-row' : ''}`}>
                                                {sortedEmps.map(emp => {
                                                  const status = getCardStatus(emp.id, project.id, dateStr);
                                                  if (status === 'available') return null;
                                                  const stops = getEmployeeStopsForCell(emp.id, project.id, dateStr);
                                                  const renderChips = stops.length > 0 ? stops : [null];
                                                  return renderChips.map((stop, idx) => {
                                                    const timeLabel = stop ? `${formatTimeLabel(stop.start_time)} – ${formatTimeLabel(stop.end_time)}` : undefined;
                                                    const stopLabel = stop?.stop_number ? `Stop ${stop.stop_number}` : undefined;
                                                    const key = stop ? `${emp.id}::${stop.id}` : `${emp.id}::single`;
                                                    const dragIdStr = `matrix::${project.id}::${dateStr}::${emp.id}${stop ? `::${stop.id}` : ''}`;
                                                    return (
                                                      <MatrixEmployeeCard
                                                        key={key}
                                                        employee={emp}
                                                        density={density}
                                                        status={status}
                                                        dragId={dragIdStr}
                                                        draggable={canActOnRequests}
                                                        onCancelClick={canActOnRequests ? () => handleCancelClick(emp.id, project.id, dateStr) : undefined}
                                                        onRemove={canActOnRequests && (status === 'draft' || status === 'confirmed' || status === 'pending') && idx === 0
                                                          ? () => addRemovalDraft(emp.id, project.id, dateStr)
                                                          : undefined}
                                                        timeLabel={timeLabel}
                                                        stopLabel={stopLabel}
                                                        selected={canActOnRequests && selectedChipIds.has(dragIdStr)}
                                                        onToggleSelect={canActOnRequests ? () => toggleChipSelection(dragIdStr) : undefined}
                                                      />
                                                    );
                                                  });
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                }
                                return (
                                  <div className={`flex flex-col gap-0.5 ${density === 'minimal' ? 'flex-wrap flex-row' : ''}`}>
                                    {cellEmps.map(emp => {
                                      const status = getCardStatus(emp.id, project.id, dateStr);
                                      if (status === 'available') return null;
                                      const stops = getEmployeeStopsForCell(emp.id, project.id, dateStr);
                                      const renderChips = stops.length > 0 ? stops : [null];
                                      return renderChips.map((stop, idx) => {
                                        const timeLabel = stop ? `${formatTimeLabel(stop.start_time)} – ${formatTimeLabel(stop.end_time)}` : undefined;
                                        const stopLabel = stop?.stop_number ? `Stop ${stop.stop_number}` : undefined;
                                        const key = stop ? `${emp.id}::${stop.id}` : `${emp.id}::single`;
                                        const dragIdStr = `matrix::${project.id}::${dateStr}::${emp.id}${stop ? `::${stop.id}` : ''}`;
                                        return (
                                          <MatrixEmployeeCard
                                            key={key}
                                            employee={emp}
                                            density={density}
                                            status={status}
                                            dragId={dragIdStr}
                                            draggable={canActOnRequests}
                                            onCancelClick={canActOnRequests ? () => handleCancelClick(emp.id, project.id, dateStr) : undefined}
                                            onRemove={canActOnRequests && (status === 'draft' || status === 'confirmed') && idx === 0
                                              ? () => addRemovalDraft(emp.id, project.id, dateStr)
                                              : undefined}
                                            timeLabel={timeLabel}
                                            stopLabel={stopLabel}
                                            selected={canActOnRequests && selectedChipIds.has(dragIdStr)}
                                            onToggleSelect={canActOnRequests ? () => toggleChipSelection(dragIdStr) : undefined}
                                            unassignedWarning={status === 'draft' && isUnassignedPair(emp.id, project.id)}
                                          />
                                        );
                                      });
                                    })}
                                  </div>
                                );
                              })()}
                            </DroppableCell>
                          </td>
                        );
                      })}
                      <td className="border-none" />
                    </tr>
                    );
                  })}


                  {relevantProjects.length === 0 && (
                    <tr>
                      <td colSpan={visibleDays.length + 1} className="text-center py-12 text-muted-foreground">
                        No projects or schedule data to display
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sidebar — GC/MOA see sub-grouped sidebar; Subs see their own roster */}
          {canActOnRequests && ((viewMode === 'gc' || viewMode === 'moa' || connectedSubs.length > 1) ? (
            <MatrixSubSidebar
              connectedSubs={connectedSubs}
              allEmployees={allEmployees}
              availabilities={availabilities}
              scheduledEntries={scheduledEntries}
              projects={projects}
              selectedDate={effectiveSelectedDate}
              visibleDateStrings={visibleDateStrings}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
              singleProjectMode={singleProjectMode}
              selectedProjectId={singleProjectMode ? projects[0]?.id : undefined}
              enableDrag={isGcMode}
              crossGcBookings={crossGcBookings}
              sameGcOtherProjectMap={sameGcOtherProjectMap}
              selectedChipIds={selectedChipIds}
              onToggleChipSelect={toggleChipSelection}
              scheduledStopKeys={scheduledStopKeys.perStop}
              fullyScheduledEmpDates={scheduledStopKeys.allStopsByEmpDate}
            />
          ) : (
            <MatrixSidebar
              employees={employees}
              effectiveScheduledIds={effectiveScheduledIds}
              scheduledEntries={scheduledEntries}
              selectedDate={effectiveSelectedDate}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
              onCopySchedule={() => handleCopySchedule(effectiveSelectedDate || visibleDateStrings[0])}
              copiedDate={copiedSchedule?.sourceDate || null}
              onClearCopy={() => setCopiedSchedule(null)}
              availabilities={availabilities}
              visibleDateStrings={visibleDateStrings}
              scheduledStopKeys={scheduledStopKeys.perStop}
              fullyScheduledEmpDates={scheduledStopKeys.allStopsByEmpDate}
              singleProjectMode={singleProjectMode}
              assignedEmployeeIds={singleProjectMode && projects[0] && employeeProjectAssignments
                ? new Set(
                    Array.from(employeeProjectAssignments.entries())
                      .filter(([, projSet]) => projSet.has(projects[0].id))
                      .map(([empId]) => empId)
                  )
                : undefined}
              selectedProjectId={singleProjectMode ? projects[0]?.id ?? null : null}
              selectedChipIds={selectedChipIds}
              onToggleChipSelect={toggleChipSelection}
            />
          ))}
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeEmployee && (
            <div className="relative">
              <MatrixEmployeeCard
                employee={activeEmployee}
                density="compact"
                draggable={false}
                timeLabel={activeDragTimeLabel}
                stopLabel={activeDragStopLabel}
              />
              {activeDragCount > 1 && (
                <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center shadow-md">
                  {activeDragCount}
                </span>
              )}
            </div>
          )}
        </DragOverlay>

        {canActOnRequests && <MatrixDraftBar changes={draftChanges} onRevert={handleRevert} onPublish={handlePublish} isPublishing={isPublishing} mode={isGcMode ? 'gc' : 'sub'} />}

      </DndContext>

      {sharedDialogs}
    </TooltipProvider>
  );
};

export default ResourceMatrix;
