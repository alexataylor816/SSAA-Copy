import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Building2, ChevronLeft, ChevronRight, Copy, Search, Users, X } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtTime } from "@/lib/timeWindows";
import type { MatrixData } from "@/lib/matrixApi";
import EmployeeCard from "./EmployeeCard";
import { dayLabel } from "./canDrop";
import { slotDragId } from "./helpers";
import type { FreeSlot, MatrixModel } from "./useMatrixDrafts";
import { useLanguage } from "@/contexts/LanguageContext";
import { jobTitleLabel } from "@/i18n/labels";

/**
 * The right-hand panel (O6), from Luke's MatrixSubSidebar (GC) and MatrixSidebar (sub): who is free on
 * the selected day, one card per free stretch of their hours, ready to drag onto the grid. Dropping a
 * grid card back here takes it off the schedule.
 */

interface Props {
  data: MatrixData;
  model: MatrixModel;
  selectedDate: string;
  onStepDate: (delta: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  copiedDate: string | null;
  onCopy: () => void;
  onClearCopy: () => void;
  canDrag: boolean;
  selection: Set<string>;
  onToggleSelect: (dragId: string) => void;
  /** Phone: tap a card to pick it up instead of dragging. */
  onPickSlot?: (slot: FreeSlot) => void;
  pickedKey?: string | null;
  className?: string;
}

export default function SubSidebar({
  data,
  model,
  selectedDate,
  onStepDate,
  collapsed,
  onToggleCollapse,
  copiedDate,
  onCopy,
  onClearCopy,
  canDrag,
  selection,
  onToggleSelect,
  onPickSlot,
  pickedKey,
  className = "",
}: Props) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [jobTitle, setJobTitle] = useState("all");
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-drop" });
  const isGc = data.viewer.companyType === "gc";

  const jobTitles = useMemo(
    () => [...new Set(data.crews.flatMap((c) => c.employees.map((e) => e.jobTitle).filter((t): t is string => !!t)))].sort(),
    [data.crews],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.crews
      .map((crew) => {
        const crewMatches = !!q && crew.companyName.toLowerCase().includes(q);
        const people = crew.employees.filter(
          (e) => (jobTitle === "all" || e.jobTitle === jobTitle) && (!q || crewMatches || e.name.toLowerCase().includes(q)),
        );
        const available = people.flatMap((e) => model.freeSlots(e.id, selectedDate).map((slot) => ({ employee: e, slot })));
        const scheduled = people
          .map((e) => {
            const here = model.placements.filter((p) => p.employeeId === e.id && p.date === selectedDate);
            const elsewhere = model.holdsOn(e.id, selectedDate).filter((h) => h.where === "with another contractor");
            return { employee: e, here, elsewhere };
          })
          .filter((s) => s.here.length > 0 || s.elsewhere.length > 0);
        return {
          crew,
          available,
          scheduled,
          availableCount: new Set(available.map((a) => a.employee.id)).size,
          scheduledCount: new Set(scheduled.map((s) => s.employee.id)).size,
          visible: !q || crewMatches || people.length > 0,
        };
      })
      .filter((g) => g.visible);
  }, [data.crews, model, selectedDate, search, jobTitle]);

  if (collapsed) {
    return (
      <div className={`flex w-10 shrink-0 flex-col items-center border-l bg-card py-4 ${className}`}>
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="mb-4" aria-label={t("subSidebar.openTheSidePanel")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {isGc ? <Building2 className="h-4 w-4 text-muted-foreground" /> : <Users className="h-4 w-4 text-muted-foreground" />}
        <span className="mt-1 rotate-180 text-xs text-muted-foreground [writing-mode:vertical-lr]">
          {isGc ? t("subSidebar.subcontractors", { length: data.crews.length }) : t("subSidebar.available")}
        </span>
      </div>
    );
  }

  const body = (g: (typeof groups)[number]) => (
    <>
      {g.scheduled.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-muted-foreground">{t("subSidebar.scheduled")}</div>
          <div className="space-y-1">
            {g.scheduled.map(({ employee, here, elsewhere }) => (
              <EmployeeCard
                key={employee.id}
                name={employee.name}
                jobTitle={employee.jobTitle}
                density="compact"
                look={here.length > 0 ? (here.some((p) => p.status === "draft") ? "draft" : here[0].status) : "unavailable"}
                timeLabel={[
                  ...here.map((p) => `${model.projectNames.get(p.projectId) ?? ""}${p.start ? ` ${fmtTime(p.start)}–${fmtTime(p.end)}` : ""}`),
                  ...elsewhere.map((h) => `Unavailable ${fmtTime(h.span.start)}–${fmtTime(h.span.end)}`),
                ].join(" · ")}
              />
            ))}
          </div>
        </div>
      )}
      {g.available.length > 0 && (
        <div>
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-muted-foreground">{t("subSidebar.available")}</div>
          <div className="space-y-1">
            {g.available.map(({ employee, slot }) => {
              const id = slotDragId(slot);
              return (
                <EmployeeCard
                  key={id}
                  name={employee.name}
                  jobTitle={employee.jobTitle}
                  density="compact"
                  look="available"
                  timeLabel={`${fmtTime(slot.start)} – ${fmtTime(slot.end)}`}
                  stopLabel={slot.stopLabel}
                  dragId={id}
                  dragData={{ kind: "side", slot }}
                  draggable={canDrag && !onPickSlot}
                  selected={onPickSlot ? pickedKey === id : selection.has(id)}
                  onToggleSelect={canDrag ? () => onToggleSelect(id) : undefined}
                  onTap={onPickSlot && canDrag ? () => onPickSlot(slot) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}
      {g.available.length === 0 && g.scheduled.length === 0 && (
        <p className="py-2 text-center text-[10px] text-muted-foreground">{t("subSidebar.noAvailabilityForThisDay")}</p>
      )}
    </>
  );

  return (
    // The whole panel takes a card dropped back on it (not just the list), lit up while hovering.
    <aside
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col border-l bg-card transition-colors ${isOver ? "bg-primary/10 ring-2 ring-inset ring-primary/40" : ""} ${className}`}
      aria-label={t("subSidebar.peopleToSchedule")}
    >
      {/* On a phone this sits in a sheet whose own close button is top-right: keep clear of it. */}
      <div className={`flex items-center justify-between gap-1 border-b p-2 ${onPickSlot ? "pr-12" : ""}`}>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("subSidebar.previousDay")} onClick={() => onStepDate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="flex-1 truncate text-center text-sm font-semibold">
          {isGc ? t("subSidebar.subs") : t("subSidebar.available")} — {dayLabel(selectedDate)}
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("subSidebar.nextDay")} onClick={() => onStepDate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!onPickSlot && (
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("subSidebar.collapseTheSidePanel")} onClick={onToggleCollapse}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2 border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={isGc ? t("subSidebar.searchSubsOrEmployees") : t("subSidebar.searchByName")}
            aria-label={t("subSidebar.searchPeople")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {jobTitles.length > 0 && (
          <Select value={jobTitle} onValueChange={setJobTitle}>
            <SelectTrigger className="h-8 text-xs" aria-label={t("subSidebar.filterByJobTitle")}>
              <SelectValue placeholder={t("subSidebar.filterByJobTitle")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("subSidebar.allJobTitles")}</SelectItem>
              {jobTitles.map((title) => (
                <SelectItem key={title} value={title}>
                  {jobTitleLabel(title)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canDrag &&
          (copiedDate ? (
            <div className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 p-2">
              <Copy className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="flex-1 truncate text-xs text-primary">{t("subSidebar.copyingFrom")}{" "}{dayLabel(copiedDate)} {" "}{t("subSidebar.clickADayToPaste")}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" aria-label={t("subSidebar.stopCopying")} onClick={onClearCopy}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={onCopy}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              
              {t("subSidebar.copyCurrentSchedule")}
            </Button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {data.crews.length === 0 ? (isGc ? t("subSidebar.noConnectedSubcontractors") : t("subSidebar.noCrewYet")) : t("subSidebar.noMatches")}
          </p>
        ) : (
          <Accordion type="multiple" defaultValue={data.crews.map((c) => c.companyId)} className="space-y-1">
            {groups.map((g) => (
              <AccordionItem key={g.crew.companyId} value={g.crew.companyId} className="rounded-md border px-2">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <div className="mr-2 flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                    <span className="w-full truncate text-xs font-semibold">{g.crew.companyName}</span>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{t("subSidebar.availableCount", { count: g.availableCount })}</span>
                      <span>•</span>
                      <span className="font-medium text-green-600 dark:text-green-500">{t("subSidebar.scheduledCount", { count: g.scheduledCount })}</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-2">{body(g)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </aside>
  );
}
