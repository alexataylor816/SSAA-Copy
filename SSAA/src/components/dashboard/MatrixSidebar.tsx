import { useState, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Users, Search, Copy, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import MatrixEmployeeCard, { MatrixEmployee } from './MatrixEmployeeCard';

interface ScheduledEntry {
  employeeId: string;
  projectId: string;
  date: string;
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

interface MatrixSidebarProps {
  employees: MatrixEmployee[];
  effectiveScheduledIds: Set<string>;
  scheduledEntries: ScheduledEntry[];
  selectedDate: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCopySchedule?: () => void;
  copiedDate?: string | null;
  onClearCopy?: () => void;
  /** All availability rows for this company; used to render per-stop chips with hours. */
  availabilities?: AvailabilityRecord[];
  /** Visible week dates (YYYY-MM-DD) — used when no specific day is selected. */
  visibleDateStrings?: string[];
  /** Per-stop scheduled keys: `${empId}::${availabilityId}::${dateStr}`. Chips matching are hidden. */
  scheduledStopKeys?: Set<string>;
  /** Emp+date pairs where ALL stops are blocked (no per-stop tracking, e.g. confirmed reqs). */
  fullyScheduledEmpDates?: Set<string>;
  /** Single-project mode: filter sidebar to only employees assigned to this project. */
  singleProjectMode?: boolean;
  /** Set of employee IDs assigned to the currently-selected project (single-project mode only). */
  assignedEmployeeIds?: Set<string>;
  /** Currently-selected project id (used to keep `all_projects` and project-specific availability for it). */
  selectedProjectId?: string | null;
  /** Set of dragIds currently selected (sidebar chips use `sidebar::${empId}::${availId}`). */
  selectedChipIds?: Set<string>;
  /** Toggle selection on a sidebar chip dragId. */
  onToggleChipSelect?: (dragId: string) => void;
}

// Convert UTC timestamp to local YYYY-MM-DD using getUTC* (timezone-agnostic).
const availabilityDateStr = (start: string): string => {
  const d = new Date(start);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Format UTC timestamp as 12-hour clock label (e.g. "7:00 AM").
const formatTimeLabel = (ts: string): string => {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const MatrixSidebar = ({
  employees,
  effectiveScheduledIds,
  scheduledEntries,
  selectedDate,
  collapsed,
  onToggleCollapse,
  onCopySchedule,
  copiedDate,
  onClearCopy,
  availabilities = [],
  visibleDateStrings = [],
  scheduledStopKeys,
  fullyScheduledEmpDates,
  singleProjectMode = false,
  assignedEmployeeIds,
  selectedProjectId = null,
  selectedChipIds,
  onToggleChipSelect,
}: MatrixSidebarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [jobTitleFilter, setJobTitleFilter] = useState<string>('all');

  // Apply name + job-title filters to the FULL roster. Per-stop scheduled filtering
  // happens later at chip granularity so we don't drop an employee just because
  // ONE of their stops is already drafted.
  const filteredEmployees = useMemo(() => {
    let result = employees;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e => e.name.toLowerCase().includes(q));
    }
    if (jobTitleFilter && jobTitleFilter !== 'all') {
      result = result.filter(e => e.job_title === jobTitleFilter);
    }
    // In single-project mode, only show employees assigned to that project.
    if (singleProjectMode && assignedEmployeeIds) {
      result = result.filter(e => assignedEmployeeIds.has(e.id));
    }
    return result;
  }, [employees, searchQuery, jobTitleFilter, singleProjectMode, assignedEmployeeIds]);

  const jobTitles = useMemo(() => {
    const titles = new Set<string>();
    employees.forEach(e => {
      if (e.job_title) titles.add(e.job_title);
    });
    return Array.from(titles).sort();
  }, [employees]);

  // Expand each employee into one chip per availability stop on the relevant day(s),
  // then drop chips whose specific stop is already scheduled/drafted on that date.
  // If the employee has no availability rows in the visible window, fall back to a
  // single placeholder chip (and only hide it when the legacy "all-stops" block applies).
  const employeeChips = useMemo(() => {
    const dayFilter = selectedDate ? [selectedDate] : visibleDateStrings;
    const dayFilterSet = new Set(dayFilter);

    type Chip = { emp: MatrixEmployee; avail: AvailabilityRecord | null; key: string };
    const chips: Chip[] = [];

    filteredEmployees.forEach(emp => {
      // Pull availability rows for this employee on the relevant day(s).
      // In single-project mode, restrict to rows that target THIS project or are global (`all_projects`).
      const empBlocksRaw = availabilities
        .filter(a => {
          if (a.employee_id !== emp.id) return false;
          if (!dayFilterSet.has(availabilityDateStr(a.start_time))) return false;
          if (singleProjectMode && selectedProjectId) {
            return a.all_projects === true || a.project_id === selectedProjectId || a.project_id === null;
          }
          return true;
        })
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      // Dedupe by (date, stop_number || start_time-end_time): an employee that has the same
      // shift saved for multiple projects should appear as ONE chip per unique stop, not N×M.
      const seen = new Map<string, AvailabilityRecord>();
      for (const a of empBlocksRaw) {
        const dateStr = availabilityDateStr(a.start_time);
        const stopKey = a.stop_number != null
          ? `${dateStr}::stop::${a.stop_number}`
          : `${dateStr}::range::${a.start_time}::${a.end_time}`;
        // Keep the row with the lexicographically lowest id for stability across renders.
        const existing = seen.get(stopKey);
        if (!existing || a.id < existing.id) seen.set(stopKey, a);
      }
      const empBlocks = Array.from(seen.values()).sort((a, b) => a.start_time.localeCompare(b.start_time));

      if (empBlocks.length === 0) {
        // No availability rows — only show placeholder if not fully scheduled on the selected date.
        const dateStr = selectedDate;
        if (dateStr && fullyScheduledEmpDates?.has(`${emp.id}::${dateStr}`)) return;
        chips.push({ emp, avail: null, key: `${emp.id}::single` });
      } else {
        empBlocks.forEach(avail => {
          const dateStr = availabilityDateStr(avail.start_time);
          // Drop this chip if its specific stop is already scheduled on this date,
          // OR if every stop for this emp/date is blocked (legacy non-stop-tracked).
          if (scheduledStopKeys?.has(`${emp.id}::${avail.id}::${dateStr}`)) return;
          if (fullyScheduledEmpDates?.has(`${emp.id}::${dateStr}`)) return;
          chips.push({ emp, avail, key: `${emp.id}::${avail.id}` });
        });
      }
    });

    return chips;
  }, [filteredEmployees, availabilities, selectedDate, visibleDateStrings, scheduledStopKeys, fullyScheduledEmpDates, singleProjectMode, selectedProjectId]);

  // Header count: how many distinct employees still have at least one available chip.
  const availableEmployeeCount = useMemo(() => {
    const ids = new Set<string>();
    employeeChips.forEach(c => ids.add(c.emp.id));
    return ids.size;
  }, [employeeChips]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-4 bg-card border-l border-border w-10">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="mb-4">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground mt-1 [writing-mode:vertical-lr] rotate-180">
          Available ({availableEmployeeCount})
        </span>
      </div>
    );
  }

  return (
    <div className="w-64 flex-shrink-0 bg-card border-l border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-semibold truncate">
          {selectedDate
            ? `Available — ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : `Available (${availableEmployeeCount})`
          }
        </h3>
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-6 w-6">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="p-2 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {jobTitles.length > 0 && (
          <Select value={jobTitleFilter} onValueChange={setJobTitleFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by job title" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Job Titles</SelectItem>
              {jobTitles.map(title => (
                <SelectItem key={title} value={title}>{title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Copy Schedule */}
        {copiedDate ? (
          <div className="flex items-center gap-1.5 p-2 rounded-md bg-primary/10 border border-primary/20">
            <Copy className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs text-primary flex-1 truncate">
              Copying from {format(parseISO(copiedDate), 'EEE, MMM d')}
            </span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClearCopy}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={onCopySchedule}
          >
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copy Current Schedule
          </Button>
        )}
      </div>

      <SidebarDropZone>
        {employeeChips.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {searchQuery || jobTitleFilter !== 'all' ? 'No matching employees' : 'No available employees'}
          </p>
        ) : (
          employeeChips.map(({ emp, avail, key }) => {
            const timeLabel = avail ? `${formatTimeLabel(avail.start_time)} – ${formatTimeLabel(avail.end_time)}` : undefined;
            const stopLabel = avail?.stop_number ? `Stop ${avail.stop_number}` : undefined;
            const dragIdStr = `sidebar::${key}`;
            return (
              <MatrixEmployeeCard
                key={key}
                employee={emp}
                density="compact"
                status="available"
                dragId={dragIdStr}
                draggable={true}
                timeLabel={timeLabel}
                stopLabel={stopLabel}
                selected={selectedChipIds?.has(dragIdStr)}
                onToggleSelect={onToggleChipSelect ? () => onToggleChipSelect(dragIdStr) : undefined}
              />
            );
          })
        )}
      </SidebarDropZone>
    </div>
  );
};

const SidebarDropZone = ({ children }: { children: React.ReactNode }) => {
  const { setNodeRef, isOver } = useDroppable({ id: 'sidebar-drop' });
  return (
    <div ref={setNodeRef} className={`flex-1 overflow-y-auto p-2 space-y-1.5 transition-colors ${isOver ? 'bg-primary/10' : ''}`}>
      {children}
    </div>
  );
};

export default MatrixSidebar;
