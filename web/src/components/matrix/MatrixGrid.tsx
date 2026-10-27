import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtTime } from "@/lib/timeWindows";
import type { MatrixData } from "@/lib/matrixApi";
import EmployeeCard from "./EmployeeCard";
import { DAY_COL, PROJECT_COL, cardDragId, densityFor } from "./helpers";
import { isLockedDate } from "./canDrop";
import { cellKey, type MatrixModel, type Placement } from "./useMatrixDrafts";
import { dateLocale } from "@/i18n/runtime";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Projects down the side, days across the top (O5), from the desktop table in Luke's ResourceMatrix.
 * Each project/day cell is a drop target; clicking a day header selects that day for the side panel
 * (or pastes a copied day there).
 */

interface Props {
  data: MatrixData;
  model: MatrixModel;
  days: string[];
  selectedDate: string;
  onDayClick: (date: string) => void;
  copying: boolean;
  collapsedProjects: Set<string>;
  onToggleProject: (projectId: string) => void;
  overlay: boolean;
  onToggleOverlay: (on: boolean) => void;
  canDrag: boolean;
  selection: Set<string>;
  onToggleSelect: (dragId: string) => void;
  onRemove: (placement: Placement) => void;
  /** Every scroll, so the page can update the week title and load more weeks at either end. */
  onScroll: (el: HTMLDivElement) => void;
}

const COL = DAY_COL;

const weekdayOf = (date: string) => new Date(`${date}T00:00:00`).getDay();
const headerParts = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return {
    weekday: d.toLocaleDateString(dateLocale(), { weekday: "short" }),
    day: d.toLocaleDateString(dateLocale(), { month: "short", day: "numeric" }),
  };
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function DropCell({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      data-cell={id}
      className={`min-h-[72px] p-1 transition-colors ${isOver ? "bg-primary/15 ring-2 ring-inset ring-primary/40" : ""}`}
    >
      {children}
    </div>
  );
}

export default function MatrixGrid({
  data,
  model,
  days,
  selectedDate,
  onDayClick,
  copying,
  collapsedProjects,
  onToggleProject,
  overlay,
  onToggleOverlay,
  canDrag,
  selection,
  onToggleSelect,
  onRemove,
  onScroll,
}: Props) {
  const { t } = useLanguage();
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  // Slide through weeks with a normal mouse wheel too: when the grid has nothing to scroll vertically,
  // turn vertical wheel movement into sideways movement. (Native listener: React's wheel events are passive.)
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      // Over the day headers the wheel always slides; elsewhere only when there's nothing to scroll down.
      const overHeader = (e.target as Element | null)?.closest?.("thead");
      if (!overHeader && el.scrollHeight > el.clientHeight + 1) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    // Grab an empty part of the grid and drag to slide through the weeks (like panning a map). Cards,
    // buttons and inputs keep their own behaviour.
    let pan: { x: number; left: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest("[data-card], button, input, select, label, a")) return;
      pan = { x: e.clientX, left: el.scrollLeft, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!pan) return;
      const dx = e.clientX - pan.x;
      if (!pan.moved && Math.abs(dx) < 6) return;
      if (!pan.moved) {
        pan.moved = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      el.scrollLeft = pan.left - dx;
    };
    const onUp = () => {
      if (pan?.moved) {
        // Swallow the click that ends a slide, so it doesn't also select a day.
        const stop = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", stop, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", stop, { capture: true }), 0);
      }
      pan = null;
      el.style.cursor = "";
      el.style.userSelect = "";
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  const isGc = data.viewer.companyType === "gc";
  const today = todayIso();
  const crewName = new Map(data.crews.map((c) => [c.companyId, c.companyName]));

  const card = (p: Placement, count: number) => {
    const emp = model.employees.get(p.employeeId);
    const id = cardDragId(p);
    const locked = isLockedDate(p.date);
    return (
      <EmployeeCard
        key={p.key}
        name={emp?.name ?? t("matrixGrid.unknown")}
        jobTitle={emp?.jobTitle}
        density={densityFor(count)}
        look={p.status}
        timeLabel={p.start && p.end ? `${fmtTime(p.start)} – ${fmtTime(p.end)}` : undefined}
        stopLabel={p.stopLabel}
        unassigned={p.unassigned}
        edited={p.edited}
        tag={isGc && p.assignedBySub ? "Sub" : undefined}
        dragId={id}
        dragData={{ kind: "card", placement: p }}
        draggable={canDrag && !locked}
        selected={selection.has(id)}
        onToggleSelect={canDrag && !locked ? () => onToggleSelect(id) : undefined}
        onRemove={canDrag && !locked ? () => onRemove(p) : undefined}
      />
    );
  };

  const cellBody = (list: Placement[]) => {
    const minimal = densityFor(list.length) === "minimal";
    const wrap = `flex gap-0.5 ${minimal ? "flex-row flex-wrap" : "flex-col"}`;
    if (!isGc) return <div className={wrap}>{list.map((p) => card(p, list.length))}</div>;
    // GC: group by subcontractor so it's clear who sent whom.
    const bySub = new Map<string, Placement[]>();
    for (const p of list) bySub.set(p.subCompanyId, [...(bySub.get(p.subCompanyId) ?? []), p]);
    return (
      <div className="flex flex-col gap-1">
        {[...bySub.entries()].map(([subId, items]) => {
          const closed = collapsedSubs.has(subId);
          return (
            <div key={subId} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() =>
                  setCollapsedSubs((prev) => {
                    const next = new Set(prev);
                    if (next.has(subId)) next.delete(subId);
                    else next.add(subId);
                    return next;
                  })
                }
                className="flex w-full items-center gap-1 px-0.5 text-left text-[9px] font-semibold uppercase text-muted-foreground hover:text-foreground"
              >
                {closed ? <ChevronRight className="h-2.5 w-2.5 shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 shrink-0" />}
                <span className="truncate">{crewName.get(subId) ?? t("common.subcontractor")}</span>
                {closed && <span className="ml-auto font-normal normal-case">({items.length})</span>}
              </button>
              {!closed && <div className={wrap}>{items.map((p) => card(p, list.length))}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={scroller} id="matrix-grid-scroll" className="relative flex-1 overflow-auto overscroll-x-contain" onScroll={(e) => onScroll(e.currentTarget)}>
      <table className="w-max min-w-full border-collapse">
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              className="sticky left-0 z-30 border bg-muted px-3 py-2 text-left text-xs font-semibold text-muted-foreground"
              style={{ minWidth: PROJECT_COL, width: PROJECT_COL, maxWidth: PROJECT_COL }}
            >
              <div className="flex flex-col gap-1">
                <span>{t("common.projects")}</span>
                <label className="flex cursor-pointer items-center gap-1 text-[10px] font-normal">
                  <Checkbox checked={overlay} onCheckedChange={(v) => onToggleOverlay(!!v)} className="h-3 w-3" aria-label={t("matrixGrid.scheduleOverlay")} />
                  
                  {t("matrixGrid.scheduleOverlay")}
                </label>
              </div>
            </th>
            {days.map((date) => {
              const { weekday, day } = headerParts(date);
              const wd = weekdayOf(date);
              const selected = date === selectedDate;
              const locked = isLockedDate(date);
              return (
                <th
                  key={date}
                  onClick={() => onDayClick(date)}
                  style={{ minWidth: COL, width: COL }}
                  data-day-header={date}
                  aria-selected={selected}
                  title={copying ? t("matrixGrid.pasteTheCopiedScheduleHere") : t("matrixGrid.showThisDayInTheSide")}
                  className={`cursor-pointer select-none border px-2 py-2 text-center text-xs font-medium transition-colors hover:bg-primary/15 ${
                    selected
                      ? "bg-primary/20 text-primary ring-2 ring-inset ring-primary/40"
                      : date === today
                        ? "bg-primary/10 text-primary"
                        : wd === 0 || wd === 6
                          ? "bg-muted/50 text-muted-foreground"
                          : "bg-muted text-muted-foreground"
                  } ${copying ? "outline-dashed outline-1 -outline-offset-4 outline-primary/50" : ""}`}
                >
                  <div className="flex items-center justify-center gap-1 font-semibold">
                    {locked && <Lock className="h-3 w-3" aria-label={t("matrixGrid.locked")} />}
                    {weekday}
                  </div>
                  <div className="text-[10px]">{day}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.projects.map((project) => {
            const closed = collapsedProjects.has(project.id);
            const tasks = data.tasks.filter((t) => t.projectId === project.id);
            return (
              <tr key={project.id} data-project-row={project.name}>
                <td
                  className="sticky left-0 z-10 border bg-card px-3 py-2 align-top text-sm font-medium"
                  style={{ minWidth: PROJECT_COL, width: PROJECT_COL, maxWidth: PROJECT_COL }}
                >
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{project.name}</p>
                      {!closed && (
                        <p className="truncate text-[10px] font-normal text-muted-foreground">
                          {data.viewer.companyType === "sub" ? project.ownerName : (project.address ?? "")}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-expanded={!closed}
                      aria-label={closed ? t("matrixGrid.expand", { name: project.name }) : t("matrixGrid.collapse", { name: project.name })}
                      onClick={() => onToggleProject(project.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {closed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </td>
                {days.map((date, i) => {
                  const wd = weekdayOf(date);
                  const shade = date === today ? "bg-primary/5" : wd === 0 || wd === 6 ? "bg-muted/20" : "";
                  const list = model.byCell.get(cellKey(project.id, date)) ?? [];
                  const locked = isLockedDate(date);
                  if (closed) {
                    return (
                      <td key={date} className={`h-6 border p-0 text-center text-[10px] text-muted-foreground ${shade}`} style={{ minWidth: COL }}>
                        {list.length > 0 ? list.length : ""}
                      </td>
                    );
                  }
                  const dayTasks = overlay ? tasks.filter((t) => t.startDate <= date && date <= t.endDate) : [];
                  return (
                    <td key={date} className={`border p-0 align-top ${shade} ${locked ? "bg-muted/40" : ""}`} style={{ minWidth: COL }}>
                      <DropCell id={`cell::${project.id}::${date}`} disabled={!canDrag || locked}>
                        {dayTasks.length > 0 && (
                          <div className="mb-1 flex flex-col gap-0.5 border-b border-border/60 pb-1">
                            {dayTasks.map((t) => {
                              const starts = t.startDate === date || i === 0;
                              const ends = t.endDate === date || i === days.length - 1;
                              return (
                                <Tooltip key={t.id}>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={`flex h-[14px] cursor-default items-center truncate px-1 text-[9px] font-medium text-white ${starts ? "rounded-l-sm" : "-ml-px"} ${ends ? "rounded-r-sm" : "-mr-px"}`}
                                      style={{ backgroundColor: t.color }}
                                    >
                                      {starts && <span className="truncate">{t.name}</span>}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {t.name} ({t.startDate} → {t.endDate})
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>
                        )}
                        {cellBody(list)}
                      </DropCell>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {data.projects.length === 0 && (
            <tr>
              <td colSpan={days.length + 1} className="py-12 text-center text-muted-foreground">
                
                {t("matrixGrid.noProjectsToScheduleYet")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
