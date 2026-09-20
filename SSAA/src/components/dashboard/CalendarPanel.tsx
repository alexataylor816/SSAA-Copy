import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isWithinInterval, getDay, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { getHistoricalLockDate } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFirstClickTooltip } from '@/components/onboarding/useFirstClickTooltip';
import FirstClickTooltip from '@/components/onboarding/FirstClickTooltip';
import { getCalendarTipCopy, calendarTipKey, type TourRole } from '@/components/onboarding/tourSteps';

// Parse date string as local date (avoids UTC conversion issues with parseISO)
const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

interface Task {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
}

interface ScheduleRequest {
  id: string;
  scheduled_date: string;
  status: string | null;
  sub_company_id?: string;
  edited?: boolean;
}

interface DayStatus {
  date: string;
  confirmedCount: number;
  pendingCount: number;
  rejectedCount?: number;
  totalRequestedSubs: number;
  scheduledEmployeeCount: number;
  availableEmployeeCount: number;
  hasEdited?: boolean;
  subAssignedCount?: number;
}

interface SubOverlayDayData {
  subName: string;
  employeeCount: number;
}

interface CalendarPanelProps {
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  selectedDate: Date | null;
  setSelectedDate: (date: Date | null) => void;
  selectedDates?: Date[];
  setSelectedDates?: (dates: Date[]) => void;
  tasks: Task[];
  showOverlay: boolean;
  onDayClick: (date: Date) => void;
  pendingRequestDates?: string[];
  viewMode?: 'gc' | 'sub' | 'moa';
  dayStatuses?: DayStatus[];
  subOverlayData?: { date: string; subs: SubOverlayDayData[] }[];
  tourRole?: TourRole;
}

// Group consecutive days for a task to draw connected lines
const getTaskLineSegments = (task: Task, days: Date[]) => {
  const start = parseLocalDate(task.start_date);
  const end = parseLocalDate(task.end_date);
  
  const segments: { startIdx: number; endIdx: number }[] = [];
  let currentStart: number | null = null;
  
  days.forEach((day, idx) => {
    const isInTask = isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
    
    if (isInTask) {
      if (currentStart === null) {
        currentStart = idx;
      }
    } else {
      if (currentStart !== null) {
        segments.push({ startIdx: currentStart, endIdx: idx - 1 });
        currentStart = null;
      }
    }
  });
  
  if (currentStart !== null) {
    segments.push({ startIdx: currentStart, endIdx: days.length - 1 });
  }
  
  return segments;
};

const CalendarPanel = ({
  currentDate,
  setCurrentDate,
  selectedDate,
  setSelectedDate,
  selectedDates = [],
  setSelectedDates,
  tasks,
  showOverlay,
  onDayClick,
  pendingRequestDates = [],
  viewMode = 'gc',
  dayStatuses = [],
  subOverlayData = [],
  tourRole
}: CalendarPanelProps) => {
  const { t, language } = useLanguage();
  const isMobile = useIsMobile();
  const effectiveTourRole: TourRole = tourRole ?? (viewMode === 'sub' ? 'sub' : 'gc');
  const calTip = useFirstClickTooltip(calendarTipKey('monthly'));
  useEffect(() => {
    const timer = window.setTimeout(() => calTip.trigger(), 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'select' | 'deselect'>('select');
  const [clickStartTime, setClickStartTime] = useState<number>(0);
  const [clickStartDay, setClickStartDay] = useState<Date | null>(null);
  const isMultiSelect = true;
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  
  const weekDayKeys = ['calendar.sun', 'calendar.mon', 'calendar.tue', 'calendar.wed', 'calendar.thu', 'calendar.fri', 'calendar.sat'];

  const getTasksForDay = (day: Date) => {
    return tasks.filter(task => {
      const start = parseLocalDate(task.start_date);
      const end = parseLocalDate(task.end_date);
      return isWithinInterval(day, { start, end }) || isSameDay(day, start) || isSameDay(day, end);
    });
  };

  const hasPendingRequest = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return pendingRequestDates.includes(dateStr);
  };

  // Check if day has edited requests (for GC view)
  const hasEditedRequest = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const status = dayStatuses.find(s => s.date === dateStr);
    return status?.hasEdited || false;
  };

  // Check if day has rejected/cancelled requests (for GC view)
  const hasRejectedRequest = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const status = dayStatuses.find(s => s.date === dateStr);
    return (status?.rejectedCount || 0) > 0;
  };

  // Check if day has sub-assigned requests (for GC view - blue dot)
  const hasSubAssigned = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const status = dayStatuses.find(s => s.date === dateStr);
    return (status?.subAssignedCount || 0) > 0;
  };

  // Get day status color - for Sub: green=all scheduled, yellow=available but not scheduled, white=no availability
  const getDayStatusColor = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const status = dayStatuses.find(s => s.date === dateStr);
    
    if (!status) return '';
    
    if (viewMode === 'gc' || viewMode === 'moa') {
      // GC view priority: red (rejected) > orange (edited) > green (all confirmed) > yellow (pending)
      // Check for rejected/cancelled first
      if ((status.rejectedCount || 0) > 0) {
        return 'bg-red-100 dark:bg-red-950/40'; // Has rejected/cancelled requests
      }
      // Check for edited requests
      if (status.hasEdited) {
        return 'bg-orange-100 dark:bg-orange-950/40'; // Request was edited by sub
      }
      // Check if all requests are confirmed
      if (status.totalRequestedSubs > 0 && status.confirmedCount === status.totalRequestedSubs) {
        return 'bg-green-100 dark:bg-green-950/40'; // All confirmed
      }
      // Has pending requests
      if (status.pendingCount > 0) {
        return 'bg-yellow-100 dark:bg-yellow-950/40'; // Pending requests sent out
      }
    } else {
      // Sub view priority: red (cancelled by GC) > yellow (available employees not scheduled) > green (all scheduled) > amber (pending only)
      // Check for cancelled requests first
      if ((status.rejectedCount || 0) > 0) {
        return 'bg-red-100 dark:bg-red-950/40'; // Has cancelled requests from GC to acknowledge
      }
      // Check if there are available employees who are NOT yet scheduled - always show yellow
      if (status.availableEmployeeCount > 0) {
        return 'bg-yellow-100 dark:bg-yellow-950/40'; // Employees available, waiting to be scheduled
      }
      // All employees scheduled (confirmed) = green
      if (status.confirmedCount > 0) {
        return 'bg-green-100 dark:bg-green-950/40'; // All scheduled
      }
      // Has pending requests but no availability set
      if (status.pendingCount > 0) {
        return 'bg-yellow-100 dark:bg-yellow-950/40'; // Pending requests to review
      }
    }
    return '';
  };

  const isDateSelected = useCallback((day: Date) => {
    if (selectedDates.length > 0) {
      return selectedDates.some(d => isSameDay(d, day));
    }
    return selectedDate && isSameDay(day, selectedDate);
  }, [selectedDates, selectedDate]);

  const handleDayClick = (day: Date) => {};

  // Drag selection handlers - always enabled
  const handleMouseDown = (day: Date) => {
    // Track click start time and day for detecting quick single clicks
    setClickStartTime(Date.now());
    setClickStartDay(day);
    
    if (setSelectedDates) {
      setIsDragging(true);
      const isAlreadySelected = selectedDates.some(d => isSameDay(d, day));
      // Set drag mode based on initial day's state
      if (isAlreadySelected) {
        setDragMode('deselect');
        setSelectedDates(selectedDates.filter(d => !isSameDay(d, day)));
      } else {
        setDragMode('select');
        setSelectedDates([...selectedDates, day]);
      }
    }
  };

  const handleMouseEnter = (day: Date) => {
    if (isDragging && setSelectedDates) {
      // If user drags to a different day, clear clickStartDay to prevent modal opening
      if (clickStartDay && !isSameDay(day, clickStartDay)) {
        setClickStartDay(null);
      }
      
      const isAlreadySelected = selectedDates.some(d => isSameDay(d, day));
      if (dragMode === 'select' && !isAlreadySelected) {
        setSelectedDates([...selectedDates, day]);
      } else if (dragMode === 'deselect' && isAlreadySelected) {
        setSelectedDates(selectedDates.filter(d => !isSameDay(d, day)));
      }
    }
  };

  const handleMouseUp = (day: Date) => {
    setIsDragging(false);
    
    // Check if this was a quick single click (not a drag)
    const clickDuration = Date.now() - clickStartTime;
    const isQuickClick = clickDuration < 300; // Less than 300ms
    const isSameStartDay = clickStartDay && isSameDay(day, clickStartDay);
    
    // If it was a quick click on the same day, open the modal
    if (isQuickClick && isSameStartDay && selectedDates.length === 1) {
      onDayClick(day);
    }
    
    setClickStartDay(null);
  };
  
  const handleMouseLeave = () => {
    setIsDragging(false);
    setClickStartDay(null);
  };
  
  // Grid-level mouse up handler (when user releases outside a specific day button)
  const handleGridMouseUp = () => {
    setIsDragging(false);
    setClickStartDay(null);
  };

  // ---------------- Mobile touch drag-select ----------------
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedDatesRef = useRef<Date[]>(selectedDates);
  selectedDatesRef.current = selectedDates;

  const touchRef = useRef<{
    active: boolean;          // a multi-day drag is in progress
    startDay: Date | null;
    startX: number;
    startY: number;
    startTime: number;
    mode: 'select' | 'deselect';
    lastKey: string | null;
    moved: boolean;
    holdTimer: number | null;
  }>({ active: false, startDay: null, startX: 0, startY: 0, startTime: 0, mode: 'select', lastKey: null, moved: false, holdTimer: null });

  const [touchDragging, setTouchDragging] = useState(false);

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const applyTouchDay = useCallback((day: Date) => {
    if (!setSelectedDates) return;
    const current = selectedDatesRef.current;
    const already = current.some((d) => isSameDay(d, day));
    if (touchRef.current.mode === 'select' && !already) {
      const next = [...current, day];
      selectedDatesRef.current = next;
      setSelectedDates(next);
    } else if (touchRef.current.mode === 'deselect' && already) {
      const next = current.filter((d) => !isSameDay(d, day));
      selectedDatesRef.current = next;
      setSelectedDates(next);
    }
  }, [setSelectedDates]);

  const beginTouchDrag = useCallback(() => {
    const s = touchRef.current;
    if (s.active || !s.startDay || !setSelectedDates) return;
    s.active = true;
    s.lastKey = dayKey(s.startDay);
    setTouchDragging(true);
    const already = selectedDatesRef.current.some((d) => isSameDay(d, s.startDay!));
    s.mode = already ? 'deselect' : 'select';
    // Toggle the starting day immediately, matching the desktop behaviour
    if (already) {
      const next = selectedDatesRef.current.filter((d) => !isSameDay(d, s.startDay!));
      selectedDatesRef.current = next;
      setSelectedDates(next);
    } else {
      const next = [...selectedDatesRef.current, s.startDay];
      selectedDatesRef.current = next;
      setSelectedDates(next);
    }
  }, [setSelectedDates]);

  const handleTouchStart = (day: Date, e: React.TouchEvent) => {
    if (!isMobile) return;
    const t = e.touches[0];
    const s = touchRef.current;
    if (s.holdTimer) window.clearTimeout(s.holdTimer);
    touchRef.current = {
      active: false,
      startDay: day,
      startX: t.clientX,
      startY: t.clientY,
      startTime: Date.now(),
      mode: 'select',
      lastKey: null,
      moved: false,
      holdTimer: window.setTimeout(() => beginTouchDrag(), 220),
    };
  };

  // Native (non-passive) touchmove so we can block page scroll while dragging
  useEffect(() => {
    if (!isMobile) return;
    const el = gridRef.current;
    if (!el) return;

    const onMove = (e: TouchEvent) => {
      const s = touchRef.current;
      if (!s.startDay) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      if (!s.active) {
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) s.moved = true;
        // Horizontal intent starts a drag without fighting vertical scrolling
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
          if (s.holdTimer) { window.clearTimeout(s.holdTimer); s.holdTimer = null; }
          beginTouchDrag();
        } else if (s.moved) {
          // Plain scroll gesture: cancel the pending long-press
          if (s.holdTimer) { window.clearTimeout(s.holdTimer); s.holdTimer = null; }
          s.startDay = null;
          return;
        }
      }

      if (!s.active) return;
      e.preventDefault();

      const target = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      const cell = target?.closest('[data-day]') as HTMLElement | null;
      const key = cell?.dataset.day;
      if (!key || key === s.lastKey) return;
      s.lastKey = key;
      const [y, m, d] = key.split('-').map(Number);
      applyTouchDay(new Date(y, m - 1, d));
    };

    const onEnd = () => {
      const s = touchRef.current;
      if (s.holdTimer) { window.clearTimeout(s.holdTimer); s.holdTimer = null; }
      const wasDrag = s.active;
      const startDay = s.startDay;
      const quick = Date.now() - s.startTime < 500 && !s.moved;
      s.active = false;
      s.startDay = null;
      s.lastKey = null;
      setTouchDragging(false);

      if (!wasDrag && quick && startDay && setSelectedDates) {
        // Simple tap: behave like before — select the single day and open it
        const already = selectedDatesRef.current.some((dd) => isSameDay(dd, startDay));
        const next = already
          ? selectedDatesRef.current.filter((dd) => !isSameDay(dd, startDay))
          : [...selectedDatesRef.current, startDay];
        selectedDatesRef.current = next;
        setSelectedDates(next);
        if (next.length === 1) onDayClick(startDay);
      }
    };

    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [isMobile, applyTouchDay, beginTouchDrag, setSelectedDates, onDayClick]);


  const handleConfirmMultiSelect = () => {
    if (selectedDates.length > 0) {
      onDayClick(selectedDates[0]);
    }
  };

  // Check if a task continues from previous day for connected line rendering
  const isTaskContinuingFromPrevDay = (task: Task, dayIdx: number) => {
    if (dayIdx === 0) return false;
    const prevDay = days[dayIdx - 1];
    const start = parseLocalDate(task.start_date);
    const end = parseLocalDate(task.end_date);
    return isWithinInterval(prevDay, { start, end }) || isSameDay(prevDay, start) || isSameDay(prevDay, end);
  };

  // Check if a task continues to next day
  const isTaskContinuingToNextDay = (task: Task, dayIdx: number) => {
    if (dayIdx >= days.length - 1) return false;
    const nextDay = days[dayIdx + 1];
    const start = parseLocalDate(task.start_date);
    const end = parseLocalDate(task.end_date);
    return isWithinInterval(nextDay, { start, end }) || isSameDay(nextDay, start) || isSameDay(nextDay, end);
  };

  // How many consecutive days (including this one) the task occupies going
  // forward within the same calendar week row. Used to size the mobile label.
  const getForwardSpanInWeek = (task: Task, dayIdx: number) => {
    const start = parseLocalDate(task.start_date);
    const end = parseLocalDate(task.end_date);
    const weekEnd = Math.floor(dayIdx / 7) * 7 + 6;
    let span = 1;
    for (let i = dayIdx + 1; i <= weekEnd && i < days.length; i++) {
      const d = days[i];
      if (isWithinInterval(d, { start, end }) || isSameDay(d, start) || isSameDay(d, end)) span++;
      else break;
    }
    return span;
  };

  const dateLocale = language === 'es' ? es : undefined;
  const lockDate = getHistoricalLockDate();

  const MAX_TASK_LANES = isMobile ? 99 : 5;
  // Mobile: when the sub overlay is on, widen the day columns so full sub names
  // fit and let the whole page scroll horizontally.
  const wideMobile = isMobile && subOverlayData.length > 0;
  const MOBILE_WIDE_COL = 150;
  const wideGridStyle = wideMobile
    ? { minWidth: `${MOBILE_WIDE_COL * 7 + 6 * 4}px` }
    : undefined;


  // Per-week lane assignment: for each calendar week (row of 7 days), greedily
  // assign each visible task the lowest-numbered free lane within that week.
  // This lets every task render somewhere (vs. a global lane map that hides
  // tasks beyond MAX_TASK_LANES even if they don't overlap with anything else).
  const weekTaskLaneMap = useMemo(() => {
    // Map: weekStartIdx (number, multiple of 7) -> Map<taskId, laneIdx>
    const result = new Map<number, Map<string, number>>();
    const sortedTasks = [...tasks].sort((a, b) => {
      if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
      return a.name.localeCompare(b.name);
    });

    for (let weekStart = 0; weekStart < days.length; weekStart += 7) {
      const weekDays = days.slice(weekStart, weekStart + 7);
      const lanes: { endDateStr: string }[] = []; // lanes[i].endDateStr = end of last task placed in lane i
      const weekMap = new Map<string, number>();

      // Find tasks that touch any day in this week
      const tasksInWeek = sortedTasks.filter(task => {
        const start = parseLocalDate(task.start_date);
        const end = parseLocalDate(task.end_date);
        return weekDays.some(d => (isWithinInterval(d, { start, end }) || isSameDay(d, start) || isSameDay(d, end)));
      });

      // Greedy: pick lowest free lane (one whose previous task ended before this task starts within the week)
      for (const task of tasksInWeek) {
        let assigned = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i].endDateStr < task.start_date) {
            assigned = i;
            lanes[i].endDateStr = task.end_date;
            break;
          }
        }
        if (assigned === -1) {
          assigned = lanes.length;
          lanes.push({ endDateStr: task.end_date });
        }
        weekMap.set(task.id, assigned);
      }

      result.set(weekStart, weekMap);
    }

    return result;
  }, [tasks, days]);

  return (
    <Card
      style={wideMobile ? { minWidth: `${MOBILE_WIDE_COL * 7 + 6 * 4 + 32}px` } : undefined}
      className="w-full lg:w-[1100px] lg:flex-shrink-0 min-w-0 border-primary/20 lg:h-full flex flex-col min-h-0 order-2 lg:order-none"
    >

      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">
            {format(currentDate, 'MMMM yyyy', { locale: dateLocale })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setCurrentDate(new Date())}
            >
              {t('common.today')}
            </Button>
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 pt-0 overflow-y-auto" ref={(el) => calTip.setAnchor(el)}>
        {calTip.show && (
          <FirstClickTooltip
            anchor={calTip.anchor}
            copy={getCalendarTipCopy(effectiveTourRole, 'monthly')}
            onDismiss={calTip.dismiss}
          />
        )}
        {/* Week days header */}
        <div className="sticky top-0 z-10 mb-2 grid grid-cols-7 gap-1 bg-card pb-2" style={wideGridStyle}>
          {weekDayKeys.map((key) => (
            <div
              key={key}
              className="py-2 text-center text-sm font-medium text-muted-foreground"
            >
              {t(key)}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-7 auto-rows-auto gap-1"
          style={{ ...(wideGridStyle || {}), ...(touchDragging ? { touchAction: 'none' } : {}) }}
          onMouseUp={handleGridMouseUp}
          onMouseLeave={handleMouseLeave}
        >

          {days.map((day, dayIdx) => {
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = isDateSelected(day);
            const isToday = isSameDay(day, new Date());
            const isLocked = isBefore(day, lockDate);
            const dayTasks = getTasksForDay(day);
            const isPending = hasPendingRequest(day);
            const isEdited = hasEditedRequest(day);
            const isRejected = hasRejectedRequest(day);
            const isSubAssigned = hasSubAssigned(day);
            const statusColor = isLocked ? '' : getDayStatusColor(day);
              const overlayActive = subOverlayData.length > 0;
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayOverlay = overlayActive
                ? subOverlayData.find(d => d.date === dateStr)
                : null;
              const subsWithAvail = dayOverlay?.subs.filter(s => s.employeeCount > 0) || [];
              const weekStartIdx = Math.floor(dayIdx / 7) * 7;
              const weekMap = weekTaskLaneMap.get(weekStartIdx);
              const lanes: (Task | null)[] = Array.from({ length: MAX_TASK_LANES }, () => null);
              let overflow = 0;
              // Number of lanes used anywhere in this week row, so every day in
              // the row renders the same lane slots and bars line up horizontally.
              const weekLaneCount = showOverlay && weekMap && weekMap.size > 0
                ? Math.max(...Array.from(weekMap.values())) + 1
                : 0;

              if (showOverlay) {
                dayTasks.forEach((task) => {
                  const lane = weekMap?.get(task.id);
                  if (lane === undefined) return;
                  if (lane < MAX_TASK_LANES) {
                    lanes[lane] = task;
                  } else {
                    overflow += 1;
                  }
                });
              }

              const mobileMinHeight = isMobile
                ? 40 + (showOverlay ? weekLaneCount * 17 : 0) + subsWithAvail.length * 18
                : undefined;
              const hasVisibleTaskLabel = isMobile && showOverlay && lanes.some((task) => {
                if (!task) return false;
                const continueFromPrev = isTaskContinuingFromPrevDay(task, dayIdx);
                const taskStart = parseLocalDate(task.start_date);
                const isTaskStart = isSameDay(day, taskStart);
                const isRestartDay = getDay(day) === 1;
                return isTaskStart || (isRestartDay && !isTaskStart && continueFromPrev);
              });

            return (
              <button
                key={day.toISOString()}
                data-day={dayKey(day)}
                onClick={() => handleDayClick(day)}
                onMouseDown={isMobile ? undefined : () => handleMouseDown(day)}
                onMouseEnter={isMobile ? undefined : () => handleMouseEnter(day)}
                onMouseUp={isMobile ? undefined : () => handleMouseUp(day)}
                onTouchStart={isMobile ? (e) => handleTouchStart(day, e) : undefined}
                style={isMobile ? { minHeight: `${Math.max(mobileMinHeight ?? 0, 96)}px` } : undefined}
                className={`
                  ${isMobile
                    ? 'p-1'
                    : `${overlayActive ? 'min-h-[220px] px-2 pb-2 pt-6' : 'min-h-[112px] px-1 pb-1 pt-6'}`
                  } flex h-full flex-col items-stretch gap-0.5 rounded-md text-sm relative transition-colors select-none text-left
                  ${hasVisibleTaskLabel ? 'z-20' : 'z-0'}
                  ${!isCurrentMonth ? 'text-muted-foreground/50' : 'text-foreground'}
                  ${isLocked && !isSelected ? (isMobile ? 'bg-muted/60 text-muted-foreground' : 'opacity-50 bg-muted/60') : ''}
                  ${isSelected ? 'bg-primary text-primary-foreground' : ''}
                  ${!isSelected && !isLocked && statusColor ? statusColor : ''}
                  ${isPending && !isSelected && !statusColor && !isLocked ? 'bg-destructive/20 hover:bg-destructive/30' : ''}
                  ${!isSelected && !isPending && !statusColor && !isLocked ? 'hover:bg-muted' : ''}
                  ${isToday && !isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}
                `}


              >
                {/* Day number + status indicators row */}
                {isMobile ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-medium">{format(day, 'd')}</span>
                    <div className="flex items-center gap-1">
                      {(viewMode === 'gc' || viewMode === 'moa') && isEdited && !isRejected && (
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                      )}
                      {(viewMode === 'gc' || viewMode === 'moa') && isRejected && (
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                      )}
                      {(viewMode === 'gc' || viewMode === 'moa') && isSubAssigned && !isEdited && !isRejected && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                      {isPending && !(viewMode === 'gc' || viewMode === 'moa') && (
                        <div className="w-2 h-2 rounded-full bg-destructive" />
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="absolute top-1 left-1/2 -translate-x-1/2">
                      {format(day, 'd')}
                    </span>
                    {(viewMode === 'gc' || viewMode === 'moa') && isEdited && !isRejected && (
                      <div className="absolute top-1 right-1">
                        <div className="w-3 h-3 rounded-full bg-orange-500 border border-orange-600" />
                      </div>
                    )}
                    {(viewMode === 'gc' || viewMode === 'moa') && isRejected && (
                      <div className="absolute top-1 right-1">
                        <div className="w-3 h-3 rounded-full bg-red-500 border border-red-600" />
                      </div>
                    )}
                    {(viewMode === 'gc' || viewMode === 'moa') && isSubAssigned && !isEdited && !isRejected && (
                      <div className="absolute top-1 right-1">
                        <div className="w-3 h-3 rounded-full bg-blue-500 border border-blue-600" />
                      </div>
                    )}
                    {isPending && !(viewMode === 'gc' || viewMode === 'moa') && (
                      <div className="absolute top-1 right-1">
                        <div className="w-2 h-2 rounded-full bg-destructive" />
                      </div>
                    )}
                  </>
                )}

                {/* Task indicators - per-week lane assignment so all tasks render */}
                {showOverlay && (() => {
                  const visibleLanes = isMobile ? lanes.slice(0, Math.max(weekLaneCount, 0)) : lanes;
                  return (
                    <div className={`flex w-full flex-col items-stretch gap-0.5 ${isMobile ? '' : 'min-h-[5.5rem] px-0.5'}`}>
                      {visibleLanes.map((task, laneIdx) => {
                        if (!task) {
                          return <div key={`empty-${laneIdx}`} className={isMobile ? 'h-4 w-auto self-stretch' : 'h-4'} />;
                        }
                        const continueFromPrev = isTaskContinuingFromPrevDay(task, dayIdx);
                        const continueToNext = isTaskContinuingToNextDay(task, dayIdx);
                        const taskStart = parseLocalDate(task.start_date);
                        const isTaskStart = isSameDay(day, taskStart);
                        const isRestartDay = isMobile ? getDay(day) === 1 : getDay(day) === 0;
                        const showTaskName = isTaskStart || (isRestartDay && !isTaskStart && continueFromPrev);
                        const span = getForwardSpanInWeek(task, dayIdx);

                        return (
                          <div
                            key={task.id}
                            className={`relative flex items-center ${isMobile ? 'h-4 w-auto self-stretch overflow-visible' : 'h-4 overflow-hidden'}`}
                            style={{
                              backgroundColor: task.color,
                              marginLeft: isMobile ? (continueFromPrev ? '-6px' : '0px') : (continueFromPrev ? '-2px' : '2px'),
                              marginRight: isMobile ? (continueToNext ? '-6px' : '0px') : (continueToNext ? '-2px' : '2px'),
                              borderRadius: `${continueFromPrev ? '0' : '2px'} ${continueToNext ? '0' : '2px'} ${continueToNext ? '0' : '2px'} ${continueFromPrev ? '0' : '2px'}`
                            }}
                          >
                            {showTaskName && (
                              isMobile ? (
                                <span
                                  className="pointer-events-none absolute left-0 top-0 flex h-full items-center overflow-hidden whitespace-nowrap pl-1 text-[10px] font-medium leading-none text-white"
                                  style={{
                                    zIndex: 5,
                                    width: `calc(${span} * 100% + ${(span - 1) * 16}px)`,
                                  }}
                                >
                                  {task.name}
                                </span>
                              ) : (
                                <span className="truncate whitespace-nowrap pl-1 text-[11px] font-medium leading-none text-white">
                                  {task.name}
                                </span>
                              )
                            )}
                          </div>
                        );
                      })}
                      {overflow > 0 && !isMobile && (
                        <span className="text-center text-[10px] text-muted-foreground">+{overflow}</span>
                      )}
                    </div>
                  );
                })()}


                {/* Sub availability overlay indicators - bordered chips */}
                {subsWithAvail.length > 0 && (
                  <div className={`flex flex-col items-stretch gap-0.5 overflow-hidden ${isMobile ? 'pt-1' : 'mt-auto items-center px-1 pt-2'}`}>
                    {isMobile ? (
                      subsWithAvail.map((sub, i) => (
                        <span
                          key={i}
                          className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded border border-border bg-card/80 px-1 py-0.5 text-[10px] whitespace-nowrap"
                        >
                          <span className="flex-1 truncate font-medium text-foreground/90">{sub.subName}</span>
                          <span className="text-muted-foreground">({sub.employeeCount})</span>
                        </span>
                      ))
                    ) : (
                      <>
                        {subsWithAvail.slice(0, 5).map((sub, i) => (
                          <span
                            key={i}
                            className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-card/80 px-1.5 py-0.5 text-[11px]"
                          >
                            <span className="truncate font-medium text-foreground/90 max-w-[90px]">{sub.subName}</span>
                            <span className="text-muted-foreground">({sub.employeeCount})</span>
                          </span>
                        ))}
                        {subsWithAvail.length > 5 && (
                          <span className="text-[10px] text-muted-foreground">+{subsWithAvail.length - 5} more</span>
                        )}
                      </>
                    )}
                  </div>
                )}


              </button>
            );
          })}
        </div>

        {/* Confirm button - shows when dates are selected */}
        {selectedDates.length > 0 && (
          <div className="mt-4 flex items-center justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm text-muted-foreground">
              {t('calendar.datesSelected', { count: String(selectedDates.length) })}
            </span>
            <Button size="sm" onClick={handleConfirmMultiSelect}>
              {t('calendar.confirmSelection')}
            </Button>
          </div>
        )}

        {/* Task overlay bars */}
        {showOverlay && tasks.length > 0 && (
          <div className="mt-4 space-y-1">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">{t('calendar.activeTasks')}</h4>
            {tasks.slice(0, 5).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 text-sm"
              >
                <div
                  className="h-2 flex-1 rounded-full opacity-60"
                  style={{ backgroundColor: task.color }}
                />
                <span className="text-xs text-muted-foreground truncate max-w-24">
                  {task.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CalendarPanel;
