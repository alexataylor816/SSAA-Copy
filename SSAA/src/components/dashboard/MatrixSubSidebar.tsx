import { useState, useMemo, useRef } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ChevronLeft, ChevronRight, Building2, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MatrixEmployee } from './MatrixEmployeeCard';

// Draggable wrapper used inside the sub sidebar so GCs can drag sub employees onto cells.
interface DraggableSubChipProps {
  employee: MatrixEmployee;
  dragId: string;
  ringClass: string;
  children: React.ReactNode;
  enabled: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}
const DraggableSubChip = ({ employee, dragId, ringClass, children, enabled, selected, onToggleSelect }: DraggableSubChipProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { employee },
    disabled: !enabled,
  });
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
  } : undefined;

  // Distinguish click from drag — same pattern as MatrixEmployeeCard.
  // dnd-kit listeners suppress synthetic onClick, so we trigger select on
  // pointerup ourselves when pointer barely moved and no drag started.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    // Forward to dnd-kit so drag activation still works.
    if (enabled) listeners?.onPointerDown?.(e as unknown as PointerEvent);
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (isDragging) return;
    if (!down) return;
    const dx = Math.abs(e.clientX - down.x);
    const dy = Math.abs(e.clientY - down.y);
    if (dx > 5 || dy > 5) return;
    if (onToggleSelect) onToggleSelect();
  };

  // When selected, suppress status ring so the strong selection treatment is unmistakable.
  const effectiveRingClass = selected ? '' : ringClass;
  const selectionRingClass = selected
    ? 'ring-4 ring-blue-600 ring-offset-2 ring-offset-background bg-blue-50 dark:bg-blue-950/40 scale-[1.03] shadow-lg transition-transform'
    : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(enabled ? { ...listeners, ...attributes } : {})}
      onPointerDown={enabled ? handlePointerDown : undefined}
      onPointerUp={enabled ? handlePointerUp : undefined}
      className={`flex items-center gap-1.5 p-1.5 rounded-md bg-card border border-border/50 ${effectiveRingClass} ${selectionRingClass} ${enabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {children}
    </div>
  );
};

interface SubCompany {
  id: string;
  name: string;
  trade?: string | null;
  /** When set, this company is nested under the given company's group (sub-of-sub). */
  parentCompanyId?: string | null;
}

interface Availability {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  all_projects: boolean | null;
  stop_number?: number | null;
  stop_label?: string | null;
}

interface ScheduledEntry {
  employeeId: string;
  projectId: string;
  date: string;
}

interface ProjectInfo {
  id: string;
  name: string;
}

interface MatrixSubSidebarProps {
  connectedSubs: SubCompany[];
  allEmployees: MatrixEmployee[];
  availabilities: Availability[];
  scheduledEntries: ScheduledEntry[];
  projects: ProjectInfo[];
  selectedDate: string | null;
  visibleDateStrings: string[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  singleProjectMode: boolean;
  selectedProjectId?: string;
  /** Enable drag of sub employees from sidebar onto matrix cells (GC mode). */
  enableDrag?: boolean;
  /** `${employeeId}::${date}` keys: hide these chips entirely (booked by another GC). */
  crossGcBookings?: Set<string>;
  /** `${employeeId}::${date}` -> name of OTHER project (same GC) where the employee is booked.
   *  Sidebar adds a red ring + "(Project Name)" suffix on those chips. */
  sameGcOtherProjectMap?: Map<string, string>;
  /** Multi-select: set of dragIds currently selected (sidebar chips). */
  selectedChipIds?: Set<string>;
  /** Multi-select: toggle a chip's selection state. */
  onToggleChipSelect?: (dragId: string) => void;
  /** `${employeeId}::${availabilityId}::${date}` keys for stops already scheduled/drafted. */
  scheduledStopKeys?: Set<string>;
  /** `${employeeId}::${date}` keys where every stop is taken. */
  fullyScheduledEmpDates?: Set<string>;
}

// Convert UTC timestamp to local YYYY-MM-DD using getUTC* (timezone-agnostic per project rules)
const availabilityDateStr = (start: string): string => {
  const d = new Date(start);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Format UTC timestamp as 12-hour clock label (e.g. "7:00 AM")
const formatTimeLabel = (ts: string): string => {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const MatrixSubSidebar = ({
  connectedSubs,
  allEmployees,
  availabilities,
  scheduledEntries,
  projects,
  selectedDate,
  visibleDateStrings,
  collapsed,
  onToggleCollapse,
  singleProjectMode,
  selectedProjectId,
  enableDrag = false,
  crossGcBookings = new Set<string>(),
  sameGcOtherProjectMap = new Map<string, string>(),
  selectedChipIds,
  onToggleChipSelect,
  scheduledStopKeys = new Set<string>(),
  fullyScheduledEmpDates = new Set<string>(),
}: MatrixSubSidebarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  // Droppable: drag a scheduled chip back here to remove it.
  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({ id: 'sidebar-drop' });

  // Compute, per sub: available + scheduled employees (and a name -> project map for tooltips)
  const subData = useMemo(() => {
    const dayFilter = selectedDate ? [selectedDate] : visibleDateStrings;
    const dayFilterSet = new Set(dayFilter);
    const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

    return connectedSubs.map(sub => {
      const subEmps = allEmployees.filter(e => e.company_id === sub.id);

      // A stop is stored once per project it was saved against, so the same shift can
      // exist as several rows. Collapse them into one entry (keyed on stop number, or
      // the exact start/end range) while keeping every row id so a stop recorded on a
      // request under another project still matches.
      const stopGroups = (emp: MatrixEmployee, dates: Set<string>) => {
        const map = new Map<string, { rep: Availability; rows: Availability[]; date: string }>();
        availabilities.forEach(a => {
          if (a.employee_id !== emp.id) return;
          const ds = availabilityDateStr(a.start_time);
          if (!dates.has(ds)) return;
          if (singleProjectMode && selectedProjectId) {
            if (!(a.all_projects || a.project_id === selectedProjectId || a.project_id === null)) return;
          }
          const key = `${ds}::${a.stop_number != null ? `stop::${a.stop_number}` : `range::${a.start_time}::${a.end_time}`}`;
          const g = map.get(key);
          if (!g) map.set(key, { rep: a, rows: [a], date: ds });
          else {
            g.rows.push(a);
            if (a.id < g.rep.id) g.rep = a;
          }
        });
        return Array.from(map.values()).sort((x, y) => x.rep.start_time.localeCompare(y.rep.start_time));
      };

      const isStopTaken = (empId: string, group: { rows: Availability[]; date: string }) => {
        if (fullyScheduledEmpDates.has(`${empId}::${group.date}`)) return true;
        return group.rows.some(r => scheduledStopKeys.has(`${empId}::${r.id}::${group.date}`));
      };

      // Scheduled: one chip per (employee, stop) actually placed/confirmed on a day
      // in the filter window.
      type SchedStop = {
        employee: MatrixEmployee;
        avail: Availability | null;
        projectsLabel: string;
        datesLabel: string;
      };
      const scheduledMap = new Map<string, { projectIds: Set<string>; dates: Set<string> }>();
      scheduledEntries.forEach(se => {
        if (!dayFilterSet.has(se.date)) return;
        if (singleProjectMode && selectedProjectId && se.projectId !== selectedProjectId) return;
        const emp = allEmployees.find(e => e.id === se.employeeId);
        if (!emp || emp.company_id !== sub.id) return;
        if (!scheduledMap.has(emp.id)) scheduledMap.set(emp.id, { projectIds: new Set(), dates: new Set() });
        const entry = scheduledMap.get(emp.id)!;
        entry.projectIds.add(se.projectId);
        entry.dates.add(se.date);
      });

      const scheduledStops: SchedStop[] = [];
      scheduledMap.forEach((info, empId) => {
        const emp = subEmps.find(e => e.id === empId);
        if (!emp) return;
        const projectsLabel = Array.from(info.projectIds).map(pid => projectNameMap.get(pid) || 'Unknown').join(', ');
        const datesLabel = Array.from(info.dates).sort().map(d => format(parseISO(d), 'MMM d')).join(', ');

        const groups = stopGroups(emp, info.dates);
        const taken = groups.filter(g => isStopTaken(emp.id, g));
        const shown = taken.length > 0 ? taken : groups;

        if (shown.length === 0) {
          scheduledStops.push({ employee: emp, avail: null, projectsLabel, datesLabel });
        } else {
          shown.forEach(g => scheduledStops.push({ employee: emp, avail: g.rep, projectsLabel, datesLabel }));
        }
      });

      // Available stops: one entry per real stop that is not already scheduled,
      // requested, or part of an unsaved change.
      type AvailStop = { employee: MatrixEmployee; avail: Availability };
      const availableStops: AvailStop[] = [];
      subEmps.forEach(emp => {
        stopGroups(emp, dayFilterSet).forEach(g => {
          if (isStopTaken(emp.id, g)) return;
          availableStops.push({ employee: emp, avail: g.rep });
        });
      });

      const availableStopsOnly = availableStops
        // Privacy: silently drop chips for employees booked by ANOTHER GC on this date
        .filter(s => {
          const dateStr = availabilityDateStr(s.avail.start_time);
          return !crossGcBookings.has(`${s.employee.id}::${dateStr}`);
        });

      const uniqueAvailableEmps = new Set(availableStopsOnly.map(s => s.employee.id));

      return {
        sub,
        availableStops: availableStopsOnly,
        scheduled: scheduledStops,
        availableCount: uniqueAvailableEmps.size,
      };
    });
  }, [connectedSubs, allEmployees, availabilities, scheduledEntries, projects, selectedDate, visibleDateStrings, singleProjectMode, selectedProjectId, crossGcBookings, scheduledStopKeys, fullyScheduledEmpDates]);

  // Search filter
  const filteredSubData = useMemo(() => {
    if (!searchQuery.trim()) return subData;
    const q = searchQuery.toLowerCase();
    return subData
      .map(sd => {
        const subMatches = sd.sub.name.toLowerCase().includes(q);
        if (subMatches) return sd;
        const filteredAvail = sd.availableStops.filter(s => s.employee.name.toLowerCase().includes(q));
        const filteredSched = sd.scheduled.filter(s => s.employee.name.toLowerCase().includes(q));
        if (filteredAvail.length === 0 && filteredSched.length === 0) return null;
        const uniq = new Set(filteredAvail.map(s => s.employee.id));
        return { ...sd, availableStops: filteredAvail, scheduled: filteredSched, availableCount: uniq.size };
      })
      .filter(Boolean) as typeof subData;
  }, [subData, searchQuery]);

  const totalSubs = subData.length;
  const openValues = useMemo(() => filteredSubData.map(sd => sd.sub.id), [filteredSubData]);

  // Nest sub-of-sub groups under their main subcontractor group.
  const visibleIds = useMemo(() => new Set(filteredSubData.map(sd => sd.sub.id)), [filteredSubData]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, typeof filteredSubData>();
    filteredSubData.forEach(sd => {
      const parentId = sd.sub.parentCompanyId;
      if (!parentId || !visibleIds.has(parentId) || parentId === sd.sub.id) return;
      const list = map.get(parentId) || [];
      list.push(sd);
      map.set(parentId, list as typeof filteredSubData);
    });
    return map;
  }, [filteredSubData, visibleIds]);
  const rootData = useMemo(
    () => filteredSubData.filter(sd => {
      const parentId = sd.sub.parentCompanyId;
      return !parentId || !visibleIds.has(parentId) || parentId === sd.sub.id;
    }),
    [filteredSubData, visibleIds]
  );

  type GroupData = typeof filteredSubData[number];

  const renderGroupBody = ({ availableStops, scheduled, sub }: GroupData) => {
    const children = childrenByParent.get(sub.id) || [];
    return (
      <>
        {scheduled.length > 0 && (
          <div className="mb-2">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 px-1">Scheduled</div>
            <div className="space-y-1">
              {scheduled.map(({ employee, avail, projectsLabel, datesLabel }, idx) => {
                const timeLabel = avail
                  ? `${formatTimeLabel(avail.start_time)} – ${formatTimeLabel(avail.end_time)}`
                  : null;
                const stopLabel = avail?.stop_number ? `Stop ${avail.stop_number}` : null;
                const chipKey = avail ? `${employee.id}::${avail.id}` : `${employee.id}::sched-${idx}`;
                const sidebarDragId = `sidebar::${employee.id}${avail ? `::${avail.id}` : ''}`;
                return (
                  <Tooltip key={chipKey}>
                    <TooltipTrigger asChild>
                      <DraggableSubChip
                        employee={employee}
                        dragId={sidebarDragId}
                        ringClass="ring-2 ring-green-500/70"
                        enabled={enableDrag}
                        selected={selectedChipIds?.has(sidebarDragId)}
                        onToggleSelect={onToggleChipSelect ? () => onToggleChipSelect(sidebarDragId) : undefined}
                      >
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                          {getInitials(employee.name)}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-medium truncate">{employee.name}</span>
                          {employee.job_title && (
                            <span className="text-[10px] text-muted-foreground truncate">{employee.job_title}</span>
                          )}
                          {timeLabel && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {stopLabel ? `${stopLabel} · ` : ''}{timeLabel}
                            </span>
                          )}
                        </div>
                      </DraggableSubChip>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs max-w-xs">
                      <div className="font-medium">{projectsLabel}</div>
                      <div className="text-muted-foreground">{datesLabel}</div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}

        {availableStops.length > 0 && (
          <div>
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 px-1">Available</div>
            <div className="space-y-1">
              {availableStops.map(({ employee, avail }) => {
                const timeLabel = `${formatTimeLabel(avail.start_time)} – ${formatTimeLabel(avail.end_time)}`;
                const stopLabel = avail.stop_number ? `Stop ${avail.stop_number}` : null;
                const dateStr = availabilityDateStr(avail.start_time);
                const otherProjectName = sameGcOtherProjectMap.get(`${employee.id}::${dateStr}`);
                const ringClass = otherProjectName
                  ? 'ring-2 ring-red-500/70'
                  : 'ring-1 ring-yellow-500/40';
                const sidebarDragId = `sidebar::${employee.id}::${avail.id}`;
                return (
                  <DraggableSubChip
                    key={`${employee.id}::${avail.id}`}
                    employee={employee}
                    dragId={sidebarDragId}
                    ringClass={ringClass}
                    enabled={enableDrag}
                    selected={selectedChipIds?.has(sidebarDragId)}
                    onToggleSelect={onToggleChipSelect ? () => onToggleChipSelect(sidebarDragId) : undefined}
                  >
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                      {getInitials(employee.name)}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium truncate">
                        {employee.name}
                        {otherProjectName && (
                          <span className="text-red-600 dark:text-red-400 font-normal"> ({otherProjectName})</span>
                        )}
                      </span>
                      {employee.job_title && (
                        <span className="text-[10px] text-muted-foreground truncate">{employee.job_title}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground truncate">
                        {stopLabel ? `${stopLabel} · ` : ''}{timeLabel}
                      </span>
                    </div>
                  </DraggableSubChip>
                );
              })}
            </div>
          </div>
        )}

        {availableStops.length === 0 && scheduled.length === 0 && children.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-2">
            No availability or schedule for this {selectedDate ? 'day' : 'week'}
          </p>
        )}

        {children.length > 0 && (
          <div className="mt-2 pl-2 border-l-2 border-border">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 px-1">Connected Subcontractors</div>
            <Accordion type="multiple" defaultValue={children.map(c => c.sub.id)} className="space-y-1">
              {children.map(child => renderGroup(child))}
            </Accordion>
          </div>
        )}
      </>
    );
  };

  const renderGroup = (sd: GroupData) => (
    <AccordionItem key={sd.sub.id} value={sd.sub.id} className="border border-border rounded-md px-2">
      <AccordionTrigger className="py-2 hover:no-underline">
        <div className="flex flex-col items-start gap-0.5 text-left flex-1 min-w-0 mr-2">
          <span className="text-xs font-semibold truncate w-full">{sd.sub.name}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{sd.availableCount} available</span>
            <span>•</span>
            <span className="text-green-600 dark:text-green-500 font-medium">{new Set(sd.scheduled.map(s => s.employee.id)).size} scheduled</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-2">
        {renderGroupBody(sd)}
      </AccordionContent>
    </AccordionItem>
  );


  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-4 bg-card border-l border-border w-10">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="mb-4">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground mt-1 [writing-mode:vertical-lr] rotate-180">
          Subcontractors ({totalSubs})
        </span>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 bg-card border-l border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-semibold truncate">
          {selectedDate
            ? `Subs — ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : `Subcontractors (${totalSubs})`
          }
        </h3>
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-6 w-6">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search subs or employees..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div ref={setDropRef} className={`flex-1 overflow-y-auto p-2 transition-colors ${isDropOver ? 'bg-primary/10' : ''}`}>
        {filteredSubData.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {connectedSubs.length === 0 ? 'No connected subcontractors' : 'No matches'}
          </p>
        ) : (
          <Accordion type="multiple" defaultValue={openValues} className="space-y-1">
            {rootData.map(sd => renderGroup(sd))}
          </Accordion>

        )}
      </div>
    </div>
  );
};

export default MatrixSubSidebar;
