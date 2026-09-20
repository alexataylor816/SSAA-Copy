import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { format, isWithinInterval, isSameDay, subDays, getISOWeek, getISOWeekYear } from 'date-fns';

// Parse date string as local date (avoids UTC conversion issues with parseISO)
const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};
import { Pencil, Clock, Upload, X, Image as ImageIcon, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ScheduleImageGallery, { resolveImageUrl } from '@/components/dashboard/ScheduleImageGallery';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import UnassignedAssignmentDialog, { UnassignedPair } from './UnassignedAssignmentDialog';
import RejectRequestDialog from './RejectRequestDialog';
import EditReasonDialog from './EditReasonDialog';
import { useToast } from '@/hooks/use-toast';

interface Employee {
  id: string;
  name: string;
  company_id: string;
  job_title?: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface Company {
  id: string;
  name: string;
  trade?: string | null;
}

interface Availability {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  all_projects: boolean;
  stop_number?: number | null;
  stop_label?: string | null;
}

interface ScheduleRequest {
  id: string;
  project_id: string;
  sub_company_id: string;
  requesting_company_id: string;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  status: string | null;
  edited?: boolean;
  employee_ids?: string[];
  image_urls?: string[];
  original_employee_ids?: string[];
  edit_reason?: string | null;
  original_start_time?: string | null;
  original_end_time?: string | null;
  last_edited_by_company_id?: string | null;
  intermediary_company_id?: string | null;
  cancelled_by_company_id?: string | null;
  cancellation_reason?: string | null;
  guest_gc_company_name?: string | null;
  guest_gc_project_name?: string | null;
  sub_assigned?: boolean;
  silent_assignment?: boolean;
  created_at?: string;
}

interface Task {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
}

interface StopTime {
  start: string;
  end: string;
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  selectedDates: Date[];
  viewMode: 'gc' | 'sub' | 'moa';
  employees: Employee[];
  projects: Project[];
  allProjectsList?: Project[];
  availabilities: Availability[];
  connectedSubCompanies: Company[];
  /** sub-of-sub company id -> main subcontractor company id sitting between them and the GC. */
  subParentByCompanyId?: Record<string, string>;
  allEmployees: Employee[];
  scheduleRequests?: ScheduleRequest[];
  allScheduleRequests?: ScheduleRequest[];
  tasks?: Task[];
  confirmedEmployeeIds?: string[];
  requestingCompanyId?: string;
  currentSelectedProject?: string;
  isGuestGC?: boolean;
  guestCompanyName?: string;
  readOnly?: boolean;
  canActOnRequests?: boolean;
  isHistoricalLock?: boolean;
  onScheduleGC: (data: {
    subCompanyIds: string[];
    employeeIds: string[];
    startTime: string;
    endTime: string;
    description: string;
    notifyEmail: boolean;
    notifyText: boolean;
    dates: Date[];
    selectedStops?: { employeeId: string; stopNumber: number; startTime: string; endTime: string }[];
    imageUrls?: string[];
    projectId?: string;
    guestGcCompanyName?: string;
    guestGcProjectName?: string;
  }) => void;
  onScheduleSub: (data: {
    employeeIds: string[];
    startTime: string;
    endTime: string;
    projectIds: string[];
    allProjects: boolean;
    dates: Date[];
    stops?: Array<{ startTime: string; endTime: string; stopNumber: number; stopLabel: string }>;
    assignedProjectIdsByEmployee?: Record<string, string[]>;
  }) => void;
  onRemoveAvailability: (employeeId: string, dates?: Date[]) => void;
  onApproveRequest?: (requestId: string) => void;
  onRejectRequest?: (requestId: string, reason?: string) => void;
  onCancelRequest?: (requestId: string, reason?: string) => void;
  onEditPendingRequestRemoveEmployee?: (requestId: string, employeeId: string) => void;
  onEditConfirmedRequest?: (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => void;
  onEditConfirmedRequestForAllDates?: (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => void;
  onEditGCRequest?: (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => void;
  onEditGCRequestForAllDates?: (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => void;
  onAcknowledgeEdit?: (requestId: string, editReason?: string) => void;
  onAcknowledgeRejection?: (requestId: string) => void;
  onSubEditAndResend?: (requestId: string, employeeIds: string[], editReason?: string, employeeStops?: Record<string, string[]>) => void;
  onSubEditAndResendForAllDates?: (requestId: string, employeeIds: string[], editReason?: string, employeeStops?: Record<string, string[]>) => void;
  onSubAssign?: (data: {
    employeeIds: string[];
    startTime: string;
    endTime: string;
    dates: Date[];
    notifyGC: boolean;
    notifyPersonnelEmail?: boolean;
    notifyPersonnelSms?: boolean;
    projectId: string;
  }) => void;
  onNotifyPersonnel?: (requestId: string) => void;
  hasPartialOrHigher?: boolean;
  employeeProjectAssignments?: { employee_id: string; project_id: string }[];
  /** True while the personnel roster / availability are still loading. */
  rosterLoading?: boolean;
};

const DURATION_OPTIONS = [
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '1 hr 20 min', value: 80 },
  { label: '1 hr 30 min', value: 90 },
  { label: '1 hr 45 min', value: 105 },
  { label: '2 hours', value: 120 },
  { label: '2 hr 30 min', value: 150 },
  { label: '3 hours', value: 180 },
  { label: '3 hr 30 min', value: 210 },
  { label: '4 hours', value: 240 },
  { label: '4 hr 30 min', value: 270 },
  { label: '5 hours', value: 300 },
  { label: '6 hours', value: 360 },
  { label: '7 hours', value: 420 },
  { label: '8 hours', value: 480 },
  { label: '9 hours', value: 540 },
  { label: '10 hours', value: 600 },
  { label: '12 hours', value: 720 },
  { label: '14 hours', value: 840 },
  { label: '16 hours', value: 960 },
  { label: '18 hours', value: 1080 },
  { label: '20 hours', value: 1200 },
  { label: '24 hours', value: 1440 },
];

const STOP_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_STOPS = 30;

const ScheduleModal = ({
  isOpen,
  onClose,
  selectedDate,
  selectedDates,
  viewMode,
  employees,
  projects,
  allProjectsList,
  availabilities,
  connectedSubCompanies,
  subParentByCompanyId = {},
  allEmployees,
  scheduleRequests = [],
  allScheduleRequests = [],
  tasks = [],
  confirmedEmployeeIds = [],
  requestingCompanyId,
  currentSelectedProject = 'master',
  isGuestGC = false,
  guestCompanyName = '',
  readOnly: _readOnly = false,
  canActOnRequests = true,
  onScheduleGC,
  onScheduleSub,
  onRemoveAvailability,
  onApproveRequest,
  onRejectRequest,
  onCancelRequest,
  onEditPendingRequestRemoveEmployee,
  onEditConfirmedRequest,
  onEditConfirmedRequestForAllDates,
  onEditGCRequest,
  onEditGCRequestForAllDates,
  onAcknowledgeEdit,
  onAcknowledgeRejection,
  onSubEditAndResend,
  onSubEditAndResendForAllDates,
  onSubAssign,
  onNotifyPersonnel,
  hasPartialOrHigher = false,
  employeeProjectAssignments = [],
  rosterLoading = false,

  isHistoricalLock = false
}: ScheduleModalProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const readOnly = _readOnly || (isHistoricalLock && viewMode !== 'moa');
  // Approve / edit / reject / acknowledge on schedule requests require
  // Level 3 (partial), Level 4 (full), or Main Company Account Holder.
  const canAct = !readOnly && canActOnRequests;
  const [gcStartTime, setGcStartTime] = useState('08:00');
  const [gcEndTime, setGcEndTime] = useState('17:00');
  const [description, setDescription] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyText, setNotifyText] = useState(false);
  const [selectedSubCompanies, setSelectedSubCompanies] = useState<string[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [subStartTime, setSubStartTime] = useState('05:00');
  const [subEndTime, setSubEndTime] = useState('13:00');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [hasLoadedTimes, setHasLoadedTimes] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [editReasonOpen, setEditReasonOpen] = useState(false);
  const [editReasonMode, setEditReasonMode] = useState<'single' | 'all-dates'>('single');
  const [pendingEditAction, setPendingEditAction] = useState<((reason?: string) => void) | null>(null);
  const [editingEmployeeIds, setEditingEmployeeIds] = useState<string[]>([]);
  const [editingGCRequestId, setEditingGCRequestId] = useState<string | null>(null);
  const [editingGCEmployeeIds, setEditingGCEmployeeIds] = useState<string[]>([]);
  const [removedEmployeeIds, setRemovedEmployeeIds] = useState<string[]>([]);
  const [editStartTime, setEditStartTime] = useState('08:00');
  const [editEndTime, setEditEndTime] = useState('17:00');
  
  // Sub Edit & Resend State for pending requests
  const [editingPendingRequestId, setEditingPendingRequestId] = useState<string | null>(null);
  const [editingPendingEmployeeIds, setEditingPendingEmployeeIds] = useState<string[]>([]);
  // Per-employee stop selection while editing a pending request: employee_id -> availability ids.
  const [editingPendingStops, setEditingPendingStops] = useState<Record<string, string[]>>({});

  // Sub Assign State
  const [assignEmployees, setAssignEmployees] = useState<string[]>([]);
  const [assignStartTime, setAssignStartTime] = useState('08:00');
  const [assignEndTime, setAssignEndTime] = useState('17:00');
  const [assignNotifyGC, setAssignNotifyGC] = useState(true);
  const [assignNotifyEmail, setAssignNotifyEmail] = useState(true);
  const [assignNotifyText, setAssignNotifyText] = useState(false);
  const [assignNotifyPersonnelEmail, setAssignNotifyPersonnelEmail] = useState(false);
  const [assignNotifyPersonnelSms, setAssignNotifyPersonnelSms] = useState(false);
  const [assignSelectedProjectId, setAssignSelectedProjectId] = useState<string>('');
  const [personnelDropdownOpen, setPersonnelDropdownOpen] = useState(false);

  // Multiple Stops State
  const [multipleStopsEnabled, setMultipleStopsEnabled] = useState(false);
  const [numberOfStops, setNumberOfStops] = useState<number>(1);
  const [customStopCount, setCustomStopCount] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [stopTimes, setStopTimes] = useState<StopTime[]>([{ start: '05:00', end: '06:00' }]);
  const [useRecurringDuration, setUseRecurringDuration] = useState(false);
  const [recurringDuration, setRecurringDuration] = useState<number>(30);
  const [recurringStartTime, setRecurringStartTime] = useState('05:00');
  const [stopCountError, setStopCountError] = useState<string | null>(null);

  // GC Stop Selection State
  const [selectedStops, setSelectedStops] = useState<{ employeeId: string; stopNumber: number; startTime: string; endTime: string; date?: string; availabilityId?: string }[]>([]);

  // Image Upload State (GC)
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploadedImagePreviews, setUploadedImagePreviews] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GC Project Selection for Master Schedule
  const [gcSelectedProjectId, setGcSelectedProjectId] = useState<string>('');

  // Guest GC fields
  const [guestGcCompanyName, setGuestGcCompanyName] = useState('');
  const [guestGcProjectName, setGuestGcProjectName] = useState('');

  // Edit mode for availability (Sub view)
  const [isEditingAvailability, setIsEditingAvailability] = useState(false);
  const [selectedDaysPerEmployee, setSelectedDaysPerEmployee] = useState<Record<string, string[]>>({});

  // Unassigned-pair confirmation dialog state (sub availability cross-project guard)
  const [unassignedDialogOpen, setUnassignedDialogOpen] = useState(false);
  const [unassignedPairs, setUnassignedPairs] = useState<UnassignedPair[]>([]);
  const [pendingSubmit, setPendingSubmit] = useState<(() => void) | null>(null);

  // Cancel confirmation dialog state
  const [cancelConfirmRequestId, setCancelConfirmRequestId] = useState<string | null>(null);
  const [cancelConfirmGroupIds, setCancelConfirmGroupIds] = useState<string[] | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Confirmation dialog for "Remove Availability" bulk action (Sub side)
  const [removeAvailConfirmOpen, setRemoveAvailConfirmOpen] = useState(false);

  // Editing a grouped (multi-request) confirmed card as a single unit
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupReqIds, setEditingGroupReqIds] = useState<string[]>([]);

  // Copy Last Week's Availability State
  const [copyWeeksMode, setCopyWeeksMode] = useState<'none' | 'last_one' | 'last_n'>('none');
  const [lastWeekHasAvailability, setLastWeekHasAvailability] = useState(false);
  const [lastWeekAvailabilities, setLastWeekAvailabilities] = useState<any[]>([]);
  const [lastNWeeksHasAvailability, setLastNWeeksHasAvailability] = useState(false);
  const [lastNWeeksAvailabilities, setLastNWeeksAvailabilities] = useState<any[]>([]);

  // Compute number of weeks spanned by selected dates
  const numberOfWeeksSelected = (() => {
    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    if (datesToCheck.length === 0) return 1;
    const weekKeys = new Set(datesToCheck.map(d => `${getISOWeekYear(d)}-${getISOWeek(d)}`));
    return Math.max(1, weekKeys.size);
  })();

  // Quick Selection State (GC)
  const [quickSelectSub, setQuickSelectSub] = useState<string>('');
  const [quickSelectCounts, setQuickSelectCounts] = useState<Record<string, number>>({});
  // Historical roster (most recent first) for the currently chosen quick-select sub on this project
  const [historicalEmployeeIds, setHistoricalEmployeeIds] = useState<string[]>([]);

  const isGCView = viewMode === 'gc' || viewMode === 'moa';
  const isMasterSchedule = currentSelectedProject === 'master';

  // Effective project id for Quick Selection history lookup
  const quickSelectProjectId = isMasterSchedule ? gcSelectedProjectId : currentSelectedProject;

  // Load historical confirmed roster (most-recent first) for the chosen quick-select sub on this project.
  // Used to prioritize personnel who were last on this exact job site for this exact subcontractor.
  useEffect(() => {
    let cancelled = false;
    if (!quickSelectSub || !quickSelectProjectId || quickSelectProjectId === 'master') {
      setHistoricalEmployeeIds([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('schedule_requests')
        .select('employee_ids, scheduled_date')
        .eq('project_id', quickSelectProjectId)
        .eq('sub_company_id', quickSelectSub)
        .eq('status', 'confirmed')
        .order('scheduled_date', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error || !data) {
        setHistoricalEmployeeIds([]);
        return;
      }
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const row of data as { employee_ids: string[] | null }[]) {
        for (const id of row.employee_ids || []) {
          if (id && !seen.has(id)) {
            seen.add(id);
            ordered.push(id);
          }
        }
      }
      setHistoricalEmployeeIds(ordered);
    })();
    return () => { cancelled = true; };
  }, [quickSelectSub, quickSelectProjectId]);


  // Check if an employee is already scheduled (confirmed) by another GC
  const isEmployeeScheduled = (empId: string) => {
    return confirmedEmployeeIds.includes(empId);
  };

  // Get the project name for a scheduled employee (resolves cross-project via allProjectsList)
  const getScheduledProjectName = (empId: string) => {
    const datesToCheck = selectedDates.length > 0
      ? selectedDates.map(d => format(d, 'yyyy-MM-dd'))
      : selectedDate ? [format(selectedDate, 'yyyy-MM-dd')] : [];

    const confirmedRequest = allScheduleRequests.find(r =>
      r.status === 'confirmed' &&
      (r.employee_ids || []).includes(empId) &&
      (datesToCheck.length === 0 || datesToCheck.includes(r.scheduled_date))
    );

    if (confirmedRequest) {
      const project = projects.find(p => p.id === confirmedRequest.project_id)
        ?? allProjectsList?.find(p => p.id === confirmedRequest.project_id);
      return project?.name
        ?? confirmedRequest.guest_gc_project_name
        ?? 'Scheduled';
    }
    return 'Scheduled';
  };

  // Sub-of-sub handling: a GC selects the main subcontractor, and that selection
  // also covers the personnel of any sub-of-sub sitting under it.
  const listedSubIds = new Set(connectedSubCompanies.map(c => c.id));
  const childSubIdsByMain: Record<string, string[]> = {};
  Object.entries(subParentByCompanyId).forEach(([childId, parentId]) => {
    if (!parentId || childId === parentId) return;
    if (!listedSubIds.has(parentId)) return;
    (childSubIdsByMain[parentId] ||= []).push(childId);
  });
  const childSubIds = new Set(Object.values(childSubIdsByMain).flat());
  /** Only main subcontractors are selectable; sub-of-subs are folded into their main sub. */
  const selectableSubCompanies = connectedSubCompanies.filter(c => !childSubIds.has(c.id));
  const expandSubIds = (ids: string[]) => {
    const out = new Set<string>();
    ids.forEach(id => {
      out.add(id);
      (childSubIdsByMain[id] || []).forEach(childId => out.add(childId));
    });
    return out;
  };

  // Check if a sub (or one of its sub-of-subs) has available employees
  const subHasAvailability = (subId: string) => {
    const ids = expandSubIds([subId]);
    return allEmployees.some(emp =>
      ids.has(emp.company_id) &&
      availabilities.some(a => a.employee_id === emp.id)
    );
  };

  // Get tasks that overlap with selected date(s)
  const getOverlappingTasks = () => {
    if (!selectedDate && selectedDates.length === 0) return [];
    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    
    return tasks.filter(task => {
      const start = parseLocalDate(task.start_date);
      const end = parseLocalDate(task.end_date);
      return datesToCheck.some(d => 
        isWithinInterval(d, { start, end }) || isSameDay(d, start) || isSameDay(d, end)
      );
    });
  };

  // Check if a specific stop is booked (confirmed)
  const isStopBooked = (empId: string, stopNumber: number) => {
    // Get availability for this employee and stop
    const stopAvail = availabilities.find(a => 
      a.employee_id === empId && a.stop_number === stopNumber
    );
    if (!stopAvail) return false;

    // Check if there's a confirmed schedule request that overlaps with this stop's time
    return scheduleRequests.some(req => {
      if (req.status !== 'confirmed') return false;
      if (!(req.employee_ids || []).includes(empId)) return false;
      
      // Check if the request time matches this stop's time
      const stopStart = format(new Date(stopAvail.start_time), 'HH:mm');
      const stopEnd = format(new Date(stopAvail.end_time), 'HH:mm');
      return req.start_time === stopStart && req.end_time === stopEnd;
    });
  };

  // Generate stop times based on recurring duration
  const generateStopTimes = (numStops: number, startTime: string, duration: number) => {
    const times: StopTime[] = [];
    const [hours, minutes] = startTime.split(':').map(Number);
    let currentMinutes = hours * 60 + minutes;

    for (let i = 0; i < numStops; i++) {
      const startH = Math.floor(currentMinutes / 60);
      const startM = currentMinutes % 60;
      const endMinutes = currentMinutes + duration;
      const endH = Math.floor(endMinutes / 60);
      const endM = endMinutes % 60;

      times.push({
        start: `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`,
        end: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
      });

      currentMinutes = endMinutes;
    }

    return times;
  };

  // Update stop times when recurring settings change
  useEffect(() => {
    if (useRecurringDuration && multipleStopsEnabled) {
      const newTimes = generateStopTimes(numberOfStops, recurringStartTime, recurringDuration);
      setStopTimes(newTimes);
    }
  }, [useRecurringDuration, recurringStartTime, recurringDuration, numberOfStops, multipleStopsEnabled]);

  // Update stop times array when number of stops changes
  useEffect(() => {
    if (multipleStopsEnabled) {
      setStopTimes(prev => {
        const newTimes = [...prev];
        while (newTimes.length < numberOfStops) {
          const lastTime = newTimes[newTimes.length - 1];
          if (lastTime) {
            newTimes.push({ start: lastTime.end, end: lastTime.end });
          } else {
            newTimes.push({ start: '05:00', end: '06:00' });
          }
        }
        return newTimes.slice(0, numberOfStops);
      });
    }
  }, [numberOfStops, multipleStopsEnabled]);

  // On modal open (Sub view): initialize all checkboxes UNCHECKED.
  // Existing availability is still displayed (read-only) below each unchecked row.
  // Checking a row enables editing for that employee. Time defaults are loaded
  // from the first existing availability so bulk-edit fields have a sensible starting value.
  useEffect(() => {
    if (isOpen && !isGCView) {
      if (!hasLoadedTimes) {
        // Always start with no employees selected
        setSelectedEmployees([]);

        if (availabilities.length > 0) {
          // Detect multi-stop pattern from existing availability to seed defaults
          const hasStops = availabilities.some(a => a.stop_number !== null && a.stop_number !== undefined);
          if (hasStops) {
            setMultipleStopsEnabled(true);
            const stopNumbers = [...new Set(availabilities
              .filter(a => a.stop_number !== null && a.stop_number !== undefined)
              .map(a => a.stop_number as number)
            )].sort((a, b) => a - b);

            setNumberOfStops(stopNumbers.length);

            const loadedTimes: StopTime[] = stopNumbers.map(stopNum => {
              const avail = availabilities.find(a => a.stop_number === stopNum);
              if (avail) {
                return {
                  start: format(new Date(avail.start_time), 'HH:mm'),
                  end: format(new Date(avail.end_time), 'HH:mm')
                };
              }
              return { start: '05:00', end: '06:00' };
            });
            setStopTimes(loadedTimes);
          } else {
            const firstAvail = availabilities[0];
            if (firstAvail) {
              try {
                const startDate = new Date(firstAvail.start_time);
                const endDate = new Date(firstAvail.end_time);
                setSubStartTime(format(startDate, 'HH:mm'));
                setSubEndTime(format(endDate, 'HH:mm'));
              } catch (e) {
                // Keep default times if parsing fails
              }
            }
          }
        }
        // Enter edit mode immediately so checkbox interactions are honored
        setIsEditingAvailability(true);
        setHasLoadedTimes(true);
      }
    }
  }, [isOpen, availabilities, isGCView, hasLoadedTimes]);

  // Reset hasLoadedTimes when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasLoadedTimes(false);
      setEditingRequestId(null);
      setEditingEmployeeIds([]);
      setEditingGCRequestId(null);
      setEditingGCEmployeeIds([]);
      setEditingPendingRequestId(null);
      setEditingPendingEmployeeIds([]);
      setMultipleStopsEnabled(false);
      setNumberOfStops(1);
      setShowCustomInput(false);
      setCustomStopCount('');
      setStopCountError(null);
      setUseRecurringDuration(false);
      setSelectedStops([]);
      setUploadedImages([]);
      setIsUploading(false);
      setGcSelectedProjectId('');
      setIsEditingAvailability(false);
      setSelectedDaysPerEmployee({});
      setQuickSelectSub('');
      setQuickSelectCounts({});
      setRemovedEmployeeIds([]);
      setEditStartTime('08:00');
      setEditEndTime('17:00');
      setCopyWeeksMode('none');
      setAssignEmployees([]);
      setAssignStartTime('08:00');
      setAssignEndTime('17:00');
      setAssignNotifyGC(true);
      setAssignNotifyEmail(true);
      setAssignNotifyText(false);
      setAssignNotifyPersonnelEmail(false);
      setAssignNotifyPersonnelSms(false);
      setAssignSelectedProjectId('');
      setPersonnelDropdownOpen(false);
      setCancelConfirmRequestId(null);
      setCancelConfirmGroupIds(null);
      setCancelReason('');
      setLastWeekHasAvailability(false);
      setLastWeekAvailabilities([]);
      setLastNWeeksHasAvailability(false);
      setLastNWeeksAvailabilities([]);
      setGuestGcCompanyName(guestCompanyName || '');
      setGuestGcProjectName('');
    }
  }, [isOpen]);

  // Check if last week had availability for the selected dates
  useEffect(() => {
    if (!isOpen || isGCView || selectedDates.length === 0 && !selectedDate) {
      setLastWeekHasAvailability(false);
      return;
    }

    const checkLastWeek = async () => {
      const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
      if (datesToCheck.length === 0) return;

      // Get the employee IDs for this company
      const empIds = employees.map(e => e.id);
      if (empIds.length === 0) {
        setLastWeekHasAvailability(false);
        setLastNWeeksHasAvailability(false);
        return;
      }

      // Calculate last week's corresponding dates (always -7 days)
      const lastWeekDates = datesToCheck.map(d => {
        const lw = subDays(d, 7);
        return `${lw.getFullYear()}-${String(lw.getMonth() + 1).padStart(2, '0')}-${String(lw.getDate()).padStart(2, '0')}`;
      });

      // Build date range for last-1-week query
      const sortedLW = [...lastWeekDates].sort();
      const minDateLW = sortedLW[0];
      const maxDateLW = sortedLW[sortedLW.length - 1];

      const { data: lwData, error: lwError } = await supabase
        .from('availability')
        .select('*')
        .in('employee_id', empIds)
        .gte('start_time', `${minDateLW}T00:00:00Z`)
        .lte('start_time', `${maxDateLW}T23:59:59Z`);

      if (lwError || !lwData || lwData.length === 0) {
        setLastWeekHasAvailability(false);
        setLastWeekAvailabilities([]);
      } else {
        const filtered = lwData.filter(a => {
          const aDate = new Date(a.start_time);
          const dateStr = `${aDate.getUTCFullYear()}-${String(aDate.getUTCMonth() + 1).padStart(2, '0')}-${String(aDate.getUTCDate()).padStart(2, '0')}`;
          return lastWeekDates.includes(dateStr);
        });
        setLastWeekHasAvailability(filtered.length > 0);
        setLastWeekAvailabilities(filtered);
      }

      // If multi-week, also fetch N-weeks-back data
      const nWeeks = numberOfWeeksSelected;
      if (nWeeks > 1) {
        // Group selected dates by ISO week, sorted chronologically
        const weekGroups: Map<string, Date[]> = new Map();
        const sorted = [...datesToCheck].sort((a, b) => a.getTime() - b.getTime());
        sorted.forEach(d => {
          const key = `${getISOWeekYear(d)}-${getISOWeek(d)}`;
          if (!weekGroups.has(key)) weekGroups.set(key, []);
          weekGroups.get(key)!.push(d);
        });

        const weekKeys = [...weekGroups.keys()];
        // For each week group, look back 7 * (groupIndex + 1) days
        const nWeekDates: string[] = [];
        const nWeekDateMap: Map<string, string> = new Map(); // target date -> source date
        weekKeys.forEach((weekKey, groupIndex) => {
          const daysBack = 7 * (groupIndex + 1);
          weekGroups.get(weekKey)!.forEach(d => {
            const src = subDays(d, daysBack);
            const srcStr = `${src.getFullYear()}-${String(src.getMonth() + 1).padStart(2, '0')}-${String(src.getDate()).padStart(2, '0')}`;
            nWeekDates.push(srcStr);
            const targetStr = format(d, 'yyyy-MM-dd');
            nWeekDateMap.set(targetStr, srcStr);
          });
        });

        const sortedNW = [...nWeekDates].sort();
        const minDateNW = sortedNW[0];
        const maxDateNW = sortedNW[sortedNW.length - 1];

        const { data: nwData, error: nwError } = await supabase
          .from('availability')
          .select('*')
          .in('employee_id', empIds)
          .gte('start_time', `${minDateNW}T00:00:00Z`)
          .lte('start_time', `${maxDateNW}T23:59:59Z`);

        if (nwError || !nwData || nwData.length === 0) {
          setLastNWeeksHasAvailability(false);
          setLastNWeeksAvailabilities([]);
        } else {
          const uniqueNWDates = new Set(nWeekDates);
          const filtered = nwData.filter(a => {
            const aDate = new Date(a.start_time);
            const dateStr = `${aDate.getUTCFullYear()}-${String(aDate.getUTCMonth() + 1).padStart(2, '0')}-${String(aDate.getUTCDate()).padStart(2, '0')}`;
            return uniqueNWDates.has(dateStr);
          });
          setLastNWeeksHasAvailability(filtered.length > 0);
          setLastNWeeksAvailabilities(filtered);
        }
      } else {
        setLastNWeeksHasAvailability(false);
        setLastNWeeksAvailabilities([]);
      }
    };

    checkLastWeek();
  }, [isOpen, isGCView, selectedDates, selectedDate, employees, numberOfWeeksSelected]);

  // Handle copy weeks mode change
  const handleCopyWeeks = (mode: 'none' | 'last_one' | 'last_n') => {
    setCopyWeeksMode(mode);
    if (mode === 'none') return;

    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    const sourceAvailabilities = mode === 'last_one' ? lastWeekAvailabilities : lastNWeeksAvailabilities;
    
    // Build source availability lookup by date string
    const sourceByDate: Record<string, any[]> = {};
    sourceAvailabilities.forEach(a => {
      const d = new Date(a.start_time);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      if (!sourceByDate[dateStr]) sourceByDate[dateStr] = [];
      sourceByDate[dateStr].push(a);
    });

    // Build week groups for N-weeks mode
    const sorted = [...datesToCheck].sort((a, b) => a.getTime() - b.getTime());
    const weekGroups: Map<string, Date[]> = new Map();
    sorted.forEach(d => {
      const key = `${getISOWeekYear(d)}-${getISOWeek(d)}`;
      if (!weekGroups.has(key)) weekGroups.set(key, []);
      weekGroups.get(key)!.push(d);
    });
    const weekKeys = [...weekGroups.keys()];

    // Map each selected date to its source date
    const daysPerEmployee: Record<string, string[]> = {};
    const allMatchedEmpIds = new Set<string>();

    datesToCheck.forEach(currentDate => {
      let daysBack = 7; // default for last_one
      if (mode === 'last_n') {
        const dateWeekKey = `${getISOWeekYear(currentDate)}-${getISOWeek(currentDate)}`;
        const groupIndex = weekKeys.indexOf(dateWeekKey);
        daysBack = 7 * (groupIndex + 1);
      }
      const sourceDate = subDays(currentDate, daysBack);
      const sourceDateStr = `${sourceDate.getFullYear()}-${String(sourceDate.getMonth() + 1).padStart(2, '0')}-${String(sourceDate.getDate()).padStart(2, '0')}`;
      const currentDateStr = format(currentDate, 'yyyy-MM-dd');

      const matchingAvails = sourceByDate[sourceDateStr];
      if (!matchingAvails || matchingAvails.length === 0) return;

      matchingAvails.forEach(a => {
        allMatchedEmpIds.add(a.employee_id);
        if (!daysPerEmployee[a.employee_id]) daysPerEmployee[a.employee_id] = [];
        if (!daysPerEmployee[a.employee_id].includes(currentDateStr)) {
          daysPerEmployee[a.employee_id].push(currentDateStr);
        }
      });
    });

    if (allMatchedEmpIds.size === 0) return;

    const validEmpIds = [...allMatchedEmpIds].filter(id => employees.some(e => e.id === id));
    setSelectedEmployees(validEmpIds);
    setIsEditingAvailability(true);
    setSelectedDaysPerEmployee(daysPerEmployee);

    // Use times from the first matched availability for default time fields
    const firstAvail = sourceAvailabilities[0];
    const hasStops = sourceAvailabilities.some(a => a.stop_number !== null && a.stop_number !== undefined);

    if (hasStops) {
      setMultipleStopsEnabled(true);
      const stopNumbers = [...new Set(sourceAvailabilities
        .filter(a => a.stop_number !== null && a.stop_number !== undefined)
        .map(a => a.stop_number as number)
      )].sort((a, b) => a - b);

      setNumberOfStops(stopNumbers.length);

      const loadedTimes: StopTime[] = stopNumbers.map(stopNum => {
        const avail = sourceAvailabilities.find(a => a.stop_number === stopNum);
        if (avail) {
          return {
            start: format(new Date(avail.start_time), 'HH:mm'),
            end: format(new Date(avail.end_time), 'HH:mm')
          };
        }
        return { start: '05:00', end: '06:00' };
      });
      setStopTimes(loadedTimes);
    } else {
      setMultipleStopsEnabled(false);
      if (firstAvail) {
        const startDate = new Date(firstAvail.start_time);
        const endDate = new Date(firstAvail.end_time);
        setSubStartTime(`${startDate.getUTCHours().toString().padStart(2, '0')}:${startDate.getUTCMinutes().toString().padStart(2, '0')}`);
        setSubEndTime(`${endDate.getUTCHours().toString().padStart(2, '0')}:${endDate.getUTCMinutes().toString().padStart(2, '0')}`);
      }
    }
  };
  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsUploading(true);
    const newImageUrls: string[] = [];
    const previewMap: Record<string, string> = {};
    
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        
        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${requestingCompanyId}/schedule-images/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('schedule-request-images')
          .upload(filePath, file);
        
        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }
        
        // Store relative path instead of public URL for private bucket
        newImageUrls.push(filePath);
        
        // Generate signed URL for preview
        const signedUrl = await resolveImageUrl(filePath);
        if (signedUrl) {
          previewMap[filePath] = signedUrl;
        }
      }
      
      setUploadedImages(prev => [...prev, ...newImageUrls]);
      setUploadedImagePreviews(prev => ({ ...prev, ...previewMap }));
    } catch (error) {
      console.error('Error uploading images:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = (urlToRemove: string) => {
    setUploadedImages(prev => prev.filter(url => url !== urlToRemove));
  };

  const handleStopCountChange = (value: string) => {
    setStopCountError(null);
    if (value === 'other') {
      setShowCustomInput(true);
      setCustomStopCount('');
    } else {
      setShowCustomInput(false);
      const num = parseInt(value);
      setNumberOfStops(num);
      // Auto-calculate duration based on 8-hour work day
      autoCalculateDuration(num);
    }
  };

  // Auto-calculate duration per stop based on an 8-hour work day
  const autoCalculateDuration = (numStops: number) => {
    if (numStops <= 0) return;
    const totalMinutes = 480; // 8 hours
    const durationPerStop = Math.floor(totalMinutes / numStops);
    // Find the closest DURATION_OPTIONS value
    const closest = DURATION_OPTIONS.reduce((prev, curr) => 
      Math.abs(curr.value - durationPerStop) < Math.abs(prev.value - durationPerStop) ? curr : prev
    );
    setRecurringDuration(closest.value);
    // Auto-enable recurring duration so it takes effect
    setUseRecurringDuration(true);
  };

  const handleCustomStopCountChange = (value: string) => {
    setCustomStopCount(value);
    setStopCountError(null);
    const num = parseInt(value);
    if (!isNaN(num)) {
      if (num > MAX_STOPS) {
        setStopCountError(`Sorry, our cut-off is ${MAX_STOPS} stops. If you need more stops, please reach out to customer service.`);
      } else if (num > 0) {
        setNumberOfStops(num);
        autoCalculateDuration(num);
      }
    }
  };

  const handleStopTimeChange = (index: number, field: 'start' | 'end', value: string) => {
    // When a user manually edits a stop time, disable recurring duration
    if (useRecurringDuration) {
      setUseRecurringDuration(false);
    }
    setStopTimes(prev => {
      const newTimes = [...prev];
      newTimes[index] = { ...newTimes[index], [field]: value };
      return newTimes;
    });
  };

  const handleSubmit = () => {
    if (isGCView) {
      const datesToSchedule = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
      
      // Derive start/end time from selected stops if available
      let derivedStartTime = gcStartTime;
      let derivedEndTime = gcEndTime;
      if (selectedStops.length > 0) {
        const startTimes = selectedStops.map(s => s.startTime).sort();
        const endTimes = selectedStops.map(s => s.endTime).sort();
        derivedStartTime = startTimes[0];
        derivedEndTime = endTimes[endTimes.length - 1];
      }
      
      onScheduleGC({
        subCompanyIds: selectedSubCompanies,
        employeeIds: selectedEmployees,
        startTime: derivedStartTime,
        endTime: derivedEndTime,
        description,
        notifyEmail,
        notifyText,
        dates: datesToSchedule,
        selectedStops: selectedStops.length > 0 ? selectedStops : undefined,
        imageUrls: uploadedImages.length > 0 ? uploadedImages : undefined,
        projectId: isMasterSchedule ? gcSelectedProjectId : undefined,
        guestGcCompanyName: isGuestGC ? guestGcCompanyName : undefined,
        guestGcProjectName: isGuestGC ? guestGcProjectName : undefined
      });
    } else {
      const datesToSchedule = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);

      // Build a fast lookup: empId -> Set<projectId> of assignments
      const assignedMap = new Map<string, Set<string>>();
      for (const a of employeeProjectAssignments) {
        if (!assignedMap.has(a.employee_id)) assignedMap.set(a.employee_id, new Set());
        assignedMap.get(a.employee_id)!.add(a.project_id);
      }

      // Determine effective target projects for the cross-project guard.
      // "Available for all projects" must be scoped to projects the active
      // company can actually access (own + connected). `projects` is already
      // filtered for this in Dashboard.tsx (filteredProjects); `allProjectsList`
      // is the full unfiltered set used only for name resolution of cross-project
      // confirmed requests, NOT as a target source for new availability inserts.
      const effectiveProjectsList: { id: string; name: string }[] = allProjects
        ? projects.map(p => ({ id: p.id, name: p.name }))
        : selectedProjects.map(pid => {
            const p = projects.find(pp => pp.id === pid)
              ?? allProjectsList?.find(pp => pp.id === pid);
            return { id: pid, name: p?.name ?? 'Project' };
          });

      // Compute unassigned (employee, project) pairs across the entire submission.
      const pairs: UnassignedPair[] = [];
      const seen = new Set<string>();
      for (const empId of selectedEmployees) {
        const empSet = assignedMap.get(empId);
        for (const proj of effectiveProjectsList) {
          if (empSet?.has(proj.id)) continue;
          const key = `${empId}::${proj.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const emp = employees.find(e => e.id === empId)
            ?? allEmployees.find(e => e.id === empId);
          pairs.push({
            employeeId: empId,
            employeeName: emp?.name ?? 'Employee',
            jobTitle: emp?.job_title ?? null,
            projectId: proj.id,
            projectName: proj.name,
          });
        }
      }

      // Build the per-employee allowed-project map (used when pairs > 0 and on confirm).
      // - For employees with NO assignments listed: keep current behavior (all targets).
      // - For partially assigned: only their assigned subset of the targets.
      // - For fully assigned: the full target list.
      const buildAssignedMapForSubmit = (): Record<string, string[]> => {
        const out: Record<string, string[]> = {};
        for (const empId of selectedEmployees) {
          const empSet = assignedMap.get(empId);
          if (!empSet || empSet.size === 0) {
            // No assignments at all → fall back to all targets (preserve legacy behavior)
            out[empId] = effectiveProjectsList.map(p => p.id);
            continue;
          }
          const allowed = effectiveProjectsList
            .map(p => p.id)
            .filter(pid => empSet.has(pid));
          out[empId] = allowed;
        }
        return out;
      };

      // Helper: actually invoke onScheduleSub with the right shape, optionally
      // passing the per-employee filter map computed above.
      const submitSubAvailability = (assignedProjectIdsByEmployee?: Record<string, string[]>) => {
        if (isEditingAvailability && Object.keys(selectedDaysPerEmployee).length > 0) {
          for (const empId of selectedEmployees) {
            const empDays = selectedDaysPerEmployee[empId] || [];
            const empDates = empDays.length > 0
              ? empDays.map(d => parseLocalDate(d))
              : datesToSchedule;
            if (empDates.length === 0) continue;

            // Skip employees whose allowed-project set is empty (nothing to insert).
            if (assignedProjectIdsByEmployee
              && (assignedProjectIdsByEmployee[empId]?.length ?? 0) === 0
              && !allProjects) {
              continue;
            }

            if (multipleStopsEnabled) {
              const stops = stopTimes.map((time, index) => ({
                startTime: time.start,
                endTime: time.end,
                stopNumber: index + 1,
                stopLabel: `Stop #${index + 1}`
              }));
              onScheduleSub({
                employeeIds: [empId],
                startTime: stopTimes[0]?.start || subStartTime,
                endTime: stopTimes[stopTimes.length - 1]?.end || subEndTime,
                projectIds: allProjects ? [] : selectedProjects,
                allProjects,
                dates: empDates,
                stops,
                assignedProjectIdsByEmployee,
              });
            } else {
              onScheduleSub({
                employeeIds: [empId],
                startTime: subStartTime,
                endTime: subEndTime,
                projectIds: allProjects ? [] : selectedProjects,
                allProjects,
                dates: empDates,
                assignedProjectIdsByEmployee,
              });
            }
          }
        } else if (multipleStopsEnabled) {
          const stops = stopTimes.map((time, index) => ({
            startTime: time.start,
            endTime: time.end,
            stopNumber: index + 1,
            stopLabel: `Stop #${index + 1}`
          }));
          onScheduleSub({
            employeeIds: selectedEmployees,
            startTime: stopTimes[0]?.start || subStartTime,
            endTime: stopTimes[stopTimes.length - 1]?.end || subEndTime,
            projectIds: allProjects ? [] : selectedProjects,
            allProjects,
            dates: datesToSchedule,
            stops,
            assignedProjectIdsByEmployee,
          });
        } else {
          onScheduleSub({
            employeeIds: selectedEmployees,
            startTime: subStartTime,
            endTime: subEndTime,
            projectIds: allProjects ? [] : selectedProjects,
            allProjects,
            dates: datesToSchedule,
            assignedProjectIdsByEmployee,
          });
        }
      };

      const finalize = () => {
        setSelectedEmployees([]);
        setSelectedSubCompanies([]);
        setDescription('');
        setUploadedImages([]);
        setSelectedStops([]);
        setSelectedDaysPerEmployee({});
        onClose();
      };

      // Only run the cross-project guard when we actually have target projects
      // configured (sub view, allProjects OR explicit selection). With NO target
      // projects (legacy ad-hoc availability), keep the prior behavior unchanged.
      const hasTargets = effectiveProjectsList.length > 0;

      if (hasTargets && pairs.length > 0) {
        if (!hasPartialOrHigher) {
          toast({
            title: 'Permission required',
            description: "You don't have permission to assign availability for projects this employee isn't assigned to.",
            variant: 'destructive',
          });
          return;
        }
        // Defer submission until the user confirms the temporary exception.
        const filterMap = buildAssignedMapForSubmit();
        setUnassignedPairs(pairs);
        setPendingSubmit(() => () => {
          submitSubAvailability(filterMap);
          finalize();
        });
        setUnassignedDialogOpen(true);
        return;
      }

      submitSubAvailability();
    }
    setSelectedEmployees([]);
    setSelectedSubCompanies([]);
    setDescription('');
    setUploadedImages([]);
    setSelectedStops([]);
    setSelectedDaysPerEmployee({});
    onClose();
  };

  const handleSubCompanyToggle = (subId: string, checked: boolean) => {
    if (checked) {
      setSelectedSubCompanies([...selectedSubCompanies, subId]);
    } else {
      setSelectedSubCompanies(selectedSubCompanies.filter(id => id !== subId));
      const subEmployeeIds = allEmployees.filter(e => e.company_id === subId).map(e => e.id);
      setSelectedEmployees(selectedEmployees.filter(id => !subEmployeeIds.includes(id)));
    }
  };

  const handleEmployeeToggle = (empId: string, checked: boolean) => {
    if (checked) {
      setSelectedEmployees([...selectedEmployees, empId]);
      // Auto-select all available days for this employee so bulk edit/remove targets them by default
      const empDays = getEmployeeStopsByDate(empId);
      setSelectedDaysPerEmployee(prev => ({
        ...prev,
        [empId]: empDays.map(d => d.date)
      }));
    } else {
      setSelectedEmployees(selectedEmployees.filter(id => id !== empId));
      setSelectedDaysPerEmployee(prev => {
        const next = { ...prev };
        delete next[empId];
        return next;
      });
      // Note: NEVER auto-remove availability on uncheck — unchecked is the default state.
      // Removal happens only via the explicit "Remove Availability" button (with confirmation).
    }
  };

  const handleStopToggle = (employeeId: string, stopNumber: number, startTime: string, endTime: string, date: string, availabilityId: string, checked: boolean) => {
    if (checked) {
      setSelectedStops(prev => [...prev, { employeeId, stopNumber, startTime, endTime, date, availabilityId }]);
      if (!selectedEmployees.includes(employeeId)) {
        setSelectedEmployees(prev => [...prev, employeeId]);
      }
    } else {
      setSelectedStops(prev => prev.filter(s => !(s.employeeId === employeeId && s.availabilityId === availabilityId)));
    }
  };

  const handleDayToggle = (empId: string, date: string, checked: boolean) => {
    setSelectedDaysPerEmployee(prev => {
      const current = prev[empId] || [];
      if (checked) {
        return { ...prev, [empId]: [...current, date] };
      } else {
        return { ...prev, [empId]: current.filter(d => d !== date) };
      }
    });
  };

  const handleStartEdit = () => {
    setIsEditingAvailability(true);
    setSelectedEmployees([]);
    setSelectedDaysPerEmployee({});
  };

  const handleCancelEdit = () => {
    setIsEditingAvailability(false);
    // Restore pre-selected employees (those with availability)
    const availableEmployeeIds = [...new Set(availabilities.map(a => a.employee_id))];
    setSelectedEmployees(availableEmployeeIds);
    setSelectedDaysPerEmployee({});
  };

  const handleSelectAllToggle = () => {
    const nonScheduledEmployees = employees.filter(emp => !isEmployeeScheduled(emp.id));
    const allEmpIds = nonScheduledEmployees.map(e => e.id);
    
    const allSelected = allEmpIds.length > 0 && allEmpIds.every(id => selectedEmployees.includes(id));
    
    if (allSelected) {
      setSelectedEmployees([]);
      setSelectedDaysPerEmployee({});
    } else {
      setSelectedEmployees(allEmpIds);
      const allDays: Record<string, string[]> = {};
      allEmpIds.forEach(empId => {
        const stops = getEmployeeStopsByDate(empId);
        allDays[empId] = stops.map(s => s.date);
      });
      setSelectedDaysPerEmployee(allDays);
    }
  };

  const handleStartEditConfirmed = (req: ScheduleRequest) => {
    setEditingRequestId(req.id);
    setEditingEmployeeIds([]);
    setRemovedEmployeeIds([]);
    // Initialize edit times from availability data
    const empAvails = availabilities.filter(a => 
      (req.employee_ids || []).some(empId => a.employee_id === empId)
    );
    if (empAvails.length > 0) {
      const earliest = empAvails.reduce((min, a) => 
        new Date(a.start_time) < new Date(min.start_time) ? a : min
      );
      const latest = empAvails.reduce((max, a) => 
        new Date(a.end_time) > new Date(max.end_time) ? a : max
      );
      setEditStartTime(formatTimeRawFromTimestamp(earliest.start_time));
      setEditEndTime(formatTimeRawFromTimestamp(latest.end_time));
    } else if (req.start_time && req.end_time) {
      setEditStartTime(req.start_time);
      setEditEndTime(req.end_time);
    }
  };

  // Edit-reason popup: every "Confirm Changes" action routes through here so the
  // editor can optionally explain why the change was made (desktop + mobile).
  const askEditReason = (mode: 'single' | 'all-dates', action: (reason?: string) => void) => {
    setEditReasonMode(mode);
    setPendingEditAction(() => action);
    setEditReasonOpen(true);
  };

  const handleSaveEditConfirmed = (editReason?: string) => {
    if (editingRequestId && onEditConfirmedRequest) {
      const currentReq = scheduleRequests.find(r => r.id === editingRequestId);
      // Use checked employees if any are checked, otherwise fall back to original minus removed
      const remainingIds = (currentReq?.employee_ids || []).filter(id => !removedEmployeeIds.includes(id));
      // Pass checked employee IDs separately so only their availability gets updated
      const checkedIds = editingEmployeeIds.filter(id => !removedEmployeeIds.includes(id));
      onEditConfirmedRequest(editingRequestId, remainingIds, editStartTime, editEndTime, checkedIds.length > 0 ? checkedIds : undefined, editReason);
    }
    setEditingRequestId(null);
    setEditingEmployeeIds([]);
    setRemovedEmployeeIds([]);
  };

  const handleSaveEditConfirmedForAllDates = (editReason?: string) => {
    if (editingRequestId && onEditConfirmedRequestForAllDates) {
      const currentReq = scheduleRequests.find(r => r.id === editingRequestId);
      const remainingIds = (currentReq?.employee_ids || []).filter(id => !removedEmployeeIds.includes(id));
      const checkedIds = editingEmployeeIds.filter(id => !removedEmployeeIds.includes(id));
      onEditConfirmedRequestForAllDates(editingRequestId, remainingIds, editStartTime, editEndTime, checkedIds.length > 0 ? checkedIds : undefined, editReason);
    }
    setEditingRequestId(null);
    setEditingEmployeeIds([]);
    setRemovedEmployeeIds([]);
  };

  // === Grouped (multi-request) confirmed-card edit helpers ===
  const handleStartEditGroup = (groupKey: string, groupReqs: ScheduleRequest[]) => {
    setEditingGroupKey(groupKey);
    setEditingGroupReqIds(groupReqs.map(r => r.id));
    // Pre-populate with union of all employees across the group
    const allEmpIds = Array.from(new Set(groupReqs.flatMap(r => r.employee_ids || [])));
    setEditingEmployeeIds(allEmpIds);
    setRemovedEmployeeIds([]);
    // Pre-fill times from first request
    setEditStartTime(groupReqs[0].start_time || '');
    setEditEndTime(groupReqs[0].end_time || '');
    // Make sure single-edit mode is off
    setEditingRequestId(null);
  };

  const handleCancelEditGroup = () => {
    setEditingGroupKey(null);
    setEditingGroupReqIds([]);
    setEditingEmployeeIds([]);
    setRemovedEmployeeIds([]);
  };

  const handleSaveEditGroup = (editReason?: string) => {
    if (!editingGroupKey || !onEditConfirmedRequest) return;
    editingGroupReqIds.forEach(reqId => {
      const req = scheduleRequests.find(r => r.id === reqId);
      if (!req) return;
      const origIds = req.employee_ids || [];
      const remainingIds = origIds.filter(id => !removedEmployeeIds.includes(id));
      const checkedIdsForReq = editingEmployeeIds.filter(id => !removedEmployeeIds.includes(id) && origIds.includes(id));
      onEditConfirmedRequest(reqId, remainingIds, editStartTime, editEndTime, checkedIdsForReq.length > 0 ? checkedIdsForReq : undefined, editReason);
    });
    handleCancelEditGroup();
  };

  const handleSaveEditGroupForAllDates = (editReason?: string) => {
    if (!editingGroupKey || !onEditConfirmedRequestForAllDates) return;
    editingGroupReqIds.forEach(reqId => {
      const req = scheduleRequests.find(r => r.id === reqId);
      if (!req) return;
      const origIds = req.employee_ids || [];
      const remainingIds = origIds.filter(id => !removedEmployeeIds.includes(id));
      const checkedIdsForReq = editingEmployeeIds.filter(id => !removedEmployeeIds.includes(id) && origIds.includes(id));
      onEditConfirmedRequestForAllDates(reqId, remainingIds, editStartTime, editEndTime, checkedIdsForReq.length > 0 ? checkedIdsForReq : undefined, editReason);
    });
    handleCancelEditGroup();
  };

  const handleEditEmployeeToggle = (empId: string, checked: boolean) => {
    if (checked) {
      setEditingEmployeeIds([...editingEmployeeIds, empId]);
    } else {
      setEditingEmployeeIds(editingEmployeeIds.filter(id => id !== empId));
    }
  };

  if (!selectedDate && selectedDates.length === 0) return null;

  const displayDate = selectedDates.length > 0 
    ? `${selectedDates.length} dates selected`
    : selectedDate 
      ? format(selectedDate, 'EEEE, MMMM d, yyyy')
      : '';

  const pendingRequestsForDate = scheduleRequests.filter(req => req.status === 'pending');
  const confirmedRequestsForDate = scheduleRequests.filter(req => req.status === 'confirmed');
  const rejectedRequestsForDate = scheduleRequests.filter(req => 
    req.status === 'rejected' || req.status === 'cancelled' || req.status === 'canceled'
  );
  
  const sentRequestsForDate = scheduleRequests.filter(req => 
    req.status !== 'rejected' &&
    req.status !== 'cancelled' &&
    req.status !== 'canceled'
  );

  const effectiveSelectedSubIds = expandSubIds(selectedSubCompanies);
  const availableEmployeesForGC = allEmployees.filter(emp =>
    effectiveSelectedSubIds.has(emp.company_id) &&
    availabilities.some(a => a.employee_id === emp.id)
  );

  // Compute selected date strings for filtering availability to only selected dates
  const selectedDateStrings = (() => {
    const dates = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    return dates.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  })();

  // Get the date from a timestamp for grouping (moved up so it can be used by hasAvailabilityForSelectedDates)
  const getDateFromTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  };

  // Helper to check if an employee has availability for the selected date(s) specifically
  const hasAvailabilityForSelectedDates = (empId: string) => {
    if (selectedDateStrings.length === 0) return availabilities.some(a => a.employee_id === empId);
    return availabilities.some(a => {
      if (a.employee_id !== empId) return false;
      const availDate = getDateFromTimestamp(a.start_time);
      return selectedDateStrings.includes(availDate);
    });
  };

  // Check if all employees have availability set for the selected date(s)
  const allEmployeesHaveAvailability = employees.length > 0 && 
    employees.every(emp => hasAvailabilityForSelectedDates(emp.id));

  // Determine if we should show edit controls (checkboxes, time inputs, action buttons)
  // On Sub side: always show controls so the user can opt-in by checking employee rows.
  // Editable controls additionally require partial+ permission (gated at button level).
  const shouldShowEditControls = !isGCView;

  // Check if all non-scheduled employees are selected (for Select All toggle)
  const isAllEmployeesSelected = (() => {
    const nonScheduledEmployees = employees.filter(emp => !isEmployeeScheduled(emp.id));
    const allEmpIds = nonScheduledEmployees.map(e => e.id);
    return allEmpIds.length > 0 && allEmpIds.every(id => selectedEmployees.includes(id));
  })();

  // Get grouped availabilities by employee with their stops
  // Extract time from timestamp without timezone conversion
  const formatTimeFromTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const formatTimeRawFromTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
  };




  // Get day name from date string
  const getDayName = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return format(date, 'EEEE');
  };

  const getEmployeeStops = (empId: string) => {
    // The same shift is stored once per project it was saved against, so collapse
    // duplicate rows into a single entry per date + stop (or exact time range).
    const rawAvails = availabilities.filter(a => a.employee_id === empId);
    const deduped = new Map<string, typeof rawAvails[number]>();
    rawAvails.forEach(a => {
      const key = `${getDateFromTimestamp(a.start_time)}::${a.stop_number != null ? `s${a.stop_number}` : `r${a.start_time}-${a.end_time}`}`;
      const existing = deduped.get(key);
      if (!existing || a.id < existing.id) deduped.set(key, a);
    });
    const empAvails = Array.from(deduped.values());
    // Group by stop number
    const hasStops = empAvails.some(a => a.stop_number !== null && a.stop_number !== undefined);
    
    if (hasStops) {
      return empAvails
        .filter(a => a.stop_number !== null && a.stop_number !== undefined)
        .sort((a, b) => (a.stop_number || 0) - (b.stop_number || 0))
        .map(a => ({
          stopNumber: a.stop_number as number,
          stopLabel: a.stop_label || `Stop #${a.stop_number}`,
          startTime: formatTimeFromTimestamp(a.start_time),
          endTime: formatTimeFromTimestamp(a.end_time),
          startTimeRaw: formatTimeRawFromTimestamp(a.start_time),
          endTimeRaw: formatTimeRawFromTimestamp(a.end_time),
          isBooked: isStopBooked(empId, a.stop_number as number),
          date: getDateFromTimestamp(a.start_time),
          availabilityId: a.id
        }));
    } else {
      // Single availability (no stops)
      return empAvails.map((a, index) => ({
        stopNumber: 1,
        stopLabel: 'Available',
        startTime: formatTimeFromTimestamp(a.start_time),
        endTime: formatTimeFromTimestamp(a.end_time),
        startTimeRaw: formatTimeRawFromTimestamp(a.start_time),
        endTimeRaw: formatTimeRawFromTimestamp(a.end_time),
        isBooked: isEmployeeScheduled(empId),
        date: getDateFromTimestamp(a.start_time),
        availabilityId: a.id
      }));
    }
  };

  // Group stops by date for display
  const getEmployeeStopsByDate = (empId: string) => {
    const stops = getEmployeeStops(empId);
    const groupedByDate: { [date: string]: typeof stops } = {};
    
    stops.forEach(stop => {
      if (!groupedByDate[stop.date]) {
        groupedByDate[stop.date] = [];
      }
      groupedByDate[stop.date].push(stop);
    });
    
    // Sort dates
    const sortedDates = Object.keys(groupedByDate).sort();
    
    return sortedDates.map(date => ({
      date,
      dayName: getDayName(date),
      stops: groupedByDate[date]
    }));
  };

  /**
   * Selectable stops (availability blocks) for an employee on a given date.
   * Duplicate ranges saved for several projects collapse into one entry.
   */
  const getStopOptionsFor = (empId: string, dateStr: string, projectId?: string | null) => {
    const rows = availabilities.filter(a =>
      a.employee_id === empId &&
      getDateFromTimestamp(a.start_time) === dateStr &&
      (a.all_projects || !a.project_id || !projectId || a.project_id === projectId)
    );
    const seen = new Map<string, typeof rows[number]>();
    rows.forEach(a => {
      const key = a.stop_number != null ? `s${a.stop_number}` : `r${a.start_time}-${a.end_time}`;
      const existing = seen.get(key);
      if (!existing || a.id < existing.id) seen.set(key, a);
    });
    return Array.from(seen.values())
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map((a, i) => ({
        id: a.id,
        label: a.stop_label || `Stop ${a.stop_number ?? i + 1}`,
        time: `${formatTimeFromTimestamp(a.start_time)} - ${formatTimeFromTimestamp(a.end_time)}`,
      }));
  };

  const overlappingTasks = getOverlappingTasks();

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:w-full sm:max-w-2xl sm:max-h-[92vh] sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {isGCView ? t('schedule.scheduleSubcontractor') : readOnly ? t('schedule.viewAvailability') : t('schedule.setAvailability')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {displayDate}
          </p>
        </DialogHeader>

        {isHistoricalLock && viewMode !== 'moa' && (
          <div className="bg-muted border border-border rounded-md p-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t('schedule.locked')}</p>
              <p className="text-xs text-muted-foreground">{t('schedule.lockedDescription')}</p>
            </div>
          </div>
        )}

        <div className="space-y-4 pt-4">
          {isGCView ? (
            <>
              {/* Project Selector for Master Schedule (GC) */}
              {isMasterSchedule && (
                <div className="space-y-2">
                  <Label>{t('schedule.selectProject')}</Label>
                  <Select value={gcSelectedProjectId} onValueChange={setGcSelectedProjectId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder={t('schedule.chooseProjectForRequest')} />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!gcSelectedProjectId && (
                    <p className="text-xs text-muted-foreground">
                      {t('schedule.mustSelectProject')}
                    </p>
                  )}
                </div>
              )}

              {/* Show sent requests with edited badge and employee details */}
              {sentRequestsForDate.filter(r => r.status !== 'rejected').length > 0 && (
                <div className="space-y-2">
                  <Label>{t('schedule.scheduledRequests')}</Label>
                  <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                    {sentRequestsForDate
                      .filter(r => r.status !== 'rejected')
                      .map(req => {
                        const subCompany = connectedSubCompanies.find(c => c.id === req.sub_company_id);
                        const isConfirmed = req.status === 'confirmed';
                        const isDraft = req.status === 'draft';
                        const isPending = req.status === 'pending';
                        const isEdited = req.edited;
                        const isEditingThis = editingGCRequestId === req.id;
                        const isSubAssigned = req.sub_assigned;
                        
                        // Get employees assigned to this request
                        const assignedEmployees = allEmployees.filter(emp => 
                          (req.employee_ids || []).includes(emp.id)
                        );
                        
                        // Get original employees for showing changes
                        const originalEmployees = req.original_employee_ids && req.original_employee_ids.length > 0
                          ? allEmployees.filter(emp => req.original_employee_ids!.includes(emp.id))
                          : [];
                        
                        // Get all available employees from this sub for editing
                        const subAvailableEmployees = allEmployees.filter(emp => 
                          emp.company_id === req.sub_company_id &&
                          availabilities.some(a => a.employee_id === emp.id)
                        );
                        
                        return (
                          <div 
                            key={req.id} 
                            className={`text-sm p-2 rounded space-y-2 ${
                              isSubAssigned ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900' :
                              isEdited ? 'bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900' :
                              isConfirmed ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900' : 
                              isDraft ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900' :
                              'border border-border'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{subCompany?.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {format(parseLocalDate(req.scheduled_date), 'MMM d, yyyy')}
                                  </span>
                                </div>
                                {subCompany?.trade && (
                                  <span className="text-xs text-muted-foreground">({subCompany.trade})</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {isEdited && (
                                  <Badge variant="outline" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300">
                                     Edited
                                  </Badge>
                                )}
                                <Badge
                                  variant={isConfirmed ? 'default' : isDraft ? 'outline' : 'secondary'}
                                  className={isConfirmed ? 'bg-green-600 hover:bg-green-700' : ''}
                                >
                                  {isConfirmed ? 'Confirmed' : isDraft ? 'Draft' : 'Pending'}
                                </Badge>
                              </div>
                            </div>
                            
                            {/* Show created timestamp */}
                            {req.created_at && (
                              <div className="text-xs text-muted-foreground mt-1">
                                <span className="font-medium">Sent:</span> {format(new Date(req.created_at), 'MMM d, yyyy')} at {format(new Date(req.created_at), 'h:mm a')}
                              </div>
                            )}
                            
                            {/* Show original assignment (crossed out) if request was edited by Sub */}
                            {isEdited && originalEmployees.length > 0 && !isEditingThis && (
                              <div className="pl-2 border-l-2 border-gray-300 dark:border-gray-600">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Previous Assignment:</p>
                                <div className="space-y-0.5">
                                  {originalEmployees.map(emp => (
                                    <div key={emp.id} className="text-xs text-gray-400 dark:text-gray-500 line-through">
                                      {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                      {req.original_start_time && req.original_end_time && (
                                        <span className="ml-1">({req.original_start_time} - {req.original_end_time})</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Show assigned employees with per-employee times */}
                            {assignedEmployees.length > 0 && !isEditingThis && (
                              <div className="pl-2 border-l-2 border-muted-foreground/20">
                                <p className="text-xs text-muted-foreground mb-1">
                                  {isEdited ? 'New Assignment:' : 'Assigned Personnel:'}
                                </p>
                                <div className="space-y-1">
                                  {assignedEmployees.map(emp => {
                                    // Look up this employee's actual availability times for the request date
                                    const reqDateStr = req.scheduled_date;
                                    const empAvails = availabilities.filter(a => {
                                      const availDate = getDateFromTimestamp(a.start_time);
                                      return a.employee_id === emp.id && availDate === reqDateStr;
                                    });
                                    
                                    let empTimeDisplay: string | null = null;
                                    if (empAvails.length > 0) {
                                      const earliestStart = empAvails.reduce((min, a) => 
                                        new Date(a.start_time) < new Date(min.start_time) ? a : min
                                      );
                                      const latestEnd = empAvails.reduce((max, a) => 
                                        new Date(a.end_time) > new Date(max.end_time) ? a : max
                                      );
                                      empTimeDisplay = `${formatTimeFromTimestamp(earliestStart.start_time)} - ${formatTimeFromTimestamp(latestEnd.end_time)}`;
                                    } else if (req.start_time && req.end_time) {
                                      empTimeDisplay = `${req.start_time} - ${req.end_time}`;
                                    }
                                    
                                    return (
                                      <div key={emp.id} className="text-xs">
                                        <div className="flex items-center justify-between">
                                          <span>{emp.name}{emp.job_title && ` - ${emp.job_title}`}</span>
                                          {empTimeDisplay && (
                                            <span className="text-muted-foreground ml-2">{empTimeDisplay}</span>
                                          )}
                                        </div>
                                        {isSubAssigned && (
                                          <p className="text-blue-600 dark:text-blue-400 text-[10px] italic mt-0.5">
                                            The Subcontractor has assigned this additional personnel to the job for this day.
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            

                            {/* Explanation for the most recent edit */}
                            {req.edit_reason && !isEditingThis && (
                              <div className="pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                                <p className="text-xs font-medium text-foreground mb-0.5">Reason for edit:</p>
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{req.edit_reason}</p>
                              </div>
                            )}

                            {/* GC Edit mode - Checkbox + Remove/Add Back */}
                            {isEditingThis && (
                              <div className="pl-2 border-l-2 border-primary/50 space-y-2">
                                <p className="text-xs font-medium">Edit Assignment:</p>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {assignedEmployees.map(emp => {
                                    const isRemoved = removedEmployeeIds.includes(emp.id);
                                    const isChecked = editingGCEmployeeIds.includes(emp.id);
                                    return (
                                      <div key={emp.id} className="flex items-center justify-between gap-2 p-1 rounded">
                                        <div className="flex items-center gap-2">
                                          <Checkbox
                                            id={`gc-edit-emp-${emp.id}`}
                                            checked={isChecked && !isRemoved}
                                            disabled={isRemoved}
                                            onCheckedChange={(checked) => {
                                              if (checked) {
                                                setEditingGCEmployeeIds(prev => [...prev, emp.id]);
                                              } else {
                                                setEditingGCEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                              }
                                            }}
                                          />
                                          <label 
                                            htmlFor={`gc-edit-emp-${emp.id}`}
                                            className={`text-xs ${isRemoved ? 'line-through text-muted-foreground opacity-50' : ''}`}
                                          >
                                            {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                          </label>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant={isRemoved ? 'outline' : 'destructive'}
                                          className="h-6 px-2 text-xs"
                                          onClick={() => {
                                            if (isRemoved) {
                                              setRemovedEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                            } else {
                                              setRemovedEmployeeIds(prev => [...prev, emp.id]);
                                              setEditingGCEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                            }
                                          }}
                                        >
                                          {isRemoved ? 'Add Back' : 'Remove'}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                                
                                {/* Time editing for selected/remaining employees */}
                                {(editingGCEmployeeIds.length > 0 || assignedEmployees.some(emp => !removedEmployeeIds.includes(emp.id))) && (
                                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Start Time</Label>
                                      <Input
                                        type="time"
                                        value={editStartTime}
                                        onChange={(e) => setEditStartTime(e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">End Time</Label>
                                      <Input
                                        type="time"
                                        value={editEndTime}
                                        onChange={(e) => setEditEndTime(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                )}
                                
                                <div className="flex flex-wrap gap-2">
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => {
                                      setEditingGCRequestId(null);
                                      setEditingGCEmployeeIds([]);
                                      setRemovedEmployeeIds([]);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button 
                                    size="sm"
                                    onClick={() => {
                                      const remainingIds = (req.employee_ids || []).filter(id => !removedEmployeeIds.includes(id));
                                      const checkedIds = editingGCEmployeeIds.filter(id => !removedEmployeeIds.includes(id));
                                      askEditReason('single', (reason) => {
                                        if (onEditGCRequest) {
                                          onEditGCRequest(req.id, remainingIds, editStartTime, editEndTime, checkedIds.length > 0 ? checkedIds : undefined, reason);
                                        }
                                        setEditingGCRequestId(null);
                                        setEditingGCEmployeeIds([]);
                                        setRemovedEmployeeIds([]);
                                      });
                                    }}
                                  >
                                    Confirm Changes
                                  </Button>
                                  {selectedDates.length > 1 && onEditGCRequestForAllDates && (
                                    <Button 
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        const remainingIds = (req.employee_ids || []).filter(id => !removedEmployeeIds.includes(id));
                                        const checkedIds = editingGCEmployeeIds.filter(id => !removedEmployeeIds.includes(id));
                                        askEditReason('all-dates', (reason) => {
                                          onEditGCRequestForAllDates(req.id, remainingIds, editStartTime, editEndTime, checkedIds.length > 0 ? checkedIds : undefined, reason);
                                          setEditingGCRequestId(null);
                                          setEditingGCEmployeeIds([]);
                                          setRemovedEmployeeIds([]);
                                        });
                                      }}
                                    >
                                      Confirm Changes For All Selected Days
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {/* Action buttons */}
                            {canAct && !isEditingThis && (
                              <div className="flex items-center gap-2 pt-1 flex-wrap">
                                {/* Acknowledge edit button - shows when request was edited by sub */}
                                {isEdited && onAcknowledgeEdit && (
                                  <Button 
                                    size="sm" 
                                    variant="default"
                                    className="bg-orange-600 hover:bg-orange-700"
                                    onClick={() => onAcknowledgeEdit(req.id)}
                                  >
                                    Confirm Changes
                                  </Button>
                                )}
                                {(isConfirmed || isPending) && onEditGCRequest && (
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => {
                                      setEditingGCRequestId(req.id);
                                      setEditingGCEmployeeIds([]);
                                      setRemovedEmployeeIds([]);
                                      // Initialize edit times from availability or request
                                      const empAvails = availabilities.filter(a => 
                                        (req.employee_ids || []).some(empId => a.employee_id === empId)
                                      );
                                      if (empAvails.length > 0) {
                                        const earliest = empAvails.reduce((min, a) => 
                                          new Date(a.start_time) < new Date(min.start_time) ? a : min
                                        );
                                        const latest = empAvails.reduce((max, a) => 
                                          new Date(a.end_time) > new Date(max.end_time) ? a : max
                                        );
                                        setEditStartTime(formatTimeRawFromTimestamp(earliest.start_time));
                                        setEditEndTime(formatTimeRawFromTimestamp(latest.end_time));
                                      } else if (req.start_time && req.end_time) {
                                        setEditStartTime(req.start_time);
                                        setEditEndTime(req.end_time);
                                      }
                                    }}
                                  >
                                    <Pencil className="w-3 h-3 mr-1" />
                                    {isEdited ? 'Edit & Resend' : 'Edit'}
                                  </Button>
                                )}
                                {(isConfirmed || isPending) && onCancelRequest && (
                                  <Button 
                                    size="sm" 
                                    variant="destructive"
                                    onClick={() => {
                                      if (isConfirmed) {
                                        setCancelConfirmRequestId(req.id);
                                        setCancelReason('');
                                      } else {
                                        onCancelRequest(req.id);
                                      }
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Show rejected/cancelled requests */}
              {rejectedRequestsForDate.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-red-600 dark:text-red-400">Rejected/Cancelled Requests</Label>
                  <div className="border border-red-200 dark:border-red-900 rounded-md p-3 space-y-3 bg-red-50 dark:bg-red-950/20">
                    {rejectedRequestsForDate.map(req => {
                      const subCompany = connectedSubCompanies.find(c => c.id === req.sub_company_id);
                      const assignedEmployees = allEmployees.filter(emp => 
                        (req.employee_ids || []).includes(emp.id)
                      );
                      const project = projects.find(p => p.id === req.project_id);
                      
                      return (
                        <div 
                          key={req.id} 
                          className="text-sm p-2 rounded space-y-2 bg-red-100/50 dark:bg-red-950/40 border border-red-300 dark:border-red-800"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium">{subCompany?.name}</span>
                              {subCompany?.trade && (
                                <span className="text-muted-foreground ml-1">({subCompany.trade})</span>
                              )}
                            </div>
                            <Badge variant="destructive">
                              {req.status === 'rejected' ? 'Rejected' : 'Cancelled'}
                            </Badge>
                          </div>
                          
                          {project && (
                            <p className="text-xs text-muted-foreground">Project: {project.name}</p>
                          )}
                          
                          <p className="text-xs text-muted-foreground">
                            Date: {format(parseLocalDate(req.scheduled_date), 'MMM d, yyyy')}
                          </p>
                          
                          {req.start_time && req.end_time && (
                            <p className="text-xs text-muted-foreground">
                              Time: {req.start_time} - {req.end_time}
                            </p>
                          )}
                          
                          {/* Show requested employees */}
                          {assignedEmployees.length > 0 && (
                            <div className="pl-2 border-l-2 border-red-300 dark:border-red-700">
                              <p className="text-xs text-muted-foreground mb-1">Requested Employees:</p>
                              <div className="space-y-1">
                                {assignedEmployees.map(emp => (
                                  <div key={emp.id} className="text-xs">
                                    {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {req.cancellation_reason && req.status === 'rejected' && (
                            <div className="text-sm bg-background border rounded p-2">
                              <div className="font-medium mb-1">Reason for rejection:</div>
                              <div className="whitespace-pre-wrap text-muted-foreground">{req.cancellation_reason}</div>
                            </div>
                          )}

                          {req.description && (
                            <div className="pt-1">
                              <p className="text-xs text-muted-foreground">Description:</p>
                              <p className="text-xs">{req.description}</p>
                            </div>
                          )}
                          
                          {/* Acknowledge rejection button */}
                          {canAct && onAcknowledgeRejection && (
                            <div className="pt-2">
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="w-full"
                                onClick={() => onAcknowledgeRejection(req.id)}
                              >
                                Acknowledge & Dismiss
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Select Subcontractors</Label>
                <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto bg-background">
                  {selectableSubCompanies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No subcontractors connected to your projects.</p>
                  ) : (
                    selectableSubCompanies.map(sub => {
                      const hasManpower = subHasAvailability(sub.id);
                      return (
                        <div 
                          key={sub.id} 
                          className={`flex items-center gap-2 ${!hasManpower ? 'opacity-50' : ''}`}
                        >
                          <Checkbox
                            id={`sub-${sub.id}`}
                            checked={selectedSubCompanies.includes(sub.id)}
                            onCheckedChange={(checked) => handleSubCompanyToggle(sub.id, !!checked)}
                            disabled={!hasManpower}
                          />
                          <label 
                            htmlFor={`sub-${sub.id}`} 
                            className={`text-sm cursor-pointer flex-1 ${!hasManpower ? 'cursor-not-allowed' : ''}`}
                          >
                            {sub.name} {sub.trade && `(${sub.trade})`}
                          </label>
                          {!hasManpower && (
                            <span className="text-xs text-muted-foreground">No availability</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Quick Selection Section */}
              {selectedSubCompanies.length > 0 && (() => {
                // Get employees for the selected quick-select sub, grouped by job title
                const quickSelectSubIds = quickSelectSub ? expandSubIds([quickSelectSub]) : new Set<string>();
                const quickSelectEmployees = quickSelectSub
                  ? availableEmployeesForGC.filter(emp => quickSelectSubIds.has(emp.company_id))
                  : [];
                
                const jobTitleGroups: Record<string, typeof quickSelectEmployees> = {};
                quickSelectEmployees.forEach(emp => {
                  const title = emp.job_title || 'Other';
                  if (!jobTitleGroups[title]) jobTitleGroups[title] = [];
                  jobTitleGroups[title].push(emp);
                });

                const handleApplyQuickSelect = () => {
                  const newSelectedEmployees = [...selectedEmployees];
                  const newSelectedStops = [...selectedStops];

                  Object.entries(quickSelectCounts).forEach(([jobTitle, count]) => {
                    const group = jobTitleGroups[jobTitle] || [];
                    if (count <= 0 || group.length === 0) return;

                    // Historical-priority ordering: employees who were most recently on this
                    // exact project+sub first (in recency order), then remaining group members
                    // in the default order to fill any shortfall.
                    const groupById = new Map(group.map(e => [e.id, e]));
                    const historyOrdered = historicalEmployeeIds
                      .filter(id => groupById.has(id))
                      .map(id => groupById.get(id)!);
                    const historyIdSet = new Set(historyOrdered.map(e => e.id));
                    const fillOrdered = group.filter(e => !historyIdSet.has(e.id));
                    const orderedCandidates = [...historyOrdered, ...fillOrdered];

                    let picked = 0;
                    for (const emp of orderedCandidates) {
                      if (picked >= count) break;

                      // Availability check: employee must have at least one non-booked stop
                      // on the target date(s). Historical picks who fail this are skipped
                      // and replaced by the next available person in that role.
                      const stopsByDate = getEmployeeStopsByDate(emp.id);
                      const availableStops = stopsByDate.flatMap(dg =>
                        dg.stops.filter(s => !s.isBooked).map(s => ({
                          employeeId: emp.id,
                          stopNumber: s.stopNumber,
                          startTime: s.startTimeRaw,
                          endTime: s.endTimeRaw,
                          date: dg.date,
                          availabilityId: s.availabilityId
                        }))
                      );

                      if (availableStops.length === 0) continue;

                      if (!newSelectedEmployees.includes(emp.id)) {
                        newSelectedEmployees.push(emp.id);
                      }

                      availableStops.forEach(stop => {
                        const alreadySelected = newSelectedStops.some(
                          s => s.employeeId === stop.employeeId && s.availabilityId === stop.availabilityId
                        );
                        if (!alreadySelected) {
                          newSelectedStops.push(stop);
                        }
                      });

                      picked++;
                    }
                  });

                  setSelectedEmployees(newSelectedEmployees);
                  setSelectedStops(newSelectedStops);
                  // Reset quick select for next sub
                  setQuickSelectCounts({});
                };

                const selectedSubsForDropdown = selectableSubCompanies.filter(
                  sub => selectedSubCompanies.includes(sub.id)
                );

                return (
                  <div className="space-y-2">
                    <Label>Quick Selection</Label>
                    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                      <Select value={quickSelectSub} onValueChange={(v) => { setQuickSelectSub(v); setQuickSelectCounts({}); }}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select a subcontractor" />
                        </SelectTrigger>
                        <SelectContent className="bg-background z-50">
                          {selectedSubsForDropdown.map(sub => (
                            <SelectItem key={sub.id} value={sub.id}>
                              {sub.name} {sub.trade && `(${sub.trade})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {quickSelectSub && Object.keys(jobTitleGroups).length > 0 && (
                        <div className="space-y-2">
                          {Object.entries(jobTitleGroups).map(([title, emps]) => {
                            // Count how many have available (non-booked) stops
                            const availableCount = emps.filter(emp => {
                              const stops = getEmployeeStopsByDate(emp.id);
                              return stops.some(dg => dg.stops.some(s => !s.isBooked));
                            }).length;

                            return (
                              <div key={title} className="flex items-center justify-between gap-2 p-2 rounded-md border bg-background">
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium">{title}</span>
                                  <span className="text-xs text-muted-foreground ml-2">
                                    ({availableCount} available)
                                  </span>
                                </div>
                                <Input
                                  type="number"
                                  min={0}
                                  max={availableCount}
                                  value={quickSelectCounts[title] ?? 0}
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(availableCount, parseInt(e.target.value) || 0));
                                    setQuickSelectCounts(prev => ({ ...prev, [title]: val }));
                                  }}
                                  className="w-20 h-8 text-center"
                                />
                              </div>
                            );
                          })}
                          <Button
                            size="sm"
                            onClick={handleApplyQuickSelect}
                            disabled={Object.values(quickSelectCounts).every(v => v === 0)}
                            className="w-full"
                          >
                            Apply Selection
                          </Button>
                        </div>
                      )}

                      {quickSelectSub && Object.keys(jobTitleGroups).length === 0 && (
                        <p className="text-sm text-muted-foreground">No available employees from this subcontractor.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* GC View: Show employees with their individual stops grouped by date */}
              {selectedSubCompanies.length > 0 && (
                <div className="space-y-2">
                  <Label>Available Personnel & Time Slots</Label>
                  <ScrollArea className="border rounded-md p-3 h-60 bg-muted/30">
                    {availableEmployeesForGC.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No available employees from selected subs.</p>
                    ) : (
                      <div className="space-y-4">
                      {availableEmployeesForGC.map((emp) => {
                          const subCompany = connectedSubCompanies.find(c => c.id === emp.company_id);
                          const stopsByDate = getEmployeeStopsByDate(emp.id);
                          
                          // Get all available (non-booked) stops for this employee
                          const allAvailableStops = stopsByDate.flatMap(dg => 
                            dg.stops.filter(s => !s.isBooked).map(s => ({
                              employeeId: emp.id,
                              stopNumber: s.stopNumber,
                              startTime: s.startTimeRaw,
                              endTime: s.endTimeRaw,
                              date: dg.date,
                              availabilityId: s.availabilityId
                            }))
                          );
                          
                          // Check if all available stops are selected
                          const allSelected = allAvailableStops.length > 0 && allAvailableStops.every(stop => 
                            selectedStops.some(s => s.employeeId === stop.employeeId && s.availabilityId === stop.availabilityId)
                          );
                          
                          // Check if some (but not all) are selected
                          const someSelected = allAvailableStops.some(stop => 
                            selectedStops.some(s => s.employeeId === stop.employeeId && s.availabilityId === stop.availabilityId)
                          ) && !allSelected;
                          
                          const handleSelectAllForEmployee = (checked: boolean) => {
                            if (checked) {
                              // Add all available stops that aren't already selected
                              const newStops = allAvailableStops.filter(stop => 
                                !selectedStops.some(s => s.employeeId === stop.employeeId && s.availabilityId === stop.availabilityId)
                              );
                              setSelectedStops(prev => [...prev, ...newStops]);
                              if (!selectedEmployees.includes(emp.id)) {
                                setSelectedEmployees(prev => [...prev, emp.id]);
                              }
                            } else {
                              // Remove all stops for this employee
                              setSelectedStops(prev => prev.filter(s => s.employeeId !== emp.id));
                            }
                          };
                          
                          return (
                            <div key={emp.id} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">
                                  {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  ({subCompany?.name})
                                </span>
                              </div>
                              
                              {/* Select All checkbox for this employee */}
                              {allAvailableStops.length > 0 && (
                                <div className="pl-4 flex items-center gap-2 py-1 border-b border-border/50">
                                  <Checkbox
                                    id={`select-all-${emp.id}`}
                                    checked={allSelected}
                                    onCheckedChange={handleSelectAllForEmployee}
                                    className={someSelected ? 'data-[state=unchecked]:bg-primary/30' : ''}
                                  />
                                  <label 
                                    htmlFor={`select-all-${emp.id}`}
                                    className="text-sm cursor-pointer text-muted-foreground"
                                  >
                                    Select All
                                  </label>
                                </div>
                              )}
                              
                              <div className="pl-4 space-y-2">
                                {stopsByDate.map((dateGroup) => (
                                  <div key={`${emp.id}-${dateGroup.date}`} className="space-y-1">
                                    {dateGroup.stops.map((stop, idx) => {
                                      const isSelected = selectedStops.some(
                                        s => s.employeeId === emp.id && s.availabilityId === stop.availabilityId
                                      );
                                      const hasMultipleStops = dateGroup.stops.length > 1 || stop.stopNumber > 1;
                                      
                                      // Build the label: "Monday, Available: 5:00am-1:00pm" or "Tuesday, 2nd Stop: 9:00am-2:00pm"
                                      const stopDisplayLabel = hasMultipleStops 
                                        ? `${dateGroup.dayName}, ${stop.stopLabel}: ${stop.startTime} - ${stop.endTime}`
                                        : `${dateGroup.dayName}, Available: ${stop.startTime} - ${stop.endTime}`;
                                      
                                      return (
                                        <div 
                                          key={`${emp.id}-${dateGroup.date}-${stop.stopNumber}-${idx}`}
                                          className={`flex items-center gap-2 p-2 rounded-md border ${
                                            stop.isBooked 
                                              ? 'bg-muted opacity-60' 
                                              : isSelected 
                                                ? 'bg-primary/10 border-primary' 
                                                : 'bg-background hover:bg-muted/50'
                                          }`}
                                        >
                                          <Checkbox
                                            id={`stop-${emp.id}-${dateGroup.date}-${stop.stopNumber}-${idx}`}
                                            checked={isSelected}
                                            onCheckedChange={(checked) => handleStopToggle(
                                              emp.id, 
                                              stop.stopNumber, 
                                              stop.startTimeRaw, 
                                              stop.endTimeRaw, 
                                              dateGroup.date,
                                              stop.availabilityId,
                                              !!checked
                                            )}
                                            disabled={stop.isBooked}
                                          />
                                          <label 
                                            htmlFor={`stop-${emp.id}-${dateGroup.date}-${stop.stopNumber}-${idx}`}
                                            className={`text-sm cursor-pointer flex-1 flex items-center gap-2 ${
                                              stop.isBooked ? 'cursor-not-allowed' : ''
                                            }`}
                                          >
                                            <Clock className="w-3 h-3 text-muted-foreground" />
                                            <span>{stopDisplayLabel}</span>
                                          </label>
                                          {stop.isBooked && (
                                            <Badge variant="secondary" className="text-xs">
                                              Booked
                                            </Badge>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}


              <div className="space-y-2">
                <Label>Description / Work to be Performed</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Work to be performed..."
                  rows={3}
                />
              </div>

              {/* Image Upload Section for GC */}
              <div className="space-y-2">
                <Label>Attach Photos</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleImageUpload(e.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  {uploadedImages.map((url, idx) => (
                    <div key={idx} className="relative w-16 h-16 rounded-md overflow-hidden border border-border group">
                      <img src={uploadedImagePreviews[url] || url} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(url)}
                        className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-16 h-16 rounded-md border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Add</span>
                      </>
                    )}
                  </button>
                </div>
                {uploadedImages.length > 0 && (
                  <p className="text-xs text-muted-foreground">{uploadedImages.length} photo(s) attached</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Notifications</Label>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="email"
                      checked={notifyEmail}
                      onCheckedChange={(checked) => setNotifyEmail(!!checked)}
                    />
                    <label htmlFor="email" className="text-sm">Email</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="text"
                      checked={notifyText}
                      onCheckedChange={(checked) => setNotifyText(!!checked)}
                    />
                    <label htmlFor="text" className="text-sm">Push notification and message</label>
                  </div>
                </div>
              </div>

              {/* Overlapping Tasks Section for GC */}
              {overlappingTasks.length > 0 && (
                <div className="space-y-2">
                  <Label>Tasks for this date</Label>
                  <ScrollArea className="h-32 border rounded-md p-3 bg-muted/20">
                    <div className="space-y-2">
                      {overlappingTasks.map(task => (
                        <div key={task.id} className="flex items-center gap-2 text-sm">
                          <div 
                            className="w-3 h-3 rounded-full flex-shrink-0" 
                            style={{ backgroundColor: task.color }}
                          />
                          <span className="font-medium">{task.name}</span>
                          <span className="text-muted-foreground text-xs">
                            ({format(parseLocalDate(task.start_date), 'MMM d')} - {format(parseLocalDate(task.end_date), 'MMM d')})
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Show pending requests from GCs */}
              {pendingRequestsForDate.length > 0 && (
                <div className="space-y-2">
                  <Label>Pending Requests</Label>
                  <div className="border rounded-md p-3 space-y-3 bg-amber-50 dark:bg-amber-950/20">
                    {pendingRequestsForDate.map(req => {
                      const project = projects.find(p => p.id === req.project_id);
                      const isEditing = editingPendingRequestId === req.id;
                      const isEdited = req.edited;
                      
                      // Get employees assigned to this request
                      const assignedEmployees = allEmployees.filter(emp => 
                        (req.employee_ids || []).includes(emp.id)
                      );
                      
                      // Get original employees for showing changes
                      const originalEmployees = req.original_employee_ids && req.original_employee_ids.length > 0
                        ? allEmployees.filter(emp => req.original_employee_ids!.includes(emp.id))
                        : [];
                      
                      // Get all available employees from this sub for editing
                      const subAvailableEmployees = employees.filter(emp => 
                        availabilities.some(a => a.employee_id === emp.id)
                      );
                      
                      return (
                        <div key={req.id} className={`space-y-2 p-2 rounded border ${
                          isEdited ? 'border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-950/30' : 'border-amber-200 dark:border-amber-800'
                        }`}>
                          <div className="flex items-center justify-between text-sm">
                            <div>
                              <span className="font-medium">
                                Schedule Request
                              </span>
                              {project && (
                                <span className="text-muted-foreground ml-1">
                                  - {project.name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {isEdited && (
                                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 text-xs">
                                  Edited
                                </Badge>
                              )}
                              <Badge variant="secondary">Pending</Badge>
                            </div>
                          </div>
                          
                          {/* Show created timestamp */}
                          {req.created_at && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Sent:</span> {format(new Date(req.created_at), 'MMM d, yyyy')} at {format(new Date(req.created_at), 'h:mm a')}
                            </div>
                          )}
                          
                          {/* Show date */}
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Date:</span> {req.scheduled_date}
                          </div>

                          {/* Personnel owner when this company is only the in-between contractor */}
                          {requestingCompanyId && req.sub_company_id !== requestingCompanyId && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Personnel from:</span>{' '}
                              {connectedSubCompanies.find(c => c.id === req.sub_company_id)?.name || 'Connected subcontractor'}
                              {' '}(only they can approve)
                            </div>
                          )}

                          
                          {/* Show time if available */}
                          {req.start_time && req.end_time && (
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Time:</span> {req.start_time} - {req.end_time}
                            </div>
                          )}
                          
                          {/* Show guest GC info if present */}
                          {(req.guest_gc_company_name || req.guest_gc_project_name) && (
                            <div className="pl-2 border-l-2 border-primary/30 space-y-0.5">
                              {req.guest_gc_company_name && (
                                <div className="text-xs">
                                  <span className="font-medium">GC Company:</span>{' '}
                                  <span className="text-muted-foreground">{req.guest_gc_company_name}</span>
                                </div>
                              )}
                              {req.guest_gc_project_name && (
                                <div className="text-xs">
                                  <span className="font-medium">Project:</span>{' '}
                                  <span className="text-muted-foreground">{req.guest_gc_project_name}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {isEdited && originalEmployees.length > 0 && (
                            <div className="pl-2 border-l-2 border-gray-300 dark:border-gray-600">
                              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Previous Assignment:</p>
                              <div className="space-y-0.5">
                                {originalEmployees.map(emp => (
                                  <div key={emp.id} className="text-xs text-gray-400 dark:text-gray-500 line-through">
                                    {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                    {req.original_start_time && req.original_end_time && (
                                      <span className="ml-1">({req.original_start_time} - {req.original_end_time})</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Show assigned employees */}
                          {assignedEmployees.length > 0 && !isEditing && (
                            <div className="pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                              <p className="text-xs font-medium text-foreground mb-1">
                                {isEdited ? 'New Assignment' : 'Requested Employees'} ({assignedEmployees.length}):
                              </p>
                              <div className="space-y-0.5">
                                {assignedEmployees.map(emp => {
                                  const savedStops = ((req as any).employee_stops as Record<string, string[]> | null | undefined)?.[emp.id];
                                  const options = getStopOptionsFor(emp.id, req.scheduled_date, req.project_id);
                                  const shown = savedStops && savedStops.length > 0
                                    ? options.filter(o => savedStops.includes(o.id))
                                    : options;
                                  return (
                                    <div key={emp.id} className="text-xs text-muted-foreground">
                                      <span className="font-medium">{emp.name}</span>
                                      {emp.job_title && <span className="ml-1">({emp.job_title})</span>}
                                      {shown.length > 0 && (
                                        <div className="ml-3">
                                          {shown.map(s => (
                                            <div key={s.id}>{s.label}: {s.time}</div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          
                          {/* Explanation for the most recent edit */}
                          {req.edit_reason && !isEditing && (
                            <div className="pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                              <p className="text-xs font-medium text-foreground mb-0.5">Reason for edit:</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{req.edit_reason}</p>
                            </div>
                          )}
                          
                          {/* Edit mode for Sub to modify employees before approving */}
                          {isEditing && (
                            <div className="pl-2 border-l-2 border-primary/50 space-y-2">
                              <p className="text-xs font-medium">Edit Employee &amp; Stop Selection:</p>
                              <div className="space-y-2 max-h-56 overflow-y-auto">
                                {subAvailableEmployees.map(emp => {
                                  const stopOptions = getStopOptionsFor(emp.id, req.scheduled_date, req.project_id);
                                  const selectedStopIds = editingPendingStops[emp.id] || [];
                                  const empChecked = editingPendingEmployeeIds.includes(emp.id);
                                  const toggleEmployee = (checked: boolean) => {
                                    if (checked) {
                                      setEditingPendingEmployeeIds([...editingPendingEmployeeIds, emp.id]);
                                      setEditingPendingStops(prev => ({ ...prev, [emp.id]: stopOptions.map(s => s.id) }));
                                    } else {
                                      setEditingPendingEmployeeIds(editingPendingEmployeeIds.filter(id => id !== emp.id));
                                      setEditingPendingStops(prev => {
                                        const next = { ...prev };
                                        delete next[emp.id];
                                        return next;
                                      });
                                    }
                                  };
                                  const toggleStop = (stopId: string, checked: boolean) => {
                                    const next = checked
                                      ? Array.from(new Set([...selectedStopIds, stopId]))
                                      : selectedStopIds.filter(id => id !== stopId);
                                    setEditingPendingStops(prev => ({ ...prev, [emp.id]: next }));
                                    if (next.length === 0) {
                                      setEditingPendingEmployeeIds(editingPendingEmployeeIds.filter(id => id !== emp.id));
                                    } else if (!empChecked) {
                                      setEditingPendingEmployeeIds([...editingPendingEmployeeIds, emp.id]);
                                    }
                                  };
                                  return (
                                    <div key={emp.id} className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          id={`pending-edit-${emp.id}`}
                                          checked={empChecked}
                                          onCheckedChange={(checked) => toggleEmployee(!!checked)}
                                        />
                                        <label htmlFor={`pending-edit-${emp.id}`} className="text-xs cursor-pointer font-medium">
                                          {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                        </label>
                                      </div>
                                      {stopOptions.length > 1 && (
                                        <div className="ml-6 space-y-0.5">
                                          {stopOptions.map(stop => (
                                            <div key={stop.id} className="flex items-center gap-2">
                                              <Checkbox
                                                id={`pending-edit-${emp.id}-${stop.id}`}
                                                checked={selectedStopIds.includes(stop.id)}
                                                onCheckedChange={(checked) => toggleStop(stop.id, !!checked)}
                                              />
                                              <label htmlFor={`pending-edit-${emp.id}-${stop.id}`} className="text-xs cursor-pointer text-muted-foreground">
                                                {stop.label}: {stop.time}
                                              </label>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => {
                                    setEditingPendingRequestId(null);
                                    setEditingPendingEmployeeIds([]);
                                    setEditingPendingStops({});
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button 
                                  size="sm"
                                  onClick={() => {
                                    const ids = editingPendingEmployeeIds;
                                    const stops = Object.fromEntries(
                                      ids.map(id => [id, editingPendingStops[id] || []]).filter(([, v]) => (v as string[]).length > 0)
                                    ) as Record<string, string[]>;
                                    askEditReason('single', (reason) => {
                                      if (onSubEditAndResend) {
                                        onSubEditAndResend(req.id, ids, reason, stops);
                                      }
                                      setEditingPendingRequestId(null);
                                      setEditingPendingEmployeeIds([]);
                                      setEditingPendingStops({});
                                    });
                                  }}
                                >
                                  Confirm Changes
                                </Button>
                                {selectedDates.length > 1 && onSubEditAndResendForAllDates && (
                                  <Button 
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      const ids = editingPendingEmployeeIds;
                                      askEditReason('all-dates', (reason) => {
                                        onSubEditAndResendForAllDates(req.id, ids, reason);
                                        setEditingPendingRequestId(null);
                                        setEditingPendingEmployeeIds([]);
                                        setEditingPendingStops({});
                                      });
                                    }}
                                  >
                                    Confirm Changes For All Selected Days
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Show description/work to be performed */}
                          {req.description && !isEditing && (
                            <div className="pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                              <p className="text-xs font-medium text-foreground mb-0.5">Work to be Performed:</p>
                              <p className="text-xs text-muted-foreground">{req.description}</p>
                            </div>
                          )}
                          
                          {/* Display attached images from GC */}
                          {req.image_urls && req.image_urls.length > 0 && !isEditing && (
                            <ScheduleImageGallery imageUrls={req.image_urls} />
                          )}
                          
                          {/* Conflicting requests from other projects */}
                          {(() => {
                            const reqEmployeeIds = req.employee_ids || [];
                            if (reqEmployeeIds.length === 0) return null;
                            
                            const conflicting = allScheduleRequests.filter(otherReq => 
                              otherReq.id !== req.id &&
                              otherReq.project_id !== req.project_id &&
                              otherReq.scheduled_date === req.scheduled_date &&
                              (otherReq.status === 'pending' || otherReq.status === 'confirmed') &&
                              (otherReq.employee_ids || []).some(eid => reqEmployeeIds.includes(eid))
                            );
                            
                            if (conflicting.length === 0) return null;
                            
                            return (
                              <Collapsible>
                                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline w-full">
                                  <ChevronDown className="h-3 w-3" />
                                  Other Requests for Same Employees ({conflicting.length})
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-1 space-y-1">
                                  {conflicting.map(cr => {
                                    const crProject = projects.find(p => p.id === cr.project_id);
                                    const overlappingEmps = (cr.employee_ids || [])
                                      .filter(eid => reqEmployeeIds.includes(eid))
                                      .map(eid => allEmployees.find(e => e.id === eid)?.name || 'Unknown');
                                    
                                    return (
                                      <div key={cr.id} className="text-xs p-2 rounded border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 space-y-0.5">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium">{crProject?.name || cr.guest_gc_project_name || 'Unknown Project'}</span>
                                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                                            {cr.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                                          </Badge>
                                        </div>
                                        {cr.created_at && (
                                          <div className="text-muted-foreground">
                                            Date Requested: {format(new Date(cr.created_at), "MMM d, yyyy 'at' h:mm a")}
                                          </div>
                                        )}
                                        <div className="text-muted-foreground">
                                          Date Needed: {cr.scheduled_date}
                                          {cr.start_time && cr.end_time && ` | From: ${cr.start_time} - ${cr.end_time}`}
                                        </div>
                                        <div className="text-muted-foreground">
                                          Overlapping: {overlappingEmps.join(', ')}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })()}
                          
                          {/* Action buttons */}
                          {canAct && !isEditing && (() => {
                            const viewerIsLastEditor =
                              req.edited === true &&
                              !!req.last_edited_by_company_id &&
                              !!requestingCompanyId &&
                              req.last_edited_by_company_id === requestingCompanyId;
                            const viewerIsSub = viewMode === 'sub';
                            // Only the company whose personnel are scheduled can approve.
                            // A main subcontractor sitting in between may edit / reject / cancel only.
                            const viewerIsIntermediary =
                              !!req.intermediary_company_id &&
                              !!requestingCompanyId &&
                              req.intermediary_company_id === requestingCompanyId &&
                              req.sub_company_id !== requestingCompanyId;
                            const showApprove = !viewerIsLastEditor && !viewerIsIntermediary;
                            const showNotifyPersonnel = viewerIsLastEditor && viewerIsSub;
                            const destructiveLabel = viewerIsLastEditor
                              ? 'Remove & Cancel Schedule Request'
                              : 'Reject';
                            return (
                              <div className="space-y-1 pt-1">
                                <div className="flex gap-2 flex-wrap">
                                  {showApprove && (
                                    <Button
                                      size="sm"
                                      onClick={() => onApproveRequest?.(req.id)}
                                    >
                                      Approve
                                    </Button>
                                  )}
                                  {showNotifyPersonnel && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => onNotifyPersonnel?.(req.id)}
                                    >
                                      Notify Personnel Before GC Confirmation
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setEditingPendingRequestId(req.id);
                                      setEditingPendingEmployeeIds(req.employee_ids || []);
                                      {
                                        // Preselect saved stops; fall back to every stop the
                                        // employee has that day (legacy whole-day requests).
                                        const saved = (req as any).employee_stops as Record<string, string[]> | null | undefined;
                                        const init: Record<string, string[]> = {};
                                        (req.employee_ids || []).forEach(empId => {
                                          const all = getStopOptionsFor(empId, req.scheduled_date, req.project_id).map(s => s.id);
                                          const picked = saved?.[empId];
                                          init[empId] = picked && picked.length > 0 ? picked.filter(id => all.includes(id)) : all;
                                          if (init[empId].length === 0) init[empId] = all;
                                        });
                                        setEditingPendingStops(init);
                                      }
                                    }}
                                  >
                                    <Pencil className="w-3 h-3 mr-1" />
                                    Edit & Resend
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => setRejectTarget(req.id)}
                                  >
                                    {destructiveLabel}
                                  </Button>
                                </div>
                                {showNotifyPersonnel && (
                                  <p className="text-xs text-muted-foreground">
                                    Clicking this sends an email/text to the scheduled personnel now. Otherwise, they will be notified automatically once the GC confirms the request.
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Show confirmed requests grouped by project */}
              {confirmedRequestsForDate.length > 0 && (() => {
                // Group confirmed requests by project_id (or guest project name as fallback)
                const groupKey = (r: typeof confirmedRequestsForDate[number]) =>
                  r.project_id || `guest:${r.guest_gc_project_name || 'unknown'}`;
                const groups = new Map<string, typeof confirmedRequestsForDate>();
                confirmedRequestsForDate.forEach(r => {
                  const k = groupKey(r);
                  if (!groups.has(k)) groups.set(k, [] as any);
                  (groups.get(k) as any).push(r);
                });

                return (
                <div className="space-y-2">
                  <Label>Confirmed Schedules</Label>
                  <div className="border rounded-md p-3 space-y-2 bg-green-50 dark:bg-green-950/20">
                    {Array.from(groups.entries()).map(([currentGroupKey, groupReqs]) => {
                      const firstReq = groupReqs[0];
                      const project = projects.find(p => p.id === firstReq.project_id)
                        ?? allProjectsList?.find(p => p.id === firstReq.project_id);
                      const projectLabel = project?.name
                        ?? firstReq.guest_gc_project_name
                        ?? 'Project (no longer accessible)';
                      const isSelfAssigned = groupReqs.every(r => r.requesting_company_id === r.sub_company_id);
                      const allSilent = groupReqs.every(r => r.silent_assignment);
                      const isGroup = groupReqs.length > 1;
                      const singleReq = isGroup ? null : firstReq;
                      const isEditingSingle = !isGroup && singleReq && editingRequestId === singleReq.id;
                      const isEditingGroup = isGroup && editingGroupKey === currentGroupKey;
                      const isEditing = isEditingSingle || isEditingGroup;

                      // Build personnel list across all requests in this group
                      const personnel: Array<{ emp: typeof allEmployees[number]; req: typeof firstReq }> = [];
                      groupReqs.forEach(r => {
                        (r.employee_ids || []).forEach(eid => {
                          const emp = allEmployees.find(e => e.id === eid);
                          if (emp && !personnel.find(p => p.emp.id === eid)) {
                            personnel.push({ emp, req: r });
                          }
                        });
                      });

                      // For the unified edit panel, build the list of employees from all requests in the group
                      const groupAssignedEmps = personnel.map(p => p.emp);

                      return (
                        <div key={groupReqs.map(r => r.id).join('+')} className="space-y-2 p-2 rounded border border-green-200 dark:border-green-900">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">
                                {isSelfAssigned ? 'Self-Assigned' : 'Confirmed'} — {projectLabel}
                              </span>
                            </div>
                            {canAct && !isEditing && (
                              <div className="flex gap-1">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => {
                                    if (isGroup) {
                                      handleStartEditGroup(currentGroupKey, groupReqs);
                                    } else if (singleReq) {
                                      handleStartEditConfirmed(singleReq);
                                    }
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="destructive"
                                  onClick={() => {
                                    if (isGroup) {
                                      setCancelConfirmGroupIds(groupReqs.map(r => r.id));
                                    } else if (singleReq) {
                                      setCancelConfirmRequestId(singleReq.id);
                                    }
                                    setCancelReason('');
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Show guest GC info if present (use first req) */}
                          {(firstReq.guest_gc_company_name || firstReq.guest_gc_project_name) && (
                            <div className="pl-2 border-l-2 border-primary/30 space-y-0.5">
                              {firstReq.guest_gc_company_name && (
                                <div className="text-xs">
                                  <span className="font-medium">GC Company:</span>{' '}
                                  <span className="text-muted-foreground">{firstReq.guest_gc_company_name}</span>
                                </div>
                              )}
                              {firstReq.guest_gc_project_name && (
                                <div className="text-xs">
                                  <span className="font-medium">Project:</span>{' '}
                                  <span className="text-muted-foreground">{firstReq.guest_gc_project_name}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Explanation for the most recent edit */}
                          {!isEditing && firstReq.edit_reason && (
                            <div className="pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                              <p className="text-xs font-medium text-foreground mb-0.5">Reason for edit:</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{firstReq.edit_reason}</p>
                            </div>
                          )}

                          {/* Show assigned personnel with per-employee times when NOT editing */}
                          {!isEditing && personnel.length > 0 && (
                            <div className="pl-2 border-l-2 border-muted-foreground/20">
                              <p className="text-xs text-muted-foreground mb-1">Assigned Personnel:</p>
                              <div className="space-y-1">
                                {personnel.map(({ emp, req }) => {
                                  const reqDateStr = req.scheduled_date;
                                  const empAvails = availabilities.filter(a => {
                                    const availDate = getDateFromTimestamp(a.start_time);
                                    return a.employee_id === emp.id && availDate === reqDateStr;
                                  });

                                  let empTimeDisplay: string | null = null;
                                  if (empAvails.length > 0) {
                                    const earliestStart = empAvails.reduce((min, a) => 
                                      new Date(a.start_time) < new Date(min.start_time) ? a : min
                                    );
                                    const latestEnd = empAvails.reduce((max, a) => 
                                      new Date(a.end_time) > new Date(max.end_time) ? a : max
                                    );
                                    empTimeDisplay = `${formatTimeFromTimestamp(earliestStart.start_time)} - ${formatTimeFromTimestamp(latestEnd.end_time)}`;
                                  } else if (req.start_time && req.end_time) {
                                    empTimeDisplay = `${req.start_time} - ${req.end_time}`;
                                  }

                                  const empIsSelfAssigned = req.requesting_company_id === req.sub_company_id;

                                  return (
                                    <div key={emp.id} className="text-xs flex items-center justify-between gap-2">
                                      <span className="flex-1 flex items-center gap-2 flex-wrap">
                                        <span>{emp.name}{emp.job_title && ` - ${emp.job_title}`}</span>
                                      </span>
                                      {empTimeDisplay && (
                                        <span className="text-muted-foreground">{empTimeDisplay}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Conflicting requests from other projects (use first req) */}
                          {(() => {
                            const reqEmployeeIds = personnel.map(p => p.emp.id);
                            if (reqEmployeeIds.length === 0) return null;
                            const groupReqIds = new Set(groupReqs.map(r => r.id));

                            const conflicting = allScheduleRequests.filter(otherReq => 
                              !groupReqIds.has(otherReq.id) &&
                              otherReq.project_id !== firstReq.project_id &&
                              otherReq.scheduled_date === firstReq.scheduled_date &&
                              (otherReq.status === 'pending' || otherReq.status === 'confirmed') &&
                              (otherReq.employee_ids || []).some(eid => reqEmployeeIds.includes(eid))
                            );

                            if (conflicting.length === 0) return null;

                            return (
                              <Collapsible>
                                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline w-full">
                                  <ChevronDown className="h-3 w-3" />
                                  Other Requests for Same Employees ({conflicting.length})
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-1 space-y-1">
                                  {conflicting.map(cr => {
                                    const crProject = projects.find(p => p.id === cr.project_id)
                                      ?? allProjectsList?.find(p => p.id === cr.project_id);
                                    const overlappingEmps = (cr.employee_ids || [])
                                      .filter(eid => reqEmployeeIds.includes(eid))
                                      .map(eid => allEmployees.find(e => e.id === eid)?.name || 'Unknown');

                                    return (
                                      <div key={cr.id} className="text-xs p-2 rounded border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 space-y-0.5">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium">{crProject?.name || cr.guest_gc_project_name || 'Unknown Project'}</span>
                                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                                            {cr.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                                          </Badge>
                                        </div>
                                        {cr.created_at && (
                                          <div className="text-muted-foreground">
                                            Date Requested: {format(new Date(cr.created_at), "MMM d, yyyy 'at' h:mm a")}
                                          </div>
                                        )}
                                        <div className="text-muted-foreground">
                                          Date Needed: {cr.scheduled_date}
                                          {cr.start_time && cr.end_time && ` | From: ${cr.start_time} - ${cr.end_time}`}
                                        </div>
                                        <div className="text-muted-foreground">
                                          Overlapping: {overlappingEmps.join(', ')}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })()}

                          {/* Edit mode for single-request cards */}
                          {isEditingSingle && singleReq && (() => {
                            const assignedEmps = allEmployees.filter(emp => 
                              (singleReq.employee_ids || []).includes(emp.id)
                            );
                            return (
                              <div className="pl-2 border-l-2 border-primary/50 space-y-2">
                                <p className="text-xs font-medium">Edit Assignment:</p>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {assignedEmps.map(emp => {
                                    const isRemoved = removedEmployeeIds.includes(emp.id);
                                    const isChecked = editingEmployeeIds.includes(emp.id);
                                    return (
                                      <div key={emp.id} className="flex items-center justify-between gap-2 p-1 rounded">
                                        <div className="flex items-center gap-2">
                                          <Checkbox
                                            id={`sub-edit-emp-${emp.id}`}
                                            checked={isChecked && !isRemoved}
                                            disabled={isRemoved}
                                            onCheckedChange={(checked) => {
                                              if (checked) {
                                                setEditingEmployeeIds(prev => [...prev, emp.id]);
                                              } else {
                                                setEditingEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                              }
                                            }}
                                          />
                                          <label 
                                            htmlFor={`sub-edit-emp-${emp.id}`}
                                            className={`text-xs ${isRemoved ? 'line-through text-muted-foreground opacity-50' : ''}`}
                                          >
                                            {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                          </label>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant={isRemoved ? 'outline' : 'destructive'}
                                          className="h-6 px-2 text-xs"
                                          onClick={() => {
                                            if (isRemoved) {
                                              setRemovedEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                            } else {
                                              setRemovedEmployeeIds(prev => [...prev, emp.id]);
                                              setEditingEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                            }
                                          }}
                                        >
                                          {isRemoved ? 'Add Back' : 'Remove'}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>

                                {(editingEmployeeIds.length > 0 || assignedEmps.some(emp => !removedEmployeeIds.includes(emp.id))) && (
                                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Start Time</Label>
                                      <Input
                                        type="time"
                                        value={editStartTime}
                                        onChange={(e) => setEditStartTime(e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">End Time</Label>
                                      <Input
                                        type="time"
                                        value={editEndTime}
                                        onChange={(e) => setEditEndTime(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => {
                                      setEditingRequestId(null);
                                      setEditingEmployeeIds([]);
                                      setRemovedEmployeeIds([]);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button 
                                    size="sm"
                                    onClick={() => askEditReason('single', handleSaveEditConfirmed)}
                                  >
                                    Confirm Changes
                                  </Button>
                                  {selectedDates.length > 1 && onEditConfirmedRequestForAllDates && (
                                    <Button 
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => askEditReason('all-dates', handleSaveEditConfirmedForAllDates)}
                                    >
                                      Confirm Changes For All Selected Days
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Unified edit mode for grouped cards */}
                          {isEditingGroup && (
                            <div className="pl-2 border-l-2 border-primary/50 space-y-2">
                              <p className="text-xs font-medium">Edit Assignment:</p>
                              <div className="space-y-1 max-h-40 overflow-y-auto">
                                {groupAssignedEmps.map(emp => {
                                  const isRemoved = removedEmployeeIds.includes(emp.id);
                                  const isChecked = editingEmployeeIds.includes(emp.id);
                                  return (
                                    <div key={emp.id} className="flex items-center justify-between gap-2 p-1 rounded">
                                      <div className="flex items-center gap-2">
                                        <Checkbox
                                          id={`sub-edit-grp-emp-${emp.id}`}
                                          checked={isChecked && !isRemoved}
                                          disabled={isRemoved}
                                          onCheckedChange={(checked) => {
                                            if (checked) {
                                              setEditingEmployeeIds(prev => [...prev, emp.id]);
                                            } else {
                                              setEditingEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                            }
                                          }}
                                        />
                                        <label 
                                          htmlFor={`sub-edit-grp-emp-${emp.id}`}
                                          className={`text-xs ${isRemoved ? 'line-through text-muted-foreground opacity-50' : ''}`}
                                        >
                                          {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                        </label>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant={isRemoved ? 'outline' : 'destructive'}
                                        className="h-6 px-2 text-xs"
                                        onClick={() => {
                                          if (isRemoved) {
                                            setRemovedEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                          } else {
                                            setRemovedEmployeeIds(prev => [...prev, emp.id]);
                                            setEditingEmployeeIds(prev => prev.filter(id => id !== emp.id));
                                          }
                                        }}
                                      >
                                        {isRemoved ? 'Add Back' : 'Remove'}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>

                              {(editingEmployeeIds.length > 0 || groupAssignedEmps.some(emp => !removedEmployeeIds.includes(emp.id))) && (
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Start Time</Label>
                                    <Input
                                      type="time"
                                      value={editStartTime}
                                      onChange={(e) => setEditStartTime(e.target.value)}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">End Time</Label>
                                    <Input
                                      type="time"
                                      value={editEndTime}
                                      onChange={(e) => setEditEndTime(e.target.value)}
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={handleCancelEditGroup}
                                >
                                  Cancel
                                </Button>
                                <Button 
                                  size="sm"
                                  onClick={() => askEditReason('single', handleSaveEditGroup)}
                                >
                                  Confirm Changes
                                </Button>
                                {selectedDates.length > 1 && onEditConfirmedRequestForAllDates && (
                                  <Button 
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => askEditReason('all-dates', handleSaveEditGroupForAllDates)}
                                  >
                                    Confirm Changes For All Selected Days
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })()}


              {/* Show cancelled requests from GC that Sub needs to acknowledge */}
              {rejectedRequestsForDate.filter(req => 
                (req.status === 'cancelled' || req.status === 'canceled') && 
                req.cancelled_by_company_id && 
                req.cancelled_by_company_id !== req.sub_company_id
              ).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-red-600 dark:text-red-400">Cancelled Requests</Label>
                  <div className="border border-red-200 dark:border-red-900 rounded-md p-3 space-y-3 bg-red-50 dark:bg-red-950/20">
                    {rejectedRequestsForDate
                      .filter(req => 
                        (req.status === 'cancelled' || req.status === 'canceled') && 
                        req.cancelled_by_company_id && 
                        req.cancelled_by_company_id !== req.sub_company_id
                      )
                      .map(req => {
                        const project = projects.find(p => p.id === req.project_id);
                        const assignedEmployees = allEmployees.filter(emp => 
                          (req.employee_ids || []).includes(emp.id)
                        );
                        
                        return (
                          <div 
                            key={req.id} 
                            className="text-sm p-2 rounded space-y-2 bg-red-100/50 dark:bg-red-950/40 border border-red-300 dark:border-red-800"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium">Cancelled by GC</span>
                                {project && (
                                  <span className="text-muted-foreground ml-1">- {project.name}</span>
                                )}
                              </div>
                              <Badge variant="destructive">Cancelled</Badge>
                            </div>
                            
                            <p className="text-xs text-muted-foreground">
                              Date: {format(parseLocalDate(req.scheduled_date), 'MMM d, yyyy')}
                            </p>
                            
                            {req.start_time && req.end_time && (
                              <p className="text-xs text-muted-foreground">
                                Time: {req.start_time} - {req.end_time}
                              </p>
                            )}
                            
                            {/* Show employees who were assigned */}
                            {assignedEmployees.length > 0 && (
                              <div className="pl-2 border-l-2 border-red-300 dark:border-red-700">
                                <p className="text-xs text-muted-foreground mb-1">Employees (now available):</p>
                                <div className="space-y-1">
                                  {assignedEmployees.map(emp => (
                                    <div key={emp.id} className="text-xs">
                                      {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {req.description && (
                              <div className="pt-1">
                                <p className="text-xs text-muted-foreground">Description:</p>
                                <p className="text-xs">{req.description}</p>
                              </div>
                            )}
                            
                            {/* Acknowledge cancellation button */}
                            {canAct && onAcknowledgeRejection && (
                              <div className="pt-2">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => onAcknowledgeRejection(req.id)}
                                >
                                  Accept & Dismiss
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Who is available?</Label>
                
                {/* Select All / Deselect All button */}
                {shouldShowEditControls && employees.length > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={handleSelectAllToggle}
                  >
                    {isAllEmployeesSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                )}
                
                {/* Copy Last Week's Availability checkbox */}
                {shouldShowEditControls && (lastWeekHasAvailability || lastNWeeksHasAvailability) && (
                  <div className="p-2 border rounded-md bg-muted/30 space-y-2">
                    {numberOfWeeksSelected <= 1 ? (
                      // Single week: simple checkbox like before
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="copy-last-week"
                          checked={copyWeeksMode === 'last_one'}
                          onCheckedChange={(checked) => handleCopyWeeks(checked ? 'last_one' : 'none')}
                          disabled={!lastWeekHasAvailability}
                        />
                        <label htmlFor="copy-last-week" className="text-sm cursor-pointer text-muted-foreground">
                          Copy last week's availability
                        </label>
                      </div>
                    ) : (
                      // Multi-week: radio-style selection
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Copy previous availability:</p>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="copy-mode-none"
                            checked={copyWeeksMode === 'none'}
                            onCheckedChange={() => setCopyWeeksMode('none')}
                          />
                          <label htmlFor="copy-mode-none" className="text-sm cursor-pointer text-muted-foreground">
                            None
                          </label>
                        </div>
                        {lastWeekHasAvailability && (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="copy-mode-last-one"
                              checked={copyWeeksMode === 'last_one'}
                              onCheckedChange={(checked) => handleCopyWeeks(checked ? 'last_one' : 'none')}
                            />
                            <label htmlFor="copy-mode-last-one" className="text-sm cursor-pointer text-muted-foreground">
                              Copy last week's availability
                            </label>
                          </div>
                        )}
                        {lastNWeeksHasAvailability && (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="copy-mode-last-n"
                              checked={copyWeeksMode === 'last_n'}
                              onCheckedChange={(checked) => handleCopyWeeks(checked ? 'last_n' : 'none')}
                            />
                            <label htmlFor="copy-mode-last-n" className="text-sm cursor-pointer text-muted-foreground">
                              Copy last {numberOfWeeksSelected} weeks' availability
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                <div className="border rounded-md p-3 space-y-3 max-h-60 sm:max-h-[22rem] overflow-y-auto bg-background">
                  {employees.length === 0 && rosterLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading personnel...
                    </div>
                  ) : employees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No employees found. Add employees in Manage Team.</p>
                  ) : (
                    employees.map((emp) => {
                      const hasAvailability = hasAvailabilityForSelectedDates(emp.id);
                      const isScheduled = isEmployeeScheduled(emp.id);
                      const scheduledProject = isScheduled ? getScheduledProjectName(emp.id) : null;
                      const allStopsByDate = getEmployeeStopsByDate(emp.id);
                      // Filter stops to only selected dates
                      const empStopsByDate = selectedDateStrings.length > 0 
                        ? allStopsByDate.filter(dg => selectedDateStrings.includes(dg.date))
                        : allStopsByDate;
                      const isEmpSelected = selectedEmployees.includes(emp.id);
                      const empSelectedDays = selectedDaysPerEmployee[emp.id] || [];
                      
                      return (
                        <div key={emp.id} className="rounded-md border border-border/50 shadow-sm p-2 bg-card space-y-1">
                          <div className="flex items-center gap-2">
                            {shouldShowEditControls && (
                              <Checkbox
                                id={`emp-${emp.id}`}
                                checked={isEmpSelected}
                                onCheckedChange={(checked) => handleEmployeeToggle(emp.id, !!checked)}
                                disabled={isScheduled}
                              />
                            )}
                            <label 
                              htmlFor={`emp-${emp.id}`} 
                              className={`text-sm ${shouldShowEditControls ? 'cursor-pointer' : ''} flex-1 ${isScheduled ? 'opacity-50' : ''}`}
                            >
                              {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                            </label>
                            {isScheduled ? (
                              <Badge variant="default" className="text-xs bg-green-600">
                                Scheduled: {scheduledProject}
                              </Badge>
                            ) : hasAvailability ? (
                              <span className="text-xs text-green-600 bg-green-50 dark:bg-green-950/50 px-2 py-0.5 rounded">
                                Available
                              </span>
                            ) : null}
                          </div>
                          {/* Show which projects the employee is available for */}
                          {hasAvailability && !isScheduled && (isGCView || isMasterSchedule) && (() => {
                            const empAvails = availabilities.filter(a => a.employee_id === emp.id);
                            const isAllProjects = empAvails.some(a => a.all_projects);
                            if (isAllProjects) {
                              return (
                                <div className={`${shouldShowEditControls ? 'ml-6' : 'ml-0'} text-xs text-muted-foreground italic`}>
                                  Available for all projects
                                </div>
                              );
                            }
                            const projectIds = [...new Set(empAvails.map(a => a.project_id).filter(Boolean))] as string[];
                            if (projectIds.length > 0) {
                              const projectNames = projectIds.map(pid => projects.find(p => p.id === pid)?.name).filter(Boolean);
                              return (
                                <div className={`${shouldShowEditControls ? 'ml-6' : 'ml-0'} text-xs text-muted-foreground`}>
                                  {projectNames.join(', ')}
                                </div>
                              );
                            }
                            return null;
                          })()}
                          {/* Show existing availability details with per-day checkboxes in edit mode */}
                          {hasAvailability && empStopsByDate.length > 0 && (
                            <div className={`${shouldShowEditControls ? 'ml-6' : 'ml-0'} pl-2 border-l-2 border-muted-foreground/20`}>
                              {empStopsByDate.map((dateGroup, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                                  {isEditingAvailability && isEmpSelected && (
                                    <Checkbox
                                      id={`day-${emp.id}-${dateGroup.date}`}
                                      checked={empSelectedDays.includes(dateGroup.date)}
                                      onCheckedChange={(checked) => handleDayToggle(emp.id, dateGroup.date, !!checked)}
                                      className="h-3 w-3"
                                    />
                                  )}
                                  <div>
                                    <span className="font-medium">{dateGroup.dayName}:</span>{' '}
                                    {dateGroup.stops.map((stop, stopIdx) => (
                                      <span key={stopIdx}>
                                        {stop.startTime} - {stop.endTime}
                                        {stopIdx < dateGroup.stops.length - 1 && ', '}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                
                {/* Edit button - only show when all have availability and not currently editing */}
                {allEmployeesHaveAvailability && !isEditingAvailability && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={handleStartEdit}
                  >
                    <Pencil className="w-3 h-3 mr-2" />
                    Edit
                  </Button>
                )}
                
                {/* Cancel Edit button */}
                {allEmployeesHaveAvailability && isEditingAvailability && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={handleCancelEdit}
                  >
                    Cancel Edit
                  </Button>
                )}
              </div>

              {/* Only show time inputs and controls when in edit mode */}
              {shouldShowEditControls && (
                <>
                  {/* Multiple Stops Toggle */}
                  <div className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <Label htmlFor="multiple-stops" className="cursor-pointer">Multiple Stops</Label>
                    </div>
                    <Switch
                      id="multiple-stops"
                      checked={multipleStopsEnabled}
                      onCheckedChange={setMultipleStopsEnabled}
                    />
                  </div>

                  {multipleStopsEnabled ? (
                    <div className="space-y-4">
                      {/* Number of Stops Selector */}
                      <div className="space-y-2">
                        <Label>Number of Stops</Label>
                        <Select 
                          value={showCustomInput ? 'other' : numberOfStops.toString()} 
                          onValueChange={handleStopCountChange}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Select number of stops" />
                          </SelectTrigger>
                          <SelectContent className="bg-background z-50">
                            {STOP_PRESETS.map(num => (
                              <SelectItem key={num} value={num.toString()}>
                                {num} {num === 1 ? 'stop' : 'stops'}
                              </SelectItem>
                            ))}
                            <SelectItem value="other">Other...</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        {showCustomInput && (
                          <div className="space-y-1">
                            <Input
                              type="number"
                              min={1}
                              max={MAX_STOPS}
                              value={customStopCount}
                              onChange={(e) => handleCustomStopCountChange(e.target.value)}
                              placeholder="Enter number of stops"
                            />
                            {stopCountError && (
                              <p className="text-xs text-destructive">{stopCountError}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Recurring Duration Option */}
                      <div className="space-y-3 p-3 border rounded-md bg-background">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="recurring-duration"
                            checked={useRecurringDuration}
                            onCheckedChange={(checked) => setUseRecurringDuration(!!checked)}
                          />
                          <label htmlFor="recurring-duration" className="text-sm font-medium cursor-pointer">
                            Set recurring duration for all stops
                          </label>
                        </div>
                        
                        {useRecurringDuration && (
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Starting at</Label>
                              <Input
                                type="time"
                                value={recurringStartTime}
                                onChange={(e) => setRecurringStartTime(e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Duration per stop</Label>
                              <Select 
                                value={recurringDuration.toString()} 
                                onValueChange={(v) => setRecurringDuration(parseInt(v))}
                              >
                                <SelectTrigger className="bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-background z-50">
                                  {DURATION_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value.toString()}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Individual Stop Times */}
                      <div className="space-y-2">
                        <Label>Stop Times</Label>
                        <div className="border rounded-md p-3 max-h-72 overflow-y-auto bg-background">
                          <div className="space-y-3">
                            {stopTimes.map((stop, index) => (
                              <div key={index} className="space-y-2 p-2 border rounded-md bg-muted/20">
                                <Label className="text-sm font-medium">Stop #{index + 1}</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Start</Label>
                                    <Input
                                      type="time"
                                      value={stop.start}
                                      onChange={(e) => handleStopTimeChange(index, 'start', e.target.value)}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">End</Label>
                                    <Input
                                      type="time"
                                      value={stop.end}
                                      onChange={(e) => handleStopTimeChange(index, 'end', e.target.value)}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Start Time</Label>
                        <Input
                          type="time"
                          value={subStartTime}
                          onChange={(e) => setSubStartTime(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>End Time</Label>
                        <Input
                          type="time"
                          value={subEndTime}
                          onChange={(e) => setSubEndTime(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {(isGCView || isMasterSchedule) && (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="allProjects"
                            checked={allProjects}
                            onCheckedChange={(checked) => setAllProjects(!!checked)}
                          />
                          <label htmlFor="allProjects" className="text-sm font-medium">
                            Available for all projects
                          </label>
                        </div>
                      </div>

                      {!allProjects && (
                        <div className="space-y-2">
                          <Label>Assign to Specific Project(s)</Label>
                          <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto bg-background">
                            {projects.map((project) => (
                              <div key={project.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={`proj-${project.id}`}
                                  checked={selectedProjects.includes(project.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedProjects(prev => [...prev, project.id]);
                                    } else {
                                      setSelectedProjects(prev => prev.filter(id => id !== project.id));
                                    }
                                  }}
                                />
                                <label htmlFor={`proj-${project.id}`} className="text-sm cursor-pointer">
                                  {project.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* Assign Personnel to Job - Sub view only, partial+ permissions */}
          {!isGCView && !readOnly && hasPartialOrHigher && onSubAssign && (() => {
            const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
            const dateStrs = datesToCheck.map(d => format(d, 'yyyy-MM-dd'));
            // In master schedule, the sub picks the project here; otherwise it's the active one.
            const effectiveProjectId = isMasterSchedule ? assignSelectedProjectId : currentSelectedProject;
            const assignableEmployees = employees.filter(emp => {
              return !scheduleRequests.some(req =>
                req.status === 'confirmed' && (req.employee_ids || []).includes(emp.id) &&
                dateStrs.includes(req.scheduled_date) &&
                (effectiveProjectId ? req.project_id === effectiveProjectId : true)
              );
            });
            if (assignableEmployees.length === 0) return null;
            return (
              <div className="space-y-3 p-3 border-2 border-blue-200 dark:border-blue-800 rounded-md bg-blue-50/50 dark:bg-blue-950/20">
                <Label className="text-blue-700 dark:text-blue-400 font-semibold">Assign Personnel to Job</Label>
                <p className="text-xs text-muted-foreground">
                  {isMasterSchedule
                    ? 'Select a project, then assign unscheduled personnel directly.'
                    : 'Assign unscheduled personnel directly to this project.'}
                </p>

                {/* Project picker - Master Schedule only */}
                {isMasterSchedule && (
                  <div className="space-y-1">
                    <Label className="text-xs">Select Project</Label>
                    <Select value={assignSelectedProjectId} onValueChange={setAssignSelectedProjectId}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Choose a project..." />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        {projects.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Collapsible dropdown for personnel selection */}
                <Collapsible
                  open={personnelDropdownOpen}
                  onOpenChange={setPersonnelDropdownOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between text-sm"
                      disabled={isMasterSchedule && !assignSelectedProjectId}
                    >
                      <span>
                        {assignEmployees.length > 0
                          ? `${assignEmployees.length} personnel selected`
                          : 'Select Personnel'}
                      </span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${personnelDropdownOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto bg-background mt-1">
                      {assignableEmployees.map(emp => (
                        <div key={emp.id} className="flex items-center gap-2">
                          <Checkbox id={`assign-${emp.id}`} checked={assignEmployees.includes(emp.id)}
                            onCheckedChange={(checked) => {
                              if (checked) setAssignEmployees(prev => [...prev, emp.id]);
                              else setAssignEmployees(prev => prev.filter(id => id !== emp.id));
                            }} />
                          <label htmlFor={`assign-${emp.id}`} className="text-sm cursor-pointer">
                            {emp.name}{emp.job_title && ` - ${emp.job_title}`}
                          </label>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {assignEmployees.length > 0 && (!isMasterSchedule || assignSelectedProjectId) && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Start Time</Label>
                        <Input type="time" value={assignStartTime} onChange={(e) => setAssignStartTime(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End Time</Label>
                        <Input type="time" value={assignEndTime} onChange={(e) => setAssignEndTime(e.target.value)} />
                      </div>
                    </div>
                    <div className="p-2 border rounded-md bg-background space-y-2">
                      <Label className="text-sm">Notify the general contractor</Label>
                      <div className="flex items-center gap-4 pl-1">
                        <div className="flex items-center gap-2">
                          <Checkbox id="notify-email" checked={assignNotifyEmail} onCheckedChange={(checked) => setAssignNotifyEmail(!!checked)} className="h-3.5 w-3.5" />
                          <label htmlFor="notify-email" className="text-sm cursor-pointer">Email</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox id="notify-text" checked={assignNotifyText} onCheckedChange={(checked) => setAssignNotifyText(!!checked)} className="h-3.5 w-3.5" />
                          <label htmlFor="notify-text" className="text-sm cursor-pointer">Push notification and message</label>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 border rounded-md bg-background space-y-2">
                      <Label className="text-sm">Notify Personnel or Wait for GC Confirmation?</Label>
                      <div className="flex items-center gap-4 pl-1">
                        <div className="flex items-center gap-2">
                          <Checkbox id="notify-personnel-email" checked={assignNotifyPersonnelEmail} onCheckedChange={(checked) => setAssignNotifyPersonnelEmail(!!checked)} className="h-3.5 w-3.5" />
                          <label htmlFor="notify-personnel-email" className="text-sm cursor-pointer">Email</label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox id="notify-personnel-text" checked={assignNotifyPersonnelSms} onCheckedChange={(checked) => setAssignNotifyPersonnelSms(!!checked)} className="h-3.5 w-3.5" />
                          <label htmlFor="notify-personnel-text" className="text-sm cursor-pointer">Push notification and message</label>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground pl-1">Leave both unchecked to wait for GC confirmation.</p>
                    </div>
                    <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
                      const datesToSchedule = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
                      onSubAssign({
                        employeeIds: assignEmployees,
                        startTime: assignStartTime,
                        endTime: assignEndTime,
                        dates: datesToSchedule,
                        notifyGC: (assignNotifyEmail || assignNotifyText),
                        notifyPersonnelEmail: assignNotifyPersonnelEmail,
                        notifyPersonnelSms: assignNotifyPersonnelSms,
                        projectId: effectiveProjectId,
                      });
                      setAssignEmployees([]);
                      setAssignNotifyPersonnelEmail(false);
                      setAssignNotifyPersonnelSms(false);
                      setAssignSelectedProjectId('');
                      setPersonnelDropdownOpen(false);
                      onClose();
                    }}>Assign Personnel to Job</Button>
                  </>
                )}
              </div>
            );
          })()}

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 pb-1 pt-3 sm:static sm:mx-0 sm:gap-3 sm:border-0 sm:p-0 sm:pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1 whitespace-nowrap sm:flex-none">
              Cancel
            </Button>
            {/* Remove Availability — Sub side, partial+ permission. Always shown so users see the action; disabled until employees are checked. */}
            {!readOnly && !isGCView && hasPartialOrHigher && (
              <Button
                variant="destructive"
                disabled={selectedEmployees.length === 0}
                onClick={() => setRemoveAvailConfirmOpen(true)}
                className="flex-1 whitespace-nowrap px-4 sm:flex-none"
                title={selectedEmployees.length === 0 ? 'Select employees to remove availability' : undefined}
              >
                Remove Availability
              </Button>
            )}
            {/* Only show Set Availability / Send Request when appropriate and not readOnly */}
            {!readOnly && (isGCView || shouldShowEditControls) && (
              <Button 
                onClick={handleSubmit} 
                className="flex-1 whitespace-nowrap px-4 sm:flex-none"
                disabled={
                  (isGCView && isMasterSchedule && !gcSelectedProjectId)
                }
              >
                {isGCView ? 'Send Request' : 'Set Availability'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Cancel Confirmation AlertDialog */}
    <AlertDialog
      open={!!cancelConfirmRequestId || !!(cancelConfirmGroupIds && cancelConfirmGroupIds.length > 0)}
      onOpenChange={(open) => {
        if (!open) {
          setCancelConfirmRequestId(null);
          setCancelConfirmGroupIds(null);
          setCancelReason('');
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Confirmed Schedule Request</AlertDialogTitle>
          <AlertDialogDescription>
            {cancelConfirmGroupIds && cancelConfirmGroupIds.length > 1
              ? `Are you sure you want to cancel all ${cancelConfirmGroupIds.length} confirmed assignments for this project? This action cannot be undone.`
              : 'Are you sure you want to cancel this confirmed schedule request? This action cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason for Cancellation (optional)</Label>
          <Textarea
            id="cancel-reason"
            placeholder="Explain why you are cancelling this request..."
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="min-h-[80px]"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Go Back</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              const reason = cancelReason.trim() || undefined;
              if (cancelConfirmGroupIds && cancelConfirmGroupIds.length > 0 && onCancelRequest) {
                cancelConfirmGroupIds.forEach(id => onCancelRequest(id, reason));
              } else if (cancelConfirmRequestId && onCancelRequest) {
                onCancelRequest(cancelConfirmRequestId, reason);
              }
              setCancelConfirmRequestId(null);
              setCancelConfirmGroupIds(null);
              setCancelReason('');
            }}
          >
            Confirm Cancellation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Edit reason prompt — shown for every "Confirm Changes" action */}
    <EditReasonDialog
      open={editReasonOpen}
      onOpenChange={(open) => {
        setEditReasonOpen(open);
        if (!open) setPendingEditAction(null);
      }}
      mode={editReasonMode}
      onConfirm={(reason) => {
        const action = pendingEditAction;
        setEditReasonOpen(false);
        setPendingEditAction(null);
        action?.(reason);
      }}
    />

    {/* Remove Availability Confirmation AlertDialog */}
    <AlertDialog open={removeAvailConfirmOpen} onOpenChange={setRemoveAvailConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Availability</AlertDialogTitle>
          <AlertDialogDescription>
            {(() => {
              const names = selectedEmployees
                .map(id => employees.find(e => e.id === id)?.name)
                .filter(Boolean)
                .join(', ');
              const datesCount = (() => {
                if (Object.keys(selectedDaysPerEmployee).length > 0) {
                  const allDays = new Set<string>();
                  selectedEmployees.forEach(empId => {
                    (selectedDaysPerEmployee[empId] || []).forEach(d => allDays.add(d));
                  });
                  if (allDays.size > 0) return allDays.size;
                }
                return selectedDates.length > 0 ? selectedDates.length : (selectedDate ? 1 : 0);
              })();
              return `Are you sure you want to remove availability for ${names || 'the selected employees'} across ${datesCount} day${datesCount === 1 ? '' : 's'}? Pending schedule requests for these employees on these dates will be edited to remove them. This action cannot be undone.`;
            })()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go Back</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              // Build removal map (per employee → dates)
              const removalMap: { empId: string; dates: Date[] }[] = [];
              if (Object.keys(selectedDaysPerEmployee).length > 0) {
                selectedEmployees.forEach(empId => {
                  const empDays = selectedDaysPerEmployee[empId] || [];
                  if (empDays.length > 0) {
                    removalMap.push({ empId, dates: empDays.map(d => parseLocalDate(d)) });
                  }
                });
              }
              if (removalMap.length === 0) {
                const datesToUse = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
                selectedEmployees.forEach(empId => {
                  removalMap.push({ empId, dates: datesToUse });
                });
              }

              // Block when any selected employee has a confirmed request on any of the dates
              const blockedEmployees: string[] = [];
              removalMap.forEach(({ empId, dates }) => {
                dates.forEach(date => {
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const hasConfirmed = scheduleRequests.some(req =>
                    req.status === 'confirmed' &&
                    req.scheduled_date === dateStr &&
                    (req.employee_ids || []).includes(empId)
                  );
                  if (hasConfirmed && !blockedEmployees.includes(empId)) {
                    blockedEmployees.push(empId);
                  }
                });
              });

              if (blockedEmployees.length > 0) {
                const blockedNames = blockedEmployees
                  .map(id => employees.find(e => e.id === id)?.name || 'Unknown')
                  .join(', ');
                alert(`Cannot remove availability for ${blockedNames} — they have confirmed schedule requests. Please cancel the confirmed request first.`);
                setRemoveAvailConfirmOpen(false);
                return;
              }

              // Auto-edit pending requests to remove these employees
              removalMap.forEach(({ empId, dates }) => {
                dates.forEach(date => {
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const pendingReqs = scheduleRequests.filter(req =>
                    req.status === 'pending' &&
                    req.scheduled_date === dateStr &&
                    (req.employee_ids || []).includes(empId)
                  );
                  pendingReqs.forEach(req => {
                    if (onEditPendingRequestRemoveEmployee) {
                      onEditPendingRequestRemoveEmployee(req.id, empId);
                    }
                  });
                });
              });

              // Proceed with removal
              removalMap.forEach(({ empId, dates }) => {
                onRemoveAvailability(empId, dates);
              });
              setSelectedEmployees([]);
              setSelectedDaysPerEmployee({});
              setRemoveAvailConfirmOpen(false);
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <UnassignedAssignmentDialog
      open={unassignedDialogOpen}
      onOpenChange={setUnassignedDialogOpen}
      pairs={unassignedPairs}
      onConfirm={() => {
        const fn = pendingSubmit;
        setPendingSubmit(null);
        setUnassignedPairs([]);
        if (fn) fn();
      }}
      onCancel={() => {
        setPendingSubmit(null);
        setUnassignedPairs([]);
      }}
    />

    <RejectRequestDialog
      open={!!rejectTarget}
      onOpenChange={(o) => { if (!o) setRejectTarget(null); }}
      mode={(() => {
        if (!rejectTarget) return 'reject';
        const r = [...scheduleRequests, ...allScheduleRequests].find(x => x.id === rejectTarget);
        if (!r) return 'reject';
        return (r.edited === true
          && !!r.last_edited_by_company_id
          && !!requestingCompanyId
          && r.last_edited_by_company_id === requestingCompanyId)
          ? 'remove-cancel'
          : 'reject';
      })()}
      onConfirm={(reason) => {
        if (rejectTarget) {
          const r = [...scheduleRequests, ...allScheduleRequests].find(x => x.id === rejectTarget);
          const isRemoveCancel = !!r && r.edited === true
            && !!r.last_edited_by_company_id
            && !!requestingCompanyId
            && r.last_edited_by_company_id === requestingCompanyId;
          if (isRemoveCancel) {
            onCancelRequest?.(rejectTarget, reason);
          } else {
            onRejectRequest?.(rejectTarget, reason);
          }
        }
        setRejectTarget(null);
      }}
    />
    </>
  );
};

export default ScheduleModal;
