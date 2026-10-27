/**
 * Weekly schedule (Luke's Weekly view; docs/WEEKLY_VIEW_REBUILD.md). Projects are rows and days are
 * columns. People come from the side panel: drag a card onto a project's day to place them, drag it to
 * another cell to move it, or back to the panel (or ✕) to take it off. Nothing is sent until Publish:
 * the bottom bar counts unsaved changes, and Publish runs Luke's steps (unassigned exception, notify
 * choice) before one batch call to the server.
 *
 * Sub: places its own crew, which is confirmed straight away (the GC sees it as "Edited").
 * GC: places connected subs' crews, which become requests the sub confirms.
 * Phone: no dragging; tap a person, then tap a project.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Loader2, UserPlus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileTabBar from "@/components/dashboard/MobileTabBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { fmtTime } from "@/lib/timeWindows";
import { matrixApi, mockMatrix, mockSendBatch, type BatchBody, type BatchResult, type MatrixData, type NotifyChoice } from "@/lib/matrixApi";
import EmployeeCard from "@/components/matrix/EmployeeCard";
import MatrixGrid from "@/components/matrix/MatrixGrid";
import SubSidebar from "@/components/matrix/SubSidebar";
import { DAY_COL, PROJECT_COL, cardDragId, densityFor, slotDragId } from "@/components/matrix/helpers";
import DraftBar from "@/components/matrix/DraftBar";
import UnassignedDialog from "@/components/matrix/UnassignedDialog";
import NotifyDialog from "@/components/matrix/NotifyDialog";
import GCNotifyDialog from "@/components/matrix/GCNotifyDialog";
import { applyDrop, applyRemove, dayLabel, isLockedDate, type DragSource, type DropTarget } from "@/components/matrix/canDrop";
import { buildModel, cellKey, toBatch, useMatrixDrafts, type Placement } from "@/components/matrix/useMatrixDrafts";
import { dateLocale } from "@/i18n/runtime";

// Sliding range: start two weeks back, extend four weeks at a time at either end, at most about a year.
const CHUNK_DAYS = 28;
const MAX_DAYS = 364;
const COLLAPSED_KEY = "ssaa.matrix.collapsed";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const mondayOf = (d: Date) => {
  const m = new Date(d);
  m.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
  return iso(m);
};

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function ResourceMatrix() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  // ?mock=gc|sub shows demo data without a server (for building and screenshots).
  const mock = params.get("mock") === "gc" || params.get("mock") === "sub" ? (params.get("mock") as "gc" | "sub") : null;
  const companyId = user?.companyId ?? null;

  const [rangeStart, setRangeStart] = useState(() => addDays(mondayOf(new Date()), -14));
  const [rangeDays, setRangeDays] = useState(56);
  // Which loaded days are on screen (for the title), and scroll bookkeeping for sliding.
  const [visible, setVisible] = useState<{ first: number; last: number } | null>(null);
  const extending = useRef(false);
  const shiftAfterPrepend = useRef(0);
  const scrolledToToday = useRef(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [allProjects, setAllProjects] = useState<MatrixData["projects"]>([]);
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { drafts, setDrafts, revert } = useMatrixDrafts();
  const [selectedDate, setSelectedDate] = useState(() => iso(new Date()));
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(readCollapsed);
  const [overlay, setOverlay] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState<{ date: string; items: { employeeId: string; projectId: string; start: string | null; end: string | null }[] } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [unassignedAsk, setUnassignedAsk] = useState<BatchResult["unassigned"] | null>(null);
  const [notifyStep, setNotifyStep] = useState<"sub" | "gc" | null>(null);
  const allowUnassigned = useRef(false);
  const [dragging, setDragging] = useState<{ name: string; time?: string; count: number } | null>(null);
  // Edge scrolling while dragging: our own, so the grid scrolls only while the pointer is inside it near
  // the left/right edge (the library's version kept scrolling while the pointer was over the side panel).
  const edgeSpeed = useRef(0);
  const edgeLoop = useRef<number | null>(null);
  const stopEdgeScroll = () => {
    edgeSpeed.current = 0;
    if (edgeLoop.current !== null) cancelAnimationFrame(edgeLoop.current);
    edgeLoop.current = null;
  };
  useEffect(() => stopEdgeScroll, []);
  // The real pointer position (the drag library's delta shifts as the grid scrolls, so it can't be used).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track, { passive: true });
    // No text selection mid-drag (it makes the browser scroll the grid on its own).
    const before = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.getSelection()?.removeAllRanges();
    return () => {
      window.removeEventListener("pointermove", track);
      document.body.style.userSelect = before;
    };
  }, [dragging]);
  // Phone: the person picked up (tap) and waiting for a project tap.
  const [picked, setPicked] = useState<{ source: DragSource; name: string; key: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dayStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dayStrip.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedDate, data]);

  const load = useCallback(async () => {
    try {
      const next = mock
        ? (() => {
            const m = mockMatrix(rangeStart, rangeDays, mock);
            return projectFilter ? { ...m, projects: m.projects.filter((p) => p.id === projectFilter) } : m;
          })()
        : await matrixApi.load({ start: rangeStart, days: rangeDays, projectId: projectFilter || undefined });
      setData(next);
      if (!projectFilter) setAllProjects(next.projects);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the schedule.");
    } finally {
      setLoading(false);
    }
  }, [mock, rangeStart, rangeDays, projectFilter]);

  useEffect(() => {
    if (companyId || mock) void load();
  }, [companyId, mock, load]);

  // Live: when the other side confirms, declines or posts hours, refresh (unsent drafts stay).
  useEffect(() => {
    if (!companyId || mock) return;
    const channel = supabase
      .channel(`company:${companyId}:weekly`)
      .on(EVENT.availabilityChanged, () => void load())
      .on(EVENT.scheduleRequestCreated, () => void load())
      .on(EVENT.scheduleRequestUpdated, () => void load())
      .subscribe();
    return () => channel.unsubscribe();
  }, [companyId, mock, load]);

  const days = useMemo(() => data?.days ?? [], [data]);
  useEffect(() => {
    if (days.length && !days.includes(selectedDate)) setSelectedDate(days.includes(iso(new Date())) ? iso(new Date()) : days[0]);
  }, [days, selectedDate]);

  const model = useMemo(() => (data ? buildModel(data, drafts) : null), [data, drafts]);
  const canDrag = !!data?.viewer.canSchedule;
  const isGc = data?.viewer.companyType === "gc";

  // Everything draggable, by drag id, so a multi-select drag can move them all.
  const sources = useMemo(() => {
    const map = new Map<string, { source: DragSource; name: string; time?: string }>();
    if (!data || !model) return map;
    for (const p of model.placements) {
      map.set(cardDragId(p), {
        source: { kind: "card", placement: p },
        name: model.employees.get(p.employeeId)?.name ?? "",
        time: p.start && p.end ? `${fmtTime(p.start)} – ${fmtTime(p.end)}` : undefined,
      });
    }
    for (const crew of data.crews) {
      for (const e of crew.employees) {
        for (const slot of model.freeSlots(e.id, selectedDate)) {
          map.set(slotDragId(slot), { source: { kind: "side", slot }, name: e.name, time: `${fmtTime(slot.start)} – ${fmtTime(slot.end)}` });
        }
      }
    }
    return map;
  }, [data, model, selectedDate]);

  // ---------- placing, moving, removing ----------

  const placeAll = (list: DragSource[], target: DropTarget) => {
    if (!data) return false;
    let next = drafts;
    const reasons: string[] = [];
    let placed = 0;
    for (const source of list) {
      const result = applyDrop(data, next, source, target);
      if (result.ok) {
        next = result.drafts;
        placed++;
      } else if (result.reason) reasons.push(result.reason);
    }
    setDrafts(next);
    if (reasons.length) {
      toast({
        title: placed ? `${placed} placed, ${reasons.length} couldn't go there` : "Can't place here",
        description: reasons.join(" "),
        variant: placed ? undefined : "destructive",
      });
    }
    return placed > 0;
  };

  const removeCard = (placement: Placement) => {
    const result = applyRemove(drafts, placement);
    if (result.ok) setDrafts(result.drafts);
    else if (result.reason) toast({ title: "Can't remove", description: result.reason, variant: "destructive" });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const groupFor = (activeId: string) =>
    selection.has(activeId) && selection.size > 1 ? [...selection].filter((id) => sources.has(id)) : [activeId];

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const entry = sources.get(id);
    setDragging(entry ? { name: entry.name, time: entry.time, count: groupFor(id).length } : null);
  };
  const onDragMove = (e: DragMoveEvent) => {
    const start = e.activatorEvent as PointerEvent;
    const el = document.getElementById("matrix-grid-scroll");
    if (!el) return;
    const grid = el.getBoundingClientRect();
    const { x, y } = pointer.current ?? { x: start.clientX + e.delta.x, y: start.clientY + e.delta.y };
    const inside = x >= grid.left && x <= grid.right && y >= grid.top && y <= grid.bottom;
    const EDGE = 56;
    const firstDayLeft = grid.left + PROJECT_COL; // the sticky project column covers the left edge
    edgeSpeed.current = !inside ? 0 : x > grid.right - EDGE ? 14 : x < firstDayLeft + EDGE && x > firstDayLeft - 20 ? -14 : 0;
    if (edgeSpeed.current !== 0 && edgeLoop.current === null) {
      const tick = () => {
        // Re-check against the live pointer each frame, so scrolling stops the moment it leaves the edge.
        const at = pointer.current;
        const r = el.getBoundingClientRect();
        if (at && (at.x < r.left || at.x > r.right || at.y < r.top || at.y > r.bottom)) edgeSpeed.current = 0;
        if (edgeSpeed.current === 0) {
          edgeLoop.current = null;
          return;
        }
        el.scrollLeft += edgeSpeed.current;
        edgeLoop.current = requestAnimationFrame(tick);
      };
      edgeLoop.current = requestAnimationFrame(tick);
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    stopEdgeScroll();
    pointer.current = null;
    const id = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const list = groupFor(id)
      .map((x) => sources.get(x)?.source)
      .filter((s): s is DragSource => !!s);
    if (!overId || list.length === 0) return; // dropped nowhere: the card snaps back
    if (overId === "sidebar-drop") {
      let next = drafts;
      for (const s of list) {
        if (s.kind !== "card") continue;
        const r = applyRemove(next, s.placement);
        if (r.ok) next = r.drafts;
        else if (r.reason) toast({ title: "Can't remove", description: r.reason, variant: "destructive" });
      }
      setDrafts(next);
      setSelection(new Set());
      return;
    }
    const [, projectId, date] = overId.split("::");
    if (projectId && date && placeAll(list, { projectId, date })) setSelection(new Set());
  };

  const toggleSelect = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---------- copy a day / paste it on another ----------

  const copyDay = () => {
    if (!model) return;
    const items = model.placements
      .filter((p) => p.date === selectedDate)
      .map((p) => ({ employeeId: p.employeeId, projectId: p.projectId, start: p.start, end: p.end }));
    if (items.length === 0) {
      toast({ title: "Nothing to copy", description: `No one is scheduled on ${dayLabel(selectedDate)}.` });
      return;
    }
    setCopied({ date: selectedDate, items });
    toast({ title: "Schedule copied", description: `Copied schedule from ${dayLabel(selectedDate)}. Click a day header to paste.` });
  };

  const pasteDay = (date: string) => {
    if (!data || !copied) return;
    if (date === copied.date) {
      setSelectedDate(date);
      return;
    }
    let next = drafts;
    const reasons: string[] = [];
    let placed = 0;
    for (const item of copied.items) {
      const r = applyDrop(data, next, { kind: "copy", employeeId: item.employeeId, start: item.start, end: item.end }, { projectId: item.projectId, date });
      if (r.ok) {
        next = r.drafts;
        placed++;
      } else if (r.reason) reasons.push(r.reason);
    }
    setDrafts(next);
    setSelectedDate(date);
    toast({
      title: `Pasted to ${dayLabel(date)}`,
      description: `${placed} placed${reasons.length ? `, ${reasons.length} skipped: ${reasons.join(" ")}` : "."} Review and publish.`,
    });
  };

  const onDayClick = (date: string) => (copied ? pasteDay(date) : setSelectedDate(date));

  // ---------- publish ----------

  const send = (body: BatchBody) => (mock && data ? Promise.resolve(mockSendBatch(data, body)) : matrixApi.sendBatch(body));

  const startPublish = async () => {
    if (!data || drafts.length === 0) return;
    allowUnassigned.current = false;
    setPublishing(true);
    try {
      const { body } = toBatch(data, drafts);
      const dry = await send({ ...body, dryRun: true });
      if (!isGc && dry.unassigned.length > 0) {
        if (!data.viewer.canMakeException) {
          toast({
            title: "Permission required",
            description:
              "You do not have permission to assign employees to projects they are not assigned to. Ask an admin to update assignments in Manage Team Profiles.",
            variant: "destructive",
          });
          return;
        }
        setUnassignedAsk(dry.unassigned);
        return;
      }
      setNotifyStep(isGc ? "gc" : "sub");
    } catch (err) {
      toast({ title: "Couldn't check the changes", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const finishPublish = async (notify: NotifyChoice) => {
    if (!data) return;
    setNotifyStep(null);
    setPublishing(true);
    try {
      const { body, createDrafts, updateDrafts } = toBatch(data, drafts);
      const res = await send({ ...body, allowUnassigned: allowUnassigned.current, notify });
      // Anything the server refused stays as a draft so it can be fixed; the rest is done.
      const keep = new Set<string>();
      for (const s of res.skipped) for (const id of (s.kind === "create" ? createDrafts : updateDrafts)[s.index] ?? []) keep.add(id);
      setDrafts((prev) => prev.filter((d) => keep.has(d.id)));
      const saved = drafts.length - keep.size;
      toast({
        title: isGc ? "Requests sent" : "Schedule published",
        description: [
          `${saved} change${saved === 1 ? "" : "s"} saved.`,
          res.skipped.length ? `${res.skipped.length} skipped: ${res.skipped.map((s) => s.reason).join(" ")}` : "",
          (notify.gcEmail || notify.personnelEmail) && !res.notified.email ? "Email isn't set up yet, so only in-app notifications were sent." : "",
        ]
          .filter(Boolean)
          .join(" "),
        variant: res.skipped.length && !saved ? "destructive" : undefined,
      });
      await load();
    } catch (err) {
      toast({ title: "Publish failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const gcSummary = useMemo(() => {
    if (!data || !model) return { subs: [] as string[], count: 0, range: null as string | null };
    const places = drafts.filter((d) => d.kind === "place");
    const subs = [...new Set(places.map((d) => (d.kind === "place" ? model.employees.get(d.employeeId)?.companyName ?? "" : "")))].filter(Boolean);
    const dates = places.map((d) => (d.kind === "place" ? d.date : "")).sort();
    const range = dates.length ? (dates[0] === dates[dates.length - 1] ? dayLabel(dates[0]) : `${dayLabel(dates[0])} – ${dayLabel(dates[dates.length - 1])}`) : null;
    return { subs, count: places.length, range };
  }, [data, model, drafts]);

  // ---------- page ----------

  const toggleProject = (id: string) =>
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage blocked: still works for this visit */
      }
      return next;
    });

  // ---------- sliding through weeks ----------

  const gridEl = () => document.getElementById("matrix-grid-scroll") as HTMLDivElement | null;
  const firstOfWeek = (date: string) => Math.max(0, days.indexOf(mondayOf(new Date(`${date}T00:00:00`))));

  // After weeks are added on the left, keep the same days under the user's eyes.
  useLayoutEffect(() => {
    const el = gridEl();
    if (el && shiftAfterPrepend.current) {
      el.scrollLeft += shiftAfterPrepend.current;
      shiftAfterPrepend.current = 0;
    }
    extending.current = false;
    // First load: open on this week.
    if (el && days.length && !scrolledToToday.current) {
      el.scrollLeft = firstOfWeek(iso(new Date())) * DAY_COL;
      scrolledToToday.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const onGridScroll = (el: HTMLDivElement) => {
    const first = Math.floor(el.scrollLeft / DAY_COL);
    const span = Math.max(1, Math.floor((el.clientWidth - PROJECT_COL) / DAY_COL));
    setVisible((v) => (v && v.first === first && v.last === first + span - 1 ? v : { first, last: first + span - 1 }));
    // Never reload under a card being dragged: its drop targets would move.
    if (extending.current || dragging) return;
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 3 * DAY_COL && rangeDays < MAX_DAYS) {
      extending.current = true;
      setRangeDays((n) => Math.min(MAX_DAYS, n + CHUNK_DAYS));
    } else if (el.scrollLeft < 2 * DAY_COL && rangeDays < MAX_DAYS) {
      extending.current = true;
      shiftAfterPrepend.current = CHUNK_DAYS * DAY_COL;
      setRangeStart((s) => addDays(s, -CHUNK_DAYS));
      setRangeDays((n) => n + CHUNK_DAYS);
    }
  };

  const slideWeeks = (n: number) => gridEl()?.scrollBy({ left: n * 7 * DAY_COL, behavior: "smooth" });
  const goToday = () => {
    const today = iso(new Date());
    setSelectedDate(today);
    if (isMobile) return;
    gridEl()?.scrollTo({ left: firstOfWeek(today) * DAY_COL, behavior: "smooth" });
  };
  // Phone: the arrows move the selected day a week at a time, loading more weeks when needed.
  const stepDay = (n: number) => {
    const next = addDays(selectedDate, n);
    if (next < rangeStart) {
      setRangeStart((s) => addDays(s, -CHUNK_DAYS));
      setRangeDays((d) => d + CHUNK_DAYS);
    } else if (next > addDays(rangeStart, rangeDays - 1)) setRangeDays((d) => Math.min(MAX_DAYS, d + CHUNK_DAYS));
    setSelectedDate(next);
  };

  const shown =
    !isMobile && visible
      ? days.slice(visible.first, visible.last + 1)
      : days.slice(firstOfWeek(selectedDate), firstOfWeek(selectedDate) + 7);
  const fmtDay = (d: string, year = false) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(dateLocale(), { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  const weekLabel = shown.length ? `${fmtDay(shown[0])} – ${fmtDay(shown[shown.length - 1], true)}` : "";

  if (!companyId && !mock) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="mx-auto max-w-5xl p-4">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">Join a company before using the weekly schedule.</CardContent>
          </Card>
        </main>
        <MobileTabBar />
      </div>
    );
  }

  const weekArrows = (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Previous week" onClick={() => (isMobile ? stepDay(-7) : slideWeeks(-1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" className="h-9" onClick={goToday}>
        Today
      </Button>
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next week" onClick={() => (isMobile ? stepDay(7) : slideWeeks(1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  // Phone: title and arrows share the first row, the project picker gets the full width below.
  const toolbar = (
    <div className="border-b bg-card">
      <div className="space-y-2 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Weekly Schedule</h1>
            <p className="truncate text-sm text-muted-foreground">{weekLabel}</p>
          </div>
          <div className="sm:hidden">{weekArrows}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm sm:h-9 sm:w-auto sm:max-w-[220px]"
            aria-label="Project"
          >
            <option value="">Master Schedule (all projects)</option>
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="hidden sm:block">{weekArrows}</div>
        </div>
      </div>
    </div>
  );

  const dialogs = (
    <>
      <UnassignedDialog
        open={!!unassignedAsk}
        pairs={unassignedAsk ?? []}
        onCancel={() => setUnassignedAsk(null)}
        onConfirm={() => {
          allowUnassigned.current = true;
          setUnassignedAsk(null);
          setNotifyStep("sub");
        }}
      />
      <NotifyDialog open={notifyStep === "sub"} onCancel={() => setNotifyStep(null)} onConfirm={(c) => void finishPublish(c)} />
      <GCNotifyDialog
        open={notifyStep === "gc"}
        subNames={gcSummary.subs}
        count={gcSummary.count}
        dateRange={gcSummary.range}
        onCancel={() => setNotifyStep(null)}
        onChoose={(c) => void finishPublish(c)}
      />
      {canDrag && (
        <DraftBar count={drafts.length} mode={isGc ? "gc" : "sub"} publishing={publishing} onRevert={revert} onPublish={() => void startPublish()} />
      )}
    </>
  );

  const body =
    loading && !data ? (
      <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading schedule…
      </div>
    ) : loadError && !data ? (
      <div className="p-4">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span className="text-destructive">{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    ) : null;

  // ---------- phone ----------
  if (isMobile) {
    const pick = (source: DragSource, name: string, key: string) => {
      setPicked((cur) => (cur?.key === key ? null : { source, name, key }));
      setSheetOpen(false);
    };
    const weekDays = days;
    return (
      <TooltipProvider>
        <div className="flex min-h-dvh flex-col bg-background pb-36">
          <DashboardHeader />
          {toolbar}
          {body ?? (
            data &&
            model && (
              <main className="space-y-3 p-3">
                <div ref={dayStrip} className="-mx-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-1" role="tablist" aria-label="Day">
                  {weekDays.map((d, i) => {
                    const date = new Date(`${d}T00:00:00`);
                    const active = d === selectedDate;
                    const busy = model.placements.some((p) => p.date === d);
                    const showMonth = i === 0 || date.getDate() === 1;
                    return (
                      <button
                        key={d}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onDayClick(d)}
                        className={`relative flex w-12 shrink-0 snap-center flex-col items-center rounded-lg border py-1.5 text-xs ${
                          active ? "border-primary bg-primary text-primary-foreground" : isLockedDate(d) ? "bg-muted/40 text-muted-foreground" : "bg-card"
                        } ${copied && !active ? "border-dashed border-primary" : ""}`}
                      >
                        <span className="text-[10px] font-semibold uppercase leading-none opacity-70">
                          {showMonth ? date.toLocaleDateString(dateLocale(), { month: "short" }) : "\u00a0"}
                        </span>
                        <span>{date.toLocaleDateString(dateLocale(), { weekday: "short" })}</span>
                        <span className="text-base font-semibold leading-tight">{date.getDate()}</span>
                        <span className={`mt-0.5 h-1 w-1 rounded-full ${busy ? (active ? "bg-primary-foreground" : "bg-primary") : "bg-transparent"}`} />
                      </button>
                    );
                  })}
                </div>

                {picked ? (
                  <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/10 p-2 text-sm">
                    <span className="flex-1">
                      Tap a project to place <strong>{picked.name}</strong>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  canDrag && (
                    <Button className="w-full" variant="outline" onClick={() => setSheetOpen(true)}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add people
                    </Button>
                  )
                )}

                {data.projects.map((project) => {
                  const list = model.byCell.get(cellKey(project.id, selectedDate)) ?? [];
                  const locked = isLockedDate(selectedDate);
                  return (
                    <section
                      key={project.id}
                      data-project-row={project.name}
                      onClick={() => {
                        if (!picked || locked) return;
                        if (placeAll([picked.source], { projectId: project.id, date: selectedDate })) setPicked(null);
                      }}
                      className={`rounded-lg border bg-card ${list.length === 0 && !picked ? "px-3 py-2" : "p-3"} ${
                        picked && !locked ? "cursor-pointer ring-2 ring-primary/40" : ""
                      }`}
                    >
                      <div className={`flex items-baseline justify-between gap-2 ${list.length === 0 && !picked ? "" : "mb-2"}`}>
                        <h2 className={`truncate text-sm ${list.length ? "font-semibold" : "font-medium text-muted-foreground"}`}>{project.name}</h2>
                        <span className="shrink-0 text-xs text-muted-foreground">{list.length ? `${list.length} scheduled` : "No one"}</span>
                      </div>
                      {list.length === 0 ? (
                        picked ? <p className="text-xs italic text-primary">Tap to place here</p> : null
                      ) : (
                        <div className="flex flex-col gap-1">
                          {list.map((p) => {
                            const emp = model.employees.get(p.employeeId);
                            return (
                              <div key={p.key} onClick={(e) => e.stopPropagation()}>
                                <EmployeeCard
                                  name={emp?.name ?? ""}
                                  jobTitle={emp?.jobTitle}
                                  density={densityFor(Math.min(list.length, 6))}
                                  look={p.status}
                                  timeLabel={p.start && p.end ? `${fmtTime(p.start)} – ${fmtTime(p.end)}` : undefined}
                                  stopLabel={p.stopLabel}
                                  unassigned={p.unassigned}
                                  edited={p.edited}
                                  tag={isGc && p.assignedBySub ? (emp?.companyName ?? "Sub") : isGc ? emp?.companyName : undefined}
                                  selected={picked?.key === cardDragId(p)}
                                  onTap={canDrag && !locked ? () => pick({ kind: "card", placement: p }, emp?.name ?? "", cardDragId(p)) : undefined}
                                  onRemove={canDrag && !locked ? () => removeCard(p) : undefined}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
                {data.projects.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No projects to schedule yet.</p>}
              </main>
            )
          )}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="flex h-[80dvh] flex-col p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Add people</SheetTitle>
              </SheetHeader>
              {data && model && (
                <SubSidebar
                  data={data}
                  model={model}
                  selectedDate={selectedDate}
                  onStepDate={(n) => setSelectedDate(addDays(selectedDate, n))}
                  collapsed={false}
                  onToggleCollapse={() => setSheetOpen(false)}
                  copiedDate={copied?.date ?? null}
                  onCopy={copyDay}
                  onClearCopy={() => setCopied(null)}
                  canDrag={canDrag}
                  selection={selection}
                  onToggleSelect={toggleSelect}
                  onPickSlot={(slot) => pick({ kind: "side", slot }, model.employees.get(slot.employeeId)?.name ?? "", slotDragId(slot))}
                  pickedKey={picked?.key}
                  className="h-full w-full border-l-0"
                />
              )}
            </SheetContent>
          </Sheet>
          {dialogs}
          <MobileTabBar />
        </div>
      </TooltipProvider>
    );
  }

  // ---------- desktop ----------
  return (
    <TooltipProvider>
      {/* overflow-clip, not hidden: a hidden frame can still be scrolled by focus, which slid the page sideways. */}
      <div className="flex h-dvh flex-col overflow-clip bg-background">
        <DashboardHeader />
        {toolbar}
        {body ??
          (data && model && (
            <DndContext
              sensors={canDrag ? sensors : []}
              collisionDetection={pointerWithin}
              autoScroll={false}
              // Cells move when the grid edge-scrolls mid-drag, so keep their positions fresh.
              measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                setDragging(null);
                stopEdgeScroll();
              }}
            >
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  {copied && (
                    <div className="flex items-center gap-2 border-b bg-primary/10 px-4 py-1.5 text-sm text-primary">
                      Pasting {dayLabel(copied.date)}: click a day header to paste it there.
                      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setCopied(null)}>
                        <X className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  )}
                  <MatrixGrid
                    data={data}
                    model={model}
                    days={days}
                    selectedDate={selectedDate}
                    onDayClick={onDayClick}
                    copying={!!copied}
                    collapsedProjects={collapsedProjects}
                    onToggleProject={toggleProject}
                    overlay={overlay}
                    onToggleOverlay={setOverlay}
                    canDrag={canDrag}
                    selection={selection}
                    onToggleSelect={toggleSelect}
                    onRemove={removeCard}
                    onScroll={onGridScroll}
                  />
                </div>
                <SubSidebar
                  data={data}
                  model={model}
                  selectedDate={selectedDate}
                  onStepDate={(n) => setSelectedDate(addDays(selectedDate, n))}
                  collapsed={sidebarCollapsed}
                  onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
                  copiedDate={copied?.date ?? null}
                  onCopy={copyDay}
                  onClearCopy={() => setCopied(null)}
                  canDrag={canDrag}
                  selection={selection}
                  onToggleSelect={toggleSelect}
                />
              </div>
              <DragOverlay>
                {dragging && (
                  <div className="relative w-56">
                    <EmployeeCard name={dragging.name} density="compact" look="draft" timeLabel={dragging.time} />
                    {dragging.count > 1 && (
                      <span className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-md">
                        {dragging.count}
                      </span>
                    )}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          ))}
        {dialogs}
        <MobileTabBar />
      </div>
    </TooltipProvider>
  );
}
