import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { sendNotification } from '@/hooks/useNotification';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import LeftPanel from '@/components/dashboard/LeftPanel';
import CalendarPanel from '@/components/dashboard/CalendarPanel';
import RightPanel from '@/components/dashboard/RightPanel';
import ResourceMatrix from '@/components/dashboard/ResourceMatrix';
import ScheduleModal from '@/components/dashboard/ScheduleModal';
import CreateTaskModal from '@/components/dashboard/CreateTaskModal';
import EditTaskModal from '@/components/dashboard/EditTaskModal';
import UploadScheduleModal from '@/components/dashboard/UploadScheduleModal';
import ForcePasswordChangeModal from '@/components/dashboard/ForcePasswordChangeModal';
import GuestGCTour from '@/components/dashboard/GuestGCTour';
import SpotlightTour from '@/components/onboarding/SpotlightTour';
import ConnectedContractorsViewerModal from '@/components/dashboard/ConnectedContractorsViewerModal';
import { useTooltipFlags, type TooltipKey } from '@/components/onboarding/TooltipFlagsProvider';
import { TOUR_COPY } from '@/components/onboarding/tourSteps';
import WelcomeDialog from '@/components/onboarding/WelcomeDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format, addDays, isBefore } from 'date-fns';
import { getHistoricalLockDate } from '@/lib/utils';
import { fetchAliasesForCompany, applyAliasesToProjects } from '@/lib/projectDisplay';
import { formatTime12, formatUTCTime12 } from '@/lib/time';

interface Company {
  id: string;
  name: string;
  company_type: 'gc' | 'sub';
  trade?: string | null;
  is_guest?: boolean;
}

interface Project {
  id: string;
  name: string;
  address?: string | null;
  connection_code: string | null;
  company_id: string;
}

interface Task {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  project_id: string;
  status?: string;
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  company_id: string;
  linked_user_id: string | null;
  profile_picture_url: string | null;
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
  cancelled_by_company_id?: string | null;
  original_employee_ids?: string[];
  original_start_time?: string | null;
  original_end_time?: string | null;
  last_edited_by_company_id?: string | null;
  edit_reason?: string | null;
  guest_gc_company_name?: string | null;
  guest_gc_project_name?: string | null;
  sub_assigned?: boolean;
  silent_assignment?: boolean;
  intermediary_company_id?: string | null;
  created_at?: string;
  /** Per-employee stop selection: employee_id -> availability ids. Missing/empty = all stops. */
  employee_stops?: Record<string, string[]> | null;
}

type PermissionLevel = 'account_holder' | 'full' | 'partial' | 'level_1' | 'basic' | 'standard';

interface ImpersonatedUser {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  company_id: string | null;
  company_name: string | null;
  company_type: 'gc' | 'sub' | null;
  permission_level: PermissionLevel | null;
}

const SUPABASE_PAGE_SIZE = 1000;

const fetchAllPages = async <T,>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<{ data: T[]; error: any | null }> => {
  const rows: T[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);

    if (error) return { data: rows, error };

    const page = data || [];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
};

const Dashboard = () => {
  const { profile, loading, isMOA, initializing, isBasicUser, hasLevel1OrHigher, hasPartialOrHigher, isAccountHolder, permissionLevel, isReadOnlyOperator } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [tourEnabled, setTourEnabled] = useState(false);

  // Trigger guest GC tour for first-run users
  useEffect(() => {
    if (!profile?.user_id) return;
    const isFirstRun = searchParams.get('firstrun') === '1';
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('tour_seen, company_id')
        .eq('user_id', profile.user_id)
        .maybeSingle();
      if (!data) return;
      if (data.tour_seen) return;
      if (!data.company_id) return;
      const { data: company } = await supabase
        .from('companies')
        .select('is_guest, company_type')
        .eq('id', data.company_id)
        .maybeSingle();
      if (company?.is_guest && company.company_type === 'gc' && isFirstRun) {
        setTourEnabled(true);
      }
    })();
  }, [profile?.user_id, searchParams]);

  const [viewMode, setViewMode] = useState<'moa' | 'gc' | 'sub'>('moa');
  const {
    impersonatedCompany: impersonatedCompanyRaw,
    impersonatedUser: impersonatedUserRaw,
    setImpersonatedCompany: setImpersonatedCompanyCtx,
    setImpersonatedUser: setImpersonatedUserCtx,
  } = useImpersonation();
  const impersonatedCompany = impersonatedCompanyRaw as Company | null;
  const impersonatedUser = impersonatedUserRaw as ImpersonatedUser | null;
  const setImpersonatedCompany = (c: Company | null) => setImpersonatedCompanyCtx(c as any);
  const setImpersonatedUser = (u: ImpersonatedUser | null) => setImpersonatedUserCtx(u as any);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [scheduleRequests, setScheduleRequests] = useState<ScheduleRequest[]>([]);
  const [employeeProjectAssignments, setEmployeeProjectAssignments] = useState<{ employee_id: string; project_id: string; receive_notifications: boolean }[]>([]);
  // True until the personnel roster + availability for the current window have loaded.
  const [rosterLoading, setRosterLoading] = useState(true);

  
  const [currentDate, setCurrentDate] = useState(new Date());
  // Rolling window around the month being viewed. Availability is fetched only
  // for this range instead of every row ever created, which is what made the
  // dashboard (and the Set Availability roster) slow to populate.
  const availabilityWindowKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const availabilityWindow = useMemo(() => {
    const [yearPart, monthPart] = availabilityWindowKey.split('-').map(Number);
    const start = new Date(Date.UTC(yearPart, monthPart - 6, 1, 0, 0, 0));
    const end = new Date(Date.UTC(yearPart, monthPart + 7, 1, 0, 0, 0));
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }, [availabilityWindowKey]);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [selectedProject, setSelectedProject] = useState('master');
  const [showOverlay, setShowOverlay] = useState(true);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [editTaskModalOpen, setEditTaskModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
  const [uploadScheduleModalOpen, setUploadScheduleModalOpen] = useState(false);
  const [guestProjectConnections, setGuestProjectConnections] = useState<{guest_company_id: string; sub_company_id: string}[]>([]);
  // Project IDs the active company has a project_aliases row for. For guest GCs
  // this is the canonical signal of "you were invited to this project" — the
  // project row itself is owned by the Sub, so company_id won't match.
  const [aliasVisibleProjectIds, setAliasVisibleProjectIds] = useState<string[]>([]);
  const [subOverlayEnabled, setSubOverlayEnabled] = useState(false);
  const [selectedOverlaySubIds, setSelectedOverlaySubIds] = useState<string[]>([]);
  const [masterOverlayProjectIds, setMasterOverlayProjectIds] = useState<string[]>([]);
  const [userAssignedProjectIds, setUserAssignedProjectIds] = useState<string[]>([]);
  const [matrixViewToggle, setMatrixViewToggle] = useState<'monthly' | 'weekly'>('monthly');
  // Cross-GC bookings: keyed `${employeeId}::${date}` for sub employees booked by ANOTHER GC.
  // Used in the weekly grid to silently hide those employees from this GC's view.
  const [crossGcBookings, setCrossGcBookings] = useState<Set<string>>(new Set());
  const [connectedContractorsCount, setConnectedContractorsCount] = useState(0);
  const [connectedContractorsOpen, setConnectedContractorsOpen] = useState(false);
  const [sharedContractorAssignments, setSharedContractorAssignments] = useState<{
    connection_id: string;
    project_id: string;
    main_company_id: string;
    sub_company_id: string;
  }[]>([]);

  useEffect(() => {
    // Only redirect after initialization is complete
    if (initializing) return;

    if (!loading && !profile) {
      navigate('/');
    } else if (profile && !profile.company_id && !isMOA) {
      // Suppress redirect briefly after just completing onboarding so a
      // not-yet-propagated profile/company link doesn't bounce the user back.
      let justOnboarded = false;
      try {
        const ts = parseInt(localStorage.getItem('ssaa_just_onboarded') || '0', 10);
        if (ts && Date.now() - ts < 30_000) justOnboarded = true;
        else if (ts) localStorage.removeItem('ssaa_just_onboarded');
      } catch {}
      if (justOnboarded) {
        // Re-check shortly; AuthContext will refresh profile via realtime.
        const t = setTimeout(() => {
          // No-op: state will update and effect will re-run.
        }, 1500);
        return () => clearTimeout(t);
      }
      navigate('/onboarding');
    } else if (profile?.company_id) {
      try { localStorage.removeItem('ssaa_just_onboarded'); } catch {}
    }
  }, [profile, loading, navigate, isMOA, initializing]);

  useEffect(() => {
    if (isMOA) {
      // When MOA impersonates a company/user, mirror that company's scheduling
      // behavior (GC vs Sub) so calendar filtering matches what the impersonated
      // user sees. Without this, sub availability is hidden behind GC-mode filters.
      const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || null;
      if (activeCompanyId) {
        const activeCompany =
          (impersonatedCompany && impersonatedCompany.id === activeCompanyId)
            ? impersonatedCompany
            : companies.find((c) => c.id === activeCompanyId) || null;
        const type = activeCompany?.company_type;
        if (type === 'gc' || type === 'sub') {
          setViewMode(type);
          return;
        }
      }
      setViewMode('moa');
    } else if (profile?.company_id) {
      fetchUserCompanyType();
    }
  }, [isMOA, profile, impersonatedCompany, impersonatedUser, companies]);

  const fetchUserCompanyType = async () => {
    if (!profile?.company_id) return;
    
    const { data } = await supabase
      .from('companies')
      .select('company_type')
      .eq('id', profile.company_id)
      .single();
    
    if (data) {
      setViewMode(data.company_type);
    }
  };

  useEffect(() => {
    // Independent reads — run them concurrently so the schedule roster isn't
    // gated behind a chain of sequential round trips.
    setRosterLoading(true);
    void Promise.all([
      fetchCompanies(),
      fetchProjects(),
      fetchTasks(),
      fetchEmployees(),
      fetchAvailabilities(),
      fetchScheduleRequests(),
      fetchGuestProjectConnections(),
      fetchEmployeeProjectAssignments(),
      fetchUserAssignedProjects(),
    ]).finally(() => setRosterLoading(false));

  }, [profile, impersonatedCompany, impersonatedUser]);

  // Extend/refresh availability when the user navigates outside the loaded window.
  const initialAvailabilityWindowRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialAvailabilityWindowRef.current === null) {
      initialAvailabilityWindowRef.current = availabilityWindowKey;
      return;
    }
    if (initialAvailabilityWindowRef.current === availabilityWindowKey) return;
    initialAvailabilityWindowRef.current = availabilityWindowKey;
    void fetchAvailabilities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityWindowKey]);




  // Whenever the active viewing context changes (MOA switching impersonated user/company,
  // or switching between GC / Sub / MOA modes), wipe out any per-context selections so
  // state from the previous company never bleeds into the new view.
  useEffect(() => {
    setSelectedProject('master');
    setMasterOverlayProjectIds([]);
    setSelectedOverlaySubIds([]);
    setSubOverlayEnabled(false);
    setSelectedDate(null);
    setSelectedDates([]);
  }, [impersonatedCompany?.id, impersonatedUser?.id, viewMode]);

  // Effective viewer: when MOA impersonates a user, mirror that user's
  // visibility (permission level + assigned projects) instead of operator-wide.
  const effectiveUserId = impersonatedUser?.user_id ?? profile?.user_id ?? null;
  const effectivePermissionLevel: PermissionLevel | null =
    (impersonatedUser?.permission_level as PermissionLevel | null)
    ?? (isMOA && impersonatedCompany ? ('account_holder' as PermissionLevel) : null)
    ?? (permissionLevel as PermissionLevel | null)
    ?? null;
  const effectiveIsMOA = impersonatedUser ? false : isMOA;

  // Permission tiers for the *currently viewed* identity. When an operator
  // impersonates a user, the UI must gate exactly like that user; when the
  // operator views a company (no specific user), treat as account holder.
  const effectiveIsAccountHolder = impersonatedUser || impersonatedCompany
    ? effectivePermissionLevel === 'account_holder'
    : isAccountHolder;
  const effectiveHasPartialOrHigher = impersonatedUser || impersonatedCompany
    ? ['partial', 'full', 'account_holder'].includes(effectivePermissionLevel || '')
    : hasPartialOrHigher;
  const effectiveHasLevel1OrHigher = impersonatedUser || impersonatedCompany
    ? ['level_1', 'partial', 'full', 'account_holder'].includes(effectivePermissionLevel || '')
    : hasLevel1OrHigher;
  const effectiveIsBasicUser = impersonatedUser || impersonatedCompany
    ? effectivePermissionLevel === 'basic' || effectivePermissionLevel === 'standard'
    : isBasicUser;


  // Only Level 3 (partial), Level 4 (full) and Main Company Account Holders may
  // approve / edit / reject / acknowledge schedule requests. Operators
  // impersonating a user inherit that user's restriction.
  const canActOnRequests = effectiveIsMOA || effectiveHasPartialOrHigher;
  const ensureCanActOnRequests = () => {
    if (canActOnRequests) return true;
    toast({
      title: 'Permission required',
      description: "You don't have permission to approve, edit, or change schedule requests.",
      variant: 'destructive',
    });
    return false;
  };


  // Schedule-visibility mode derived from the active viewing context.
  // This is SEPARATE from `viewMode` (which drives operator header UI).
  // When the operator impersonates a user/company, the calendar must
  // mirror what THAT user sees:
  //   - sub company  → 'sub' (yellow availability days, etc.)
  //   - gc company   → 'gc'  (request-status colors)
  // Without this, transient `viewMode==='moa'` checks elsewhere caused
  // operator-as-sub views to be filtered as a GC viewer, hiding
  // subcontractor availability (e.g., CCA July 13 not turning yellow).
  const scheduleViewMode: 'gc' | 'sub' = useMemo(() => {
    const activeCompanyId =
      impersonatedUser?.company_id || impersonatedCompany?.id || null;
    if (activeCompanyId) {
      const activeCompany =
        (impersonatedCompany && impersonatedCompany.id === activeCompanyId)
          ? impersonatedCompany
          : companies.find((c) => c.id === activeCompanyId) || null;
      if (activeCompany?.company_type === 'sub') return 'sub';
      if (activeCompany?.company_type === 'gc') return 'gc';
    }
    if (viewMode === 'sub') return 'sub';
    // Default (operator with no impersonation, or gc viewer) → GC behavior.
    return 'gc';
  }, [impersonatedCompany, impersonatedUser, companies, viewMode]);


  // Accepted contractor connections for the active company (subs only).
  const activeCompanyIdForConnections = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id || null;
  useEffect(() => {
    if (!activeCompanyIdForConnections || scheduleViewMode !== 'sub') {
      setConnectedContractorsCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from('contractor_connections')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .eq('main_company_id', activeCompanyIdForConnections);
      if (!cancelled) setConnectedContractorsCount(count || 0);
    })();
    return () => { cancelled = true; };
  }, [activeCompanyIdForConnections, scheduleViewMode]);

  useEffect(() => {
    if (!selectedProject || selectedProject === 'master') {
      setSharedContractorAssignments([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('contractor_connection_project_assignments')
        .select('connection_id, project_id, main_company_id, sub_company_id')
        .eq('project_id', selectedProject)
        .eq('shared', true);
      if (!cancelled) setSharedContractorAssignments(error ? [] : (data || []));
    })();
    return () => { cancelled = true; };
  }, [selectedProject, activeCompanyIdForConnections]);


  const fetchUserAssignedProjects = async () => {
    if (!effectiveUserId) {
      setUserAssignedProjectIds([]);
      return;
    }
    const { data } = await supabase
      .from('user_project_assignments')
      .select('project_id')
      .eq('user_id', effectiveUserId);
    setUserAssignedProjectIds(data?.map(d => d.project_id) || []);
  };

  useEffect(() => {
    if (!profile || (!isMOA && !hasPartialOrHigher)) return;

    void (async () => {
      const { error } = await supabase.functions.invoke('process-profile-email-sync');
      if (error) {
        console.error('Error processing profile email sync queue on dashboard load:', error);
      }
    })();
  }, [profile, isMOA, hasPartialOrHigher]);

  const fetchEmployeeProjectAssignments = async () => {
    const { data, error } = await supabase
      .from('employee_project_assignments')
      .select('employee_id, project_id, receive_notifications');
    if (!error && data) {
      setEmployeeProjectAssignments(data);
    }
  };

  const fetchGuestProjectConnections = async () => {
    const { data, error } = await supabase
      .from('guest_project_connections')
      .select('guest_company_id, sub_company_id');
    if (!error && data) {
      setGuestProjectConnections(data);
    }
  };

  // Auto-heal: if this user is a guest GC, ensure every accepted invite prefill
  // has a corresponding guest_project_connections row. Catches edge function failures.
  useEffect(() => {
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    if (!activeCompanyId || companies.length === 0) return;
    const activeCompany = companies.find(c => c.id === activeCompanyId);
    if (!activeCompany?.is_guest || activeCompany.company_type !== 'gc') return;

    let cancelled = false;
    (async () => {
      const { data: prefills } = await supabase
        .from('gc_invite_prefills')
        .select('sub_company_id')
        .eq('created_company_id', activeCompanyId)
        .not('accepted_at', 'is', null);
      if (cancelled || !prefills || prefills.length === 0) return;

      const existingSubIds = new Set(
        guestProjectConnections
          .filter(gc => gc.guest_company_id === activeCompanyId)
          .map(gc => gc.sub_company_id)
      );
      const missing = [...new Set(prefills.map(p => p.sub_company_id))].filter(
        id => id && !existingSubIds.has(id)
      );
      if (missing.length === 0) return;

      const rows = missing.map(sub_company_id => ({
        guest_company_id: activeCompanyId,
        sub_company_id,
      }));
      const { error: insertErr } = await supabase
        .from('guest_project_connections')
        .insert(rows);
      if (!insertErr && !cancelled) {
        fetchGuestProjectConnections();
      }
    })();

    return () => { cancelled = true; };
  }, [companies, profile?.company_id, impersonatedCompany?.id, impersonatedUser?.company_id, guestProjectConnections]);

  // Realtime subscription for schedule_requests
  useEffect(() => {
    const channel = supabase
      .channel('schedule-requests-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedule_requests'
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newRequest = payload.new as ScheduleRequest;
            setScheduleRequests(prev => {
              if (prev.some(r => r.id === newRequest.id)) return prev;
              return [...prev, newRequest];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ScheduleRequest;
            setScheduleRequests(prev => prev.map(r => 
              r.id === updated.id ? updated : r
            ));
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as { id: string };
            setScheduleRequests(prev => prev.filter(r => r.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Realtime subscription for availability
  useEffect(() => {
    const channel = supabase
      .channel('availability-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability'
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newAvail = payload.new as Availability;
            setAvailabilities(prev => {
              if (prev.some(a => a.id === newAvail.id)) return prev;
              return [...prev, newAvail];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Availability;
            setAvailabilities(prev => prev.map(a => 
              a.id === updated.id ? updated : a
            ));
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as { id: string };
            setAvailabilities(prev => prev.filter(a => a.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch cross-GC bookings: sub employees booked by OTHER GCs on visible weekly dates.
  // We hide these employees from this GC's available roster (privacy: don't reveal who/where).
  useEffect(() => {
    const activeId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    if (!activeId || scheduleViewMode === 'sub') {
      setCrossGcBookings(new Set());
      return;
    }
    // Build the visible weekly date range (8 weeks max, matching ResourceMatrix MAX_WEEKS)
    const start = new Date();
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    const dates: string[] = [];
    for (let i = 0; i < 8 * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    void (async () => {
      const { data, error } = await (supabase.rpc as any)('get_employee_cross_gc_bookings', {
        p_company_id: activeId,
        p_dates: dates,
      });
      if (error) {
        console.error('Error fetching cross-GC bookings:', error);
        return;
      }
      const set = new Set<string>();
      (data || []).forEach((row: { employee_id: string; booking_date: string }) => {
        set.add(`${row.employee_id}::${row.booking_date}`);
      });
      setCrossGcBookings(set);
    })();
  }, [profile, impersonatedCompany, impersonatedUser, viewMode, scheduleRequests]);

  const fetchCompanies = async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, company_type, trade, is_guest');
    
    if (error) {
      console.error('Error fetching companies:', error);
      return;
    }
    setCompanies(data || []);
  };

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*');

    if (error) {
      console.error('Error fetching projects:', error);
      return;
    }
    const effectiveCompanyId = impersonatedCompany?.id || impersonatedUser?.company_id || profile?.company_id || null;
    const aliases = await fetchAliasesForCompany(effectiveCompanyId);
    setAliasVisibleProjectIds(aliases.map(a => a.project_id));
    setProjects(applyAliasesToProjects((data || []) as Project[], aliases, effectiveCompanyId));
  };

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*');
    
    if (error) {
      console.error('Error fetching tasks:', error);
      return;
    }
    setTasks(data || []);
  };

  const fetchEmployees = async () => {
    const { data, error } = await fetchAllPages<Employee>((from, to) =>
      supabase
        .from('employees')
        .select('*')
        .order('id', { ascending: true })
        .range(from, to)
    );
    
    if (error) {
      console.error('Error fetching employees:', error);
      return;
    }
    const rows = (data || []) as Employee[];

    // Hide manager-tier personnel (linked user is partial / full / account_holder)
    // from schedulable employee lists. They still exist in the DB, but never
    // appear as available, in availability dots, or in request pickers.
    const linkedUserIds = Array.from(new Set(
      rows.map((e: any) => e.linked_user_id).filter(Boolean)
    )) as string[];

    if (linkedUserIds.length === 0) {
      setEmployees(rows);
      return;
    }

    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('user_id, company_id, permission_level')
      .in('user_id', linkedUserIds);

    const managerKeys = new Set(
      (roleRows || [])
        .filter((r: any) => ['partial', 'full', 'account_holder'].includes(r.permission_level))
        .map((r: any) => `${r.user_id}::${r.company_id}`)
    );

    const filtered = rows.filter((e: any) =>
      !e.linked_user_id || !managerKeys.has(`${e.linked_user_id}::${e.company_id}`)
    );
    setEmployees(filtered);
  };


  const fetchAvailabilities = async () => {
    const { startIso, endIso } = availabilityWindow;
    const { data, error } = await fetchAllPages<Availability>((from, to) =>
      supabase
        .from('availability')
        .select('*')
        .gte('start_time', startIso)
        .lt('start_time', endIso)
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)

    );
    
    if (error) {
      console.error('Error fetching availabilities:', error);
      return;
    }
    const base = (data || []) as Availability[];
    // Chunk 3: merge shared-contractor availability (remapped to the shared project)
    // so sub-of-sub personnel appear on the Main Contractor's project calendar.
    try {
      const activeCompanyId =
        impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id || null;
      if (activeCompanyId) {
        const { data: assignments } = await supabase
          .from('contractor_connection_project_assignments')
          .select('project_id, sub_company_id, shared')
          .eq('main_company_id', activeCompanyId)
          .eq('shared', true);
        const subIds = Array.from(new Set((assignments || []).map((a: any) => a.sub_company_id).filter(Boolean)));
        if (subIds.length) {
          // Own employee ids to exclude from remap (should never overlap, but be safe)
          const { data: sharedEmps } = await supabase
            .from('employees')
            .select('id, company_id')
            .in('company_id', subIds);
          const empByCompany = new Map<string, Set<string>>();
          (sharedEmps || []).forEach((e: any) => {
            if (!empByCompany.has(e.company_id)) empByCompany.set(e.company_id, new Set());
            empByCompany.get(e.company_id)!.add(e.id);
          });
          const ownAvailIds = new Set(base.map(a => a.id));
          const remapped: Availability[] = [];
          const perAssignment = await Promise.all(
            ((assignments || []) as any[]).map(async (asg) => {
              const empIds = empByCompany.get(asg.sub_company_id);
              if (!empIds || empIds.size === 0) return { asg, rows: [] as Availability[] };
              // Pull raw availability for these employees (any project / all_projects),
              // limited to the same rolling window as the base query.
              const { data: rawAv } = await supabase
                .from('availability')
                .select('*')
                .in('employee_id', Array.from(empIds))
                .gte('start_time', startIso)
                .lt('start_time', endIso);
              return { asg, rows: (rawAv || []) as Availability[] };
            })
          );
          for (const { asg, rows: rawRows } of perAssignment) {
            for (const row of rawRows) {
              if (ownAvailIds.has(row.id)) continue; // don't double-add own
              remapped.push({
                ...row,
                id: `shared:${asg.project_id}:${row.id}`,
                project_id: asg.project_id,
                all_projects: false,
              } as any);
            }
          }
          setAvailabilities([...base, ...remapped]);

          return;
        }
      }
    } catch (e) {
      console.warn('Shared contractor availability merge failed:', e);
    }
    setAvailabilities(base);
  };

  const fetchScheduleRequests = async () => {
    const { data, error } = await fetchAllPages<ScheduleRequest>((from, to) =>
      supabase
        .from('schedule_requests')
        .select('*')
        .order('scheduled_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as any
    );
    
    if (error) {
      console.error('Error fetching schedule requests:', error);
      return;
    }
    setScheduleRequests(data || []);
  };

  const handleDeleteTask = async (id: string) => {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTasks(tasks.filter(t => t.id !== id));
    toast({ title: "Task deleted" });
  };

  const handleCreateTask = async (name: string, startDate: Date, endDate: Date, sharedWithSubs?: boolean) => {
    if (selectedProject === 'master') {
      toast({ title: "Error", description: "Please select a project first", variant: "destructive" });
      return;
    }

    const colors = ['#0284c7', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        name,
        start_date: format(startDate, 'yyyy-MM-dd'),
        end_date: format(endDate, 'yyyy-MM-dd'),
        project_id: selectedProject,
        color: randomColor,
        shared_with_subs: true
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setTasks([...tasks, data]);
    toast({ title: "Task created" });
  };

  const handleEditTask = (task: Task) => {
    setTaskToEdit(task);
    setEditTaskModalOpen(true);
  };

  const handleUpdateTask = async (id: string, name: string, startDate: Date, endDate: Date, status: string, color: string, sharedWithSubs?: boolean) => {
    const updateData: any = {
      name,
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd'),
      status,
      color,
      shared_with_subs: true
    };

    const { error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setTasks(tasks.map(t => 
      t.id === id 
        ? { ...t, name, start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd'), status, color }
        : t
    ));
    toast({ title: "Task updated" });
  };

  const handleReorderTasks = (reorderedTasks: Task[]) => {
    setTasks(prevTasks => {
      const otherTasks = prevTasks.filter(t => t.project_id !== selectedProject);
      return [...otherTasks, ...reorderedTasks];
    });
  };

  const handleCreateProject = async (name: string, address: string) => {
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    const { data, error } = await supabase
      .from('projects')
      .insert({ name, address, company_id: companyId })
      .select()
      .single();

    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('PROJECT_LIMIT_REACHED')) {
        toast({
          title: 'Plan limit reached',
          description: 'You have reached your plan\'s project limit. Upgrade or delete an existing project to add more.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setProjects([...projects, data]);
    toast({ title: "Project created", description: `Code: ${data.connection_code}` });
  };

  const handleAddEmployee = async (name: string, email: string, jobTitle: string) => {
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    const { data, error } = await supabase
      .from('employees')
      .insert({ name, email, company_id: companyId, job_title: jobTitle })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    
    setEmployees([...employees, data]);
    toast({ title: "Employee added" });
  };

  const handleDeleteEmployee = async (id: string) => {
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setEmployees(employees.filter(e => e.id !== id));
  };

  const handleConnectProject = async (code: string) => {
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    // Use the new function that bypasses RLS for connection code lookup
    const { data: project, error: projectError } = await supabase
      .rpc('get_project_by_connection_code', { p_code: code })
      .maybeSingle();

    if (projectError || !project) {
      toast({ title: "Error", description: "Invalid connection code", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from('project_connections')
      .insert({ project_id: project.id, sub_company_id: companyId });

    if (error) {
      if (error.code === '23505') {
        toast({ title: "Already connected", description: "You are already connected to this project", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Connected!", description: `You are now connected to "${project.name}"` });
    fetchProjects();
    fetchTasks(); // Refetch tasks after connecting to see project tasks
  };

  const handleDeleteProject = async (projectId: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setProjects(projects.filter(p => p.id !== projectId));
    if (selectedProject === projectId) {
      setSelectedProject('master');
    }
    toast({ title: "Project deleted" });
  };

  const handleDisconnectProject = async (projectId: string) => {
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    const { error } = await supabase
      .from('project_connections')
      .delete()
      .eq('project_id', projectId)
      .eq('sub_company_id', companyId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Disconnected from project" });
    fetchProjects();
  };

  // Helper: get emails/phones of users assigned to a project with notifications enabled.
  // Uses a SECURITY DEFINER RPC so we can resolve recipients across companies
  // (e.g. a guest GC looking up the sub's assigned users, or a sub looking up
  // the GC/guest's assigned users for rejection emails). The browser RLS on
  // user_project_assignments only exposes the caller's own company, which
  // previously made every cross-company schedule email silently log
  // "No assigned email recipients" and never send.
  const getProjectAssignedRecipients = async (projectId: string, companyId: string) => {
    const { data, error } = await supabase.rpc('get_project_notification_recipients', {
      p_project_id: projectId,
      p_company_id: companyId,
    } as any);
    if (error) {
      console.error('[getProjectAssignedRecipients] rpc error', error);
      return { emails: [] as string[], phones: [] as string[], userIds: [] as string[] };
    }
    const rows = (data || []) as Array<{ email: string | null; phone: string | null }>;
    // Push notifications + People-chat messages replace the retired text channel,
    // so resolve the actual app users behind the same assignment rules.
    const { data: userRows, error: userErr } = await supabase.rpc('get_project_notification_user_ids', {
      p_project_id: projectId,
      p_company_id: companyId,
    } as any);
    if (userErr) console.error('[getProjectAssignedRecipients] user rpc error', userErr);
    return {
      emails: rows.map(r => r.email).filter(Boolean) as string[],
      phones: rows.map(r => r.phone).filter(Boolean) as string[],
      userIds: ((userRows || []) as Array<{ user_id: string }>).map(r => r.user_id).filter(Boolean),
    };
  };

  // Helper: get emails/phones of scheduled employees (respects notification preferences)
  const getScheduledEmployeeContacts = (employeeIds: string[], projectId?: string) => {
    const scheduledEmps = employees.filter(e => employeeIds.includes(e.id));
    // If we have a project context, filter by notification preferences
    const filteredEmps = projectId
      ? scheduledEmps.filter(e => {
          const assignment = employeeProjectAssignments.find(
            a => a.employee_id === e.id && a.project_id === projectId
          );
          return assignment ? assignment.receive_notifications : true;
        })
      : scheduledEmps;
    return {
      emails: filteredEmps.map(e => e.email).filter(Boolean) as string[],
      phones: filteredEmps.map(e => e.phone).filter(Boolean) as string[],
      userIds: filteredEmps.map(e => e.linked_user_id).filter(Boolean) as string[],
    };
  };

  const handleScheduleGC = async (data: {
    subCompanyIds: string[];
    employeeIds: string[];
    startTime: string;
    endTime: string;
    description: string;
    notifyEmail: boolean;
    notifyText: boolean;
    dates: Date[];
    imageUrls?: string[];
    projectId?: string;
    selectedStops?: { employeeId: string; stopNumber: number; startTime: string; endTime: string }[];
    guestGcCompanyName?: string;
    guestGcProjectName?: string;
  }) => {
    if (data.subCompanyIds.length === 0 || data.dates.length === 0) return;
    
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    let projectId = data.projectId || selectedProject;
    
    if (!projectId || projectId === 'master') {
      toast({ title: "Error", description: "Please select a specific project before scheduling", variant: "destructive" });
      return;
    }

    const projectName = projects.find(p => p.id === projectId)?.name || 'Unknown Project';
    const requestingCompanyName = companies.find(c => c.id === companyId)?.name || 'Unknown Company';

    // One group id for this entire Send Request click — collapses multi-day into one notification batch.
    const requestGroupId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;
    const allDateStrs = data.dates.map(d => format(d, 'yyyy-MM-dd'));

    // The GC checks the MAIN subcontractor, but the personnel they picked may belong to a
    // sub-of-sub sitting under that main sub. Requests must be created against the company
    // that actually owns each person, with the main sub kept as the intermediary.
    //
    // Ownership + availability are NEVER resolved from local state alone: if the cached
    // roster/availability is stale or outside the rolling window, a valid selection would
    // silently produce "no availability". Anything missing locally is read from the database.
    const ownerByEmployeeId = new Map<string, string>();
    for (const empId of data.employeeIds) {
      const owner = employees.find(e => e.id === empId)?.company_id;
      if (owner) ownerByEmployeeId.set(empId, owner);
    }
    const missingOwnerIds = data.employeeIds.filter(id => !ownerByEmployeeId.has(id));
    if (missingOwnerIds.length > 0) {
      const { data: ownerRows } = await supabase
        .from('employees')
        .select('id, company_id')
        .in('id', missingOwnerIds);
      (ownerRows || []).forEach((r: any) => {
        if (r?.id && r?.company_id) ownerByEmployeeId.set(r.id, r.company_id);
      });
    }

    const targetCompanyIds: string[] = [];
    ownerByEmployeeId.forEach((owner) => {
      if (owner && !targetCompanyIds.includes(owner)) targetCompanyIds.push(owner);
    });
    if (targetCompanyIds.length === 0) targetCompanyIds.push(...data.subCompanyIds);

    // Availability lookup keys: employeeId::yyyy-MM-dd. Seeded from what the user actually
    // checked in the modal (authoritative — those rows came from real availability), then the
    // cached availability, then a direct read for exactly these people and dates.
    const utcDateStr = (iso: string) => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const availKeys = new Set<string>();
    (data.selectedStops || []).forEach((s: any) => {
      if (s?.employeeId && s?.date) availKeys.add(`${s.employeeId}::${s.date}`);
    });
    availabilities.forEach(a => {
      if (data.employeeIds.includes(a.employee_id)) {
        availKeys.add(`${a.employee_id}::${utcDateStr(a.start_time)}`);
      }
    });
    const needsDbLookup =
      data.employeeIds.length > 0 &&
      data.employeeIds.some(empId => allDateStrs.some(ds => !availKeys.has(`${empId}::${ds}`)));
    if (needsDbLookup) {
      const sortedDateStrs = [...allDateStrs].sort();
      const rangeEnd = new Date(`${sortedDateStrs[sortedDateStrs.length - 1]}T00:00:00.000Z`);
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
      const { data: freshAvail, error: freshErr } = await supabase
        .from('availability')
        .select('employee_id, start_time')
        .in('employee_id', data.employeeIds)
        .gte('start_time', `${sortedDateStrs[0]}T00:00:00.000Z`)
        .lt('start_time', rangeEnd.toISOString());
      if (freshErr) console.error('Error verifying availability before request:', freshErr);
      (freshAvail || []).forEach((a: any) => {
        availKeys.add(`${a.employee_id}::${utcDateStr(a.start_time)}`);
      });
    }

    let requestsCreated = 0;
    for (const subCompanyId of targetCompanyIds) {
      const subEmployeeIds = data.employeeIds.filter(empId =>
        (ownerByEmployeeId.get(empId) || subCompanyId) === subCompanyId
      );

      const subCompanyName = companies.find(c => c.id === subCompanyId)?.name || 'Unknown Sub';

      let datesScheduled = 0;
      const scheduledDateStrs: string[] = [];
      for (const date of data.dates) {
        const dateStr = format(date, 'yyyy-MM-dd');

        const employeesWithAvailOnDate = subEmployeeIds.filter(empId =>
          availKeys.has(`${empId}::${dateStr}`)
        );

        if (employeesWithAvailOnDate.length === 0) continue;


        const { error } = await supabase.from('schedule_requests').insert({
          project_id: projectId,
          sub_company_id: subCompanyId,
          requesting_company_id: companyId,
          ...(intermediaryByCompanyId[subCompanyId] && intermediaryByCompanyId[subCompanyId] !== companyId
            ? { intermediary_company_id: intermediaryByCompanyId[subCompanyId] }
            : {}),
          scheduled_date: dateStr,
          start_time: data.startTime,
          end_time: data.endTime,
          description: data.description,
          status: 'pending',
          employee_ids: employeesWithAvailOnDate,
          image_urls: data.imageUrls || [],
          guest_gc_company_name: data.guestGcCompanyName || null,
          guest_gc_project_name: data.guestGcProjectName || null,
          request_group_id: requestGroupId,
          scheduled_dates: allDateStrs,
        });

        if (error) {
          console.error('Error creating schedule request:', error);
          toast({ title: "Error", description: error.message, variant: "destructive" });
          return;
        }
        datesScheduled++;
        requestsCreated++;
        scheduledDateStrs.push(dateStr);
      }
      
      if (datesScheduled === 0) {
        toast({ title: "No availability", description: `No subcontractor availability found on the selected dates for ${subCompanyName}`, variant: "destructive" });
        continue;
      }

      // Build personnel block with 12-hour times. Used by both email and SMS.
      const requestedEmps = employees.filter(e => subEmployeeIds.includes(e.id));
      const employeeDetailsHtml = requestedEmps.map(emp => {
        const empAvails = availabilities.filter(a => {
          const d = new Date(a.start_time);
          const availDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          return a.employee_id === emp.id && data.dates.some(dt => format(dt, 'yyyy-MM-dd') === availDate);
        });
        const stopInfo = empAvails
          .sort((a, b) => (a.stop_number || 0) - (b.stop_number || 0))
          .map(a => {
            const timeStr = `${formatUTCTime12(a.start_time)} – ${formatUTCTime12(a.end_time)}`;
            return a.stop_number ? `Stop ${a.stop_number}: ${timeStr}` : timeStr;
          })
          .join(', ');
        return `<li><strong>${emp.name}</strong>${emp.job_title ? ` (${emp.job_title})` : ''}${stopInfo ? ` — ${stopInfo}` : ''}</li>`;
      }).join('');
      const employeeDetailsBlock = employeeDetailsHtml
        ? `<p><strong>Personnel:</strong></p><ul>${employeeDetailsHtml}</ul>`
        : '<p>No specific personnel listed</p>';

      const employeeSummaryText = requestedEmps.map(emp => {
        const empAvails = availabilities.filter(a => {
          const d = new Date(a.start_time);
          const availDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          return a.employee_id === emp.id && data.dates.some(dt => format(dt, 'yyyy-MM-dd') === availDate);
        });
        const stopInfo = empAvails
          .sort((a, b) => (a.stop_number || 0) - (b.stop_number || 0))
          .map(a => `${formatUTCTime12(a.start_time)}-${formatUTCTime12(a.end_time)}`)
          .join(', ');
        return `${emp.name}${emp.job_title ? ` (${emp.job_title})` : ''}${stopInfo ? ` ${stopInfo}` : ''}`;
      }).join('; ');

      const scheduledDateLabel = scheduledDateStrs
        .map(s => format(new Date(s + 'T00:00:00'), 'MMM d, yyyy'))
        .join(', ');
      const startTime12 = formatTime12(data.startTime);
      const endTime12 = formatTime12(data.endTime);

      // Single recipient resolution so email + SMS can't drift
      const { emails: assignedEmails, userIds: assignedUserIds } =
        await getProjectAssignedRecipients(projectId, subCompanyId);

      // If a channel is toggled on but no recipients exist, log a warning
      // so operators can see the silent zero-send. NEVER fall back to other recipients.
      // NOTE: notification_log columns are (event_type, channel, recipient_email,
      // recipient_company_id, subject, status, error_message, metadata).
      // Don't insert non-existent columns like `project_id` — that fails silently.
      if (data.notifyEmail && assignedEmails.length === 0) {
        try {
          await supabase.from('notification_log').insert({
            event_type: 'schedule_created',
            channel: 'email',
            status: 'warning',
            error_message: `No assigned email recipients on project ${projectId} for company ${subCompanyId}. Request group ${requestGroupId}.`,
            recipient_company_id: subCompanyId,
            metadata: { project_id: projectId, request_group_id: requestGroupId },
          } as any);
        } catch (e) {
          console.warn('notification_log insert failed', e);
        }
      }
      if (data.notifyText && assignedUserIds.length === 0) {
        try {
          await supabase.from('notification_log').insert({
            event_type: 'schedule_created',
            channel: 'push',
            status: 'warning',
            error_message: `No assigned push recipients on project ${projectId} for company ${subCompanyId}. Request group ${requestGroupId}.`,
            recipient_company_id: subCompanyId,
            metadata: { project_id: projectId, request_group_id: requestGroupId },
          } as any);
        } catch (e) {
          console.warn('notification_log insert failed', e);
        }
      }

      if (data.notifyEmail && assignedEmails.length > 0) {
        // Await so an invoke error is caught by useNotification's
        // logInvocationFailure helper instead of being swallowed.
        await sendNotification({
          eventType: 'schedule_created',
          recipientEmails: assignedEmails,
          recipientCompanyId: subCompanyId,
          projectId,
          variables: {
            project_name: projectName,
            requesting_company: requestingCompanyName,
            sub_company: subCompanyName,
            scheduled_date: scheduledDateLabel,
            start_time: startTime12,
            end_time: endTime12,
            description: data.description || 'No description provided',
            employee_details: employeeDetailsBlock,
          },
        });
      }

      if (data.notifyText && assignedUserIds.length > 0) {
        // Push + a People message from the requester to each project-assigned
        // Level 3 / Level 4 / account-holder user on the sub side. The project
        // chat message is emitted separately by the DB trigger and is unchanged.
        await sendNotification({
          eventType: 'schedule_created',
          recipientEmails: [],
          recipientUserIds: assignedUserIds,
          recipientCompanyId: subCompanyId,
          projectId,
          senderUserId: effectiveUserId || undefined,
          variables: {
            project_name: projectName,
            requesting_company: requestingCompanyName,
            sub_company: subCompanyName,
            scheduled_date: scheduledDateLabel,
            start_time: startTime12,
            end_time: endTime12,
            employee_summary: employeeSummaryText || 'See dashboard for details',
          },
        });
      }

    }

    if (requestsCreated === 0) {
      toast({
        title: "No request sent",
        description: "None of the selected personnel had availability on the selected dates. Nothing was submitted.",
        variant: "destructive",
      });
      return;
    }

    toast({ 
      title: "Request sent", 
      description: `Schedule request sent to ${targetCompanyIds.length} sub(s) for days with availability` 
    });
    fetchScheduleRequests();
  };

  const handleScheduleSub = async (data: {
    employeeIds: string[];
    startTime: string;
    endTime: string;
    projectIds: string[];
    allProjects: boolean;
    dates: Date[];
    stops?: Array<{ startTime: string; endTime: string; stopNumber: number; stopLabel: string }>;
    assignedProjectIdsByEmployee?: Record<string, string[]>;
  }) => {
    if (data.dates.length === 0 || data.employeeIds.length === 0) return;

    // Resolve which projects an employee should actually receive availability rows for.
    // Honors the per-employee override map from the modal's cross-project guard.
    const resolveProjectIdsFor = (employeeId: string): (string | null)[] => {
      const override = data.assignedProjectIdsByEmployee?.[employeeId];
      if (override !== undefined) {
        if (override.length === 0) return []; // explicitly skip — no allowed projects
        // If override contains every company project AND the user picked allProjects,
        // collapse to a single null row to preserve the "all projects" semantic.
        if (data.allProjects) {
          const companyProjectIds = projects.map(p => p.id);
          const isFullySet = companyProjectIds.length > 0
            && companyProjectIds.every(pid => override.includes(pid));
          if (isFullySet) return [null];
        }
        return override;
      }
      // Legacy behavior (no override provided)
      return data.allProjects ? [null] : (data.projectIds.length > 0 ? data.projectIds : [null]);
    };

    for (const date of data.dates) {
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Delete existing availability for this date for the specific employees being submitted
      const existingForDate = availabilities.filter(a => {
        const d = new Date(a.start_time);
        const availDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        return availDate === dateStr && data.employeeIds.includes(a.employee_id);
      });

      for (const avail of existingForDate) {
        await supabase.from('availability').delete().eq('id', avail.id);
      }

      // If multiple stops are provided, create one availability record per stop per employee per project
      if (data.stops && data.stops.length > 0) {
        for (const employeeId of data.employeeIds) {
          const projectIdsToUse = resolveProjectIdsFor(employeeId);
          if (projectIdsToUse.length === 0) continue;
          // Determine the all_projects flag for this employee:
          //  - true only when we ended up writing a single null row for "all projects"
          const empAllProjects = data.allProjects && projectIdsToUse.length === 1 && projectIdsToUse[0] === null;
          for (const projectId of projectIdsToUse) {
            for (const stop of data.stops) {
              const startDateTime = `${dateStr}T${stop.startTime}:00`;
              const endDateTime = `${dateStr}T${stop.endTime}:00`;

              const { error } = await supabase.from('availability').insert({
                employee_id: employeeId,
                start_time: startDateTime,
                end_time: endDateTime,
                project_id: projectId,
                all_projects: empAllProjects,
                stop_number: stop.stopNumber,
                stop_label: stop.stopLabel
              });

              if (error) {
                console.error('Error setting availability:', error);
                toast({ title: "Error", description: error.message, variant: "destructive" });
                return;
              }
            }
          }
        }
      } else {
        // Single time range (no multiple stops)
        const startDateTime = `${dateStr}T${data.startTime}:00`;
        const endDateTime = `${dateStr}T${data.endTime}:00`;

        for (const employeeId of data.employeeIds) {
          const projectIdsToUse = resolveProjectIdsFor(employeeId);
          if (projectIdsToUse.length === 0) continue;
          const empAllProjects = data.allProjects && projectIdsToUse.length === 1 && projectIdsToUse[0] === null;
          for (const projectId of projectIdsToUse) {
            const { error } = await supabase.from('availability').insert({
              employee_id: employeeId,
              start_time: startDateTime,
              end_time: endDateTime,
              project_id: projectId,
              all_projects: empAllProjects
            });

            if (error) {
              console.error('Error setting availability:', error);
              toast({ title: "Error", description: error.message, variant: "destructive" });
              return;
            }
          }
        }
      }
    }

    const dateCount = data.dates.length;
    const stopInfo = data.stops ? ` with ${data.stops.length} stop(s)` : '';
    toast({ 
      title: "Availability set", 
      description: `${data.employeeIds.length} employee(s) marked available for ${dateCount} day(s)${stopInfo}` 
    });
    fetchAvailabilities();
  };

  const handleSubAssign = async (data: {
    employeeIds: string[];
    startTime: string;
    endTime: string;
    dates: Date[];
    notifyGC: boolean;
    notifyPersonnelEmail?: boolean;
    notifyPersonnelSms?: boolean;
    projectId: string;
  }) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId || data.employeeIds.length === 0 || data.dates.length === 0) return;

    const projectName = projects.find(p => p.id === data.projectId)?.name || 'Unknown Project';
    const subCompanyName = companies.find(c => c.id === companyId)?.name || 'Unknown Sub';

    // Split the selection by owning company: own personnel are assigned directly,
    // personnel belonging to a connected sub-of-sub become pending requests to them.
    const byOwner = new Map<string, string[]>();
    for (const empId of data.employeeIds) {
      const owner = employees.find(e => e.id === empId)?.company_id || companyId;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(empId);
    }

    const createdRequestIds: string[] = [];
    let requestedOtherCompany = false;
    for (const date of data.dates) {
      const dateStr = format(date, 'yyyy-MM-dd');

      for (const [ownerCompanyId, empIds] of byOwner) {
        const isOwn = ownerCompanyId === companyId;
        if (!isOwn) requestedOtherCompany = true;

        const { data: inserted, error } = await supabase.from('schedule_requests').insert({
          project_id: data.projectId,
          sub_company_id: ownerCompanyId,
          requesting_company_id: companyId,
          ...(isOwn ? {} : { intermediary_company_id: companyId }),
          scheduled_date: dateStr,
          start_time: data.startTime,
          end_time: data.endTime,
          status: isOwn ? 'confirmed' : 'pending',
          employee_ids: empIds,
          sub_assigned: isOwn,
          silent_assignment: isOwn ? !data.notifyGC : false
        }).select('id').single();

        if (error) {
          console.error('Error creating sub-assigned request:', error);
          toast({ title: "Error", description: error.message, variant: "destructive" });
          return;
        }
        if (inserted?.id && isOwn) createdRequestIds.push(inserted.id);
      }
    }

    // Send notification to GC if notifyGC is true
    if (data.notifyGC) {
      const project = projects.find(p => p.id === data.projectId);
      if (project) {
        const gcCompanyId = project.company_id;
        const { emails: gcEmails } = await getProjectAssignedRecipients(data.projectId, gcCompanyId);
        
        if (gcEmails.length > 0) {
          sendNotification({
            eventType: 'personnel_assigned',
            recipientEmails: gcEmails,
            recipientCompanyId: gcCompanyId,
            projectId: data.projectId,
            variables: {
              project_name: projectName,
              sub_company: subCompanyName,
              scheduled_date: data.dates.map(d => format(d, 'MMM d, yyyy')).join(', '),
              start_time: data.startTime,
              end_time: data.endTime,
            },
          });
        }
      }
    }

    // Optionally notify scheduled personnel immediately on selected channels
    if (data.notifyPersonnelEmail || data.notifyPersonnelSms) {
      for (const reqId of createdRequestIds) {
        try {
          await notifyScheduledPersonnel(reqId, { email: !!data.notifyPersonnelEmail, sms: !!data.notifyPersonnelSms });
        } catch (e) {
          console.error('notifyScheduledPersonnel failed', reqId, e);
        }
      }
    }

    const empNames = employees.filter(e => data.employeeIds.includes(e.id)).map(e => e.name).join(', ');
    toast({ 
      title: requestedOtherCompany ? "Personnel assigned — requests sent" : "Personnel assigned", 
      description: requestedOtherCompany
        ? `${empNames} scheduled for ${projectName}. Personnel from connected subcontractors were sent as requests awaiting their approval.`
        : `${empNames} assigned to ${projectName} for ${data.dates.length} day(s)${data.notifyGC ? '' : ' (silent)'}` 
    });
    fetchScheduleRequests();
  };

  const handleRemoveAvailability = async (employeeId: string, specificDates?: Date[]) => {
    // Use specific dates if provided, otherwise use selected dates
    const datesToRemove = specificDates || (selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []));
    
    if (datesToRemove.length === 0) return;
    
    for (const date of datesToRemove) {
      const dateStr = format(date, 'yyyy-MM-dd');
      // Find ALL matching availability records (handles multiple stops per date)
      const toRemoveRecords = availabilities.filter(a => {
        const availDateUTC = new Date(a.start_time);
        const availDate = format(new Date(availDateUTC.getUTCFullYear(), availDateUTC.getUTCMonth(), availDateUTC.getUTCDate()), 'yyyy-MM-dd');
        return availDate === dateStr && a.employee_id === employeeId;
      });

      for (const record of toRemoveRecords) {
        const { error } = await supabase.from('availability').delete().eq('id', record.id);
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
          return;
        }
      }
    }
    
    fetchAvailabilities();
    toast({ title: "Availability removed", description: `Removed availability for ${datesToRemove.length} date(s)` });
  };

  const notifyScheduledPersonnel = async (requestId: string, options?: { email?: boolean; sms?: boolean }) => {
    const wantEmail = options?.email ?? true;
    const wantPush = options?.sms ?? true;
    if (!wantEmail && !wantPush) return;
    const request = scheduleRequests.find(r => r.id === requestId);
    if (!request) return;
    const project = projects.find(p => p.id === request.project_id);
    const subCompany = companies.find(c => c.id === request.sub_company_id);
    const empIds = Array.from(new Set((request.employee_ids || []) as string[]));
    if (empIds.length === 0) return;

    const { data: personnelRows } = await supabase
      .from('employees')
      .select('id, email')
      .in('id', empIds);
    const emailById = new Map<string, string>();
    (personnelRows || []).forEach(row => { if (row.email) emailById.set(row.id, row.email as string); });
    const relatedDates = scheduleRequests
      .filter(r => r.project_id === request.project_id && r.sub_company_id === request.sub_company_id && (r.employee_ids || []).some(id => empIds.includes(id)) && ['confirmed', 'pending'].includes(r.status || ''))
      .map(r => r.scheduled_date);
    const dates = Array.from(new Set([request.scheduled_date, ...relatedDates])).sort().join(', ');

    const sendGroup = async (groupEmpIds: string[], startLabel: string, endLabel: string, stopLabel?: string) => {
      if (groupEmpIds.length === 0) return;
      const emails = wantEmail
        ? Array.from(new Set(groupEmpIds.map(id => emailById.get(id)).filter(Boolean) as string[]))
        : [];
      await sendNotification({
        eventType: 'schedule_confirmed_personnel',
        recipientEmails: emails,
        recipientUserIds: [],
        employeeIds: wantPush ? groupEmpIds : [],
        recipientCompanyId: request.sub_company_id,
        projectId: request.project_id,
        senderUserId: effectiveUserId || undefined,
        variables: {
          project_name: project?.name || request.guest_gc_project_name || 'Scheduled project',
          project_address: project?.address || '',
          sub_company_name: subCompany?.name || 'Your subcontractor team',
          scheduled_dates: dates,
          scheduled_date: dates,
          start_time: startLabel,
          end_time: endLabel,
          ...(stopLabel ? { stop_label: stopLabel } : {}),
        },
      });
    };

    // Per-stop notifications: each selected stop gets its own message so personnel
    // know exactly which shift(s) they are on. Employees without a recorded stop
    // selection get one message for the whole request (legacy behaviour).
    const stopMap = (request.employee_stops || {}) as Record<string, string[]>;
    const byStop = new Map<string, string[]>();
    const noStopEmpIds: string[] = [];
    empIds.forEach(id => {
      const stops = stopMap[id];
      if (stops && stops.length > 0) {
        stops.forEach(stopId => {
          if (!byStop.has(stopId)) byStop.set(stopId, []);
          byStop.get(stopId)!.push(id);
        });
      } else {
        noStopEmpIds.push(id);
      }
    });

    for (const [stopId, groupEmpIds] of byStop) {
      const avail = availabilities.find(a => a.id === stopId);
      const startLabel = avail ? formatUTCTime12(avail.start_time) : (request.start_time ? formatTime12(request.start_time) : '');
      const endLabel = avail ? formatUTCTime12(avail.end_time) : (request.end_time ? formatTime12(request.end_time) : '');
      const stopLabel = avail?.stop_label || (avail?.stop_number ? `Stop ${avail.stop_number}` : undefined);
      await sendGroup(groupEmpIds, startLabel, endLabel, stopLabel);
    }

    await sendGroup(
      noStopEmpIds,
      request.start_time ? formatTime12(request.start_time) : '',
      request.end_time ? formatTime12(request.end_time) : ''
    );
  };

  const handleNotifyPersonnel = async (requestId: string) => {
    if (!ensureCanActOnRequests()) return;
    await notifyScheduledPersonnel(requestId);
    toast({ title: 'Personnel notified' });
  };

  const handleApproveRequest = async (requestId: string) => {
    if (!ensureCanActOnRequests()) return;
    const { error } = await supabase
      .from('schedule_requests')
      .update({ status: 'confirmed' })
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r =>
      r.id === requestId ? { ...r, status: 'confirmed' } : r
    ));
    toast({ title: "Request approved" });

    // On approval: notify ONLY the scheduled personnel (employee email/phone
    // and their linked user's profile, if any). Managers are intentionally
    // NOT re-notified by email/SMS — they see the confirmation in the
    // project messages thread.
    await notifyScheduledPersonnel(requestId);
  };

  const handleRejectRequest = async (requestId: string, reason?: string) => {
    if (!ensureCanActOnRequests()) return;
    // Update status to 'rejected' and track who initiated it
    const companyId = impersonatedCompany?.id || profile?.company_id;
    const trimmed = reason?.trim() || null;

    const request = scheduleRequests.find(r => r.id === requestId);

    const { error } = await supabase
      .from('schedule_requests')
      .update({ status: 'rejected', cancelled_by_company_id: companyId, cancellation_reason: trimmed } as any)
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error rejecting request", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { ...r, status: 'rejected', cancelled_by_company_id: companyId, cancellation_reason: trimmed } : r
    ));
    toast({ title: "Request rejected", description: "The GC has been notified." });

    // Send rejection notification to the requesting (GC/guest) side.
    // Uses the active `schedule_cancelled` template (rejection is a cancellation-style event
    // from the requester's POV). Operator toggles in Manage Correspondence remain the master
    // kill-switch: if the template is inactive, send-notification returns without sending.
    if (request) {
      try {
        const rejectingCompanyName = companies.find(c => c.id === companyId)?.name || 'The subcontractor';
        const projectName = projects.find(p => p.id === request.project_id)?.name || 'Unknown Project';
        const requestingCompanyName = companies.find(c => c.id === request.requesting_company_id)?.name || '';
        const subCompanyName = companies.find(c => c.id === request.sub_company_id)?.name || '';

        const { emails: assignedEmails, userIds: assignedUserIds } =
          await getProjectAssignedRecipients(request.project_id, request.requesting_company_id);

        const vars = {
          project_name: projectName,
          requesting_company: requestingCompanyName,
          sub_company: subCompanyName,
          cancelling_company: rejectingCompanyName,
          scheduled_date: request.scheduled_date,
          start_time: request.start_time ? formatTime12(request.start_time) : '',
          end_time: request.end_time ? formatTime12(request.end_time) : '',
          cancellation_reason: trimmed || 'No reason provided',
        };

        if (assignedEmails.length > 0) {
          await sendNotification({
            eventType: 'schedule_cancelled',
            recipientEmails: assignedEmails,
            recipientCompanyId: request.requesting_company_id,
            projectId: request.project_id,
            variables: vars,
          });
        } else {
          // Surface silent zero-recipient so operators see it in the log.
          try {
            await supabase.from('notification_log').insert({
              event_type: 'schedule_cancelled',
              channel: 'email',
              status: 'warning',
              error_message: `Reject: no assigned email recipients on project ${request.project_id} for requesting company ${request.requesting_company_id}.`,
              recipient_company_id: request.requesting_company_id,
              metadata: { project_id: request.project_id, request_id: request.id },
            } as any);
          } catch {}
        }

        if (assignedUserIds.length > 0) {
          await sendNotification({
            eventType: 'schedule_cancelled',
            recipientEmails: [],
            recipientUserIds: assignedUserIds,
            recipientCompanyId: request.requesting_company_id,
            projectId: request.project_id,
            variables: vars,
          });
        }
      } catch (notifyErr) {
        console.error('[handleRejectRequest] notification error', notifyErr);
      }
    }
  };

  const handleCancelRequest = async (requestId: string, reason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    const request = scheduleRequests.find(r => r.id === requestId);
    if (!request) return;

    const sendCancelNotification = async () => {
      const cancellingCompanyName = companies.find(c => c.id === companyId)?.name || 'Unknown';
      const project = projects.find(p => p.id === request.project_id);
      const projectName = project?.name || 'Unknown Project';
      const otherCompanyId = request.requesting_company_id === companyId
        ? request.sub_company_id
        : request.requesting_company_id;
      const employeeIds = Array.from(new Set(request.employee_ids || []));

      // Keep the existing assigned-recipient email behavior for the opposite
      // company, but always include every scheduled employee directly.
      const { emails: assignedEmails } = await getProjectAssignedRecipients(request.project_id, otherCompanyId);
      const { data: employeeRows, error: employeeError } = employeeIds.length > 0
        ? await supabase.from('employees').select('id, email').in('id', employeeIds)
        : { data: [], error: null };
      if (employeeError) throw employeeError;

      const employeeEmails = (employeeRows || [])
        .map(row => row.email?.trim().toLowerCase())
        .filter(Boolean) as string[];
      const allEmails = Array.from(new Set([...assignedEmails, ...employeeEmails]));
      const scheduledDates = Array.from(new Set([
        ...(((request as any).scheduled_dates || []) as string[]),
        request.scheduled_date,
      ].filter(Boolean))).sort().join(', ');
      const vars = {
        project_name: projectName,
        project_address: project?.address || '',
        requesting_company: companies.find(c => c.id === request.requesting_company_id)?.name || '',
        sub_company: companies.find(c => c.id === request.sub_company_id)?.name || '',
        cancelling_company: cancellingCompanyName,
        scheduled_date: scheduledDates,
        scheduled_dates: scheduledDates,
        start_time: request.start_time ? formatTime12(request.start_time) : '',
        end_time: request.end_time ? formatTime12(request.end_time) : '',
        cancellation_reason: reason?.trim() || 'No reason provided',
        reason: reason?.trim() || 'No reason provided',
      };

      if (allEmails.length > 0) {
        await sendNotification({
          eventType: 'schedule_cancelled',
          recipientEmails: allEmails,
          recipientCompanyId: otherCompanyId,
          projectId: request.project_id,
          variables: vars,
        });
      }

      // Personnel cancellation delivery is deliberately based on the request's
      // employee_ids, not project assignments or notification preferences.
      if (employeeIds.length > 0) {
        await sendNotification({
          eventType: 'schedule_cancelled',
          recipientEmails: [],
          employeeIds,
          recipientCompanyId: request.sub_company_id,
          projectId: request.project_id,
          senderUserId: effectiveUserId || undefined,
          variables: vars,
        });
      }
    };

    
    if (request.requesting_company_id === companyId) {
      if (request.status === 'confirmed') {
        const { error } = await supabase
          .from('schedule_requests')
          .update({ status: 'cancelled', cancelled_by_company_id: companyId, cancellation_reason: reason || null } as any)
          .eq('id', requestId);

        if (error) {
          toast({ title: "Error cancelling request", description: error.message, variant: "destructive" });
          return;
        }

        setScheduleRequests(prev => prev.map(r => 
          r.id === requestId ? { ...r, status: 'cancelled', cancelled_by_company_id: companyId } : r
        ));
        toast({ title: "Request cancelled", description: "The subcontractor has been notified." });
        await sendCancelNotification();
      } else {
        const { error } = await supabase
          .from('schedule_requests')
          .delete()
          .eq('id', requestId);

        if (error) {
          toast({ title: "Error cancelling request", description: error.message, variant: "destructive" });
          return;
        }

        setScheduleRequests(prev => prev.filter(r => r.id !== requestId));
        toast({ title: "Request cancelled" });
      }
    } else {
      const { error } = await supabase
        .from('schedule_requests')
        .update({ status: 'cancelled', cancelled_by_company_id: companyId, cancellation_reason: reason || null } as any)
        .eq('id', requestId);

      if (error) {
        toast({ title: "Error cancelling request", description: error.message, variant: "destructive" });
        return;
      }

      setScheduleRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'cancelled', cancelled_by_company_id: companyId } : r
      ));
      toast({ title: "Request cancelled", description: "The GC has been notified." });
       await sendCancelNotification();
    }
  };

  const handleEditPendingRequestRemoveEmployee = async (requestId: string, employeeId: string) => {
    if (!ensureCanActOnRequests()) return;
    const request = scheduleRequests.find(r => r.id === requestId);
    if (!request) return;

    const currentEmployeeIds = request.employee_ids || [];
    const updatedEmployeeIds = currentEmployeeIds.filter(id => id !== employeeId);

    if (updatedEmployeeIds.length === 0) {
      // No employees left — reject the request
      const companyId = impersonatedCompany?.id || profile?.company_id;
      const { error } = await supabase
        .from('schedule_requests')
        .update({ status: 'rejected', cancelled_by_company_id: companyId })
        .eq('id', requestId);

      if (error) {
        console.error('Error rejecting empty request:', error);
        return;
      }

      setScheduleRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'rejected', cancelled_by_company_id: companyId } : r
      ));
    } else {
      // Remove employee from the request
      const { error } = await supabase
        .from('schedule_requests')
        .update({ employee_ids: updatedEmployeeIds, edited: true })
        .eq('id', requestId);

      if (error) {
        console.error('Error editing request to remove employee:', error);
        return;
      }

      setScheduleRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, employee_ids: updatedEmployeeIds, edited: true } : r
      ));
    }
  };

  // Handle editing a confirmed request (Sub unselects employees)
  const handleEditConfirmedRequest = async (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Find the current request to save original values
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Save original values if not already saved (first edit)
    const originalEmployeeIds = currentRequest.original_employee_ids?.length 
      ? currentRequest.original_employee_ids 
      : currentRequest.employee_ids || [];
    const originalStartTime = currentRequest.original_start_time || currentRequest.start_time;
    const originalEndTime = currentRequest.original_end_time || currentRequest.end_time;
    
    // If checkedEmployeeIds provided, update only those employees' availability records
    if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
      const scheduledDate = currentRequest.scheduled_date; // yyyy-MM-dd
      
      for (const empId of checkedEmployeeIds) {
        // Find availability records for this employee on this date
        const empAvails = availabilities.filter(a => {
          const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
          return a.employee_id === empId && availDate === scheduledDate;
        });
        
        for (const avail of empAvails) {
          const newStartTimestamp = `${scheduledDate}T${startTime}:00`;
          const newEndTimestamp = `${scheduledDate}T${endTime}:00`;
          
          await supabase
            .from('availability')
            .update({ start_time: newStartTimestamp, end_time: newEndTimestamp })
            .eq('id', avail.id);
        }
      }
      
      // Refresh availabilities to get updated data
      await fetchAvailabilities();
      
      // Recalculate request times from all remaining employees' availability
      const updatedAvails = await supabase
        .from('availability')
        .select('*')
        .in('employee_id', employeeIds);
      
      let recalcStartTime = startTime;
      let recalcEndTime = endTime;
      
      if (updatedAvails.data && updatedAvails.data.length > 0) {
        const dateAvails = updatedAvails.data.filter(a => {
          const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
          return availDate === scheduledDate;
        });
        
        if (dateAvails.length > 0) {
          const earliest = dateAvails.reduce((min, a) => 
            new Date(a.start_time) < new Date(min.start_time) ? a : min
          );
          const latest = dateAvails.reduce((max, a) => 
            new Date(a.end_time) > new Date(max.end_time) ? a : max
          );
          const d1 = new Date(earliest.start_time);
          const d2 = new Date(latest.end_time);
          recalcStartTime = `${d1.getUTCHours().toString().padStart(2, '0')}:${d1.getUTCMinutes().toString().padStart(2, '0')}`;
          recalcEndTime = `${d2.getUTCHours().toString().padStart(2, '0')}:${d2.getUTCMinutes().toString().padStart(2, '0')}`;
        }
      }
      
      startTime = recalcStartTime;
      endTime = recalcEndTime;
    }
    
    const updateData: Record<string, any> = { 
      edited: true, 
      employee_ids: employeeIds,
      original_employee_ids: originalEmployeeIds,
      original_start_time: originalStartTime,
      original_end_time: originalEndTime,
      last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
    };
    
    if (startTime) updateData.start_time = startTime;
    if (endTime) updateData.end_time = endTime;
    
    // Mark the request as edited and update employee_ids
    const { error } = await supabase
      .from('schedule_requests')
      .update(updateData)
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { 
        ...r, 
        edited: true, 
        employee_ids: employeeIds,
        original_employee_ids: originalEmployeeIds,
        original_start_time: originalStartTime,
        original_end_time: originalEndTime,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
        ...(startTime ? { start_time: startTime } : {}),
        ...(endTime ? { end_time: endTime } : {})
      } : r
    ));
    toast({ title: "Schedule updated", description: "The GC has been notified of changes." });
  };

  // Handle Sub editing all confirmed requests on selected dates at once
  const handleEditConfirmedRequestForAllDates = async (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Get the dates to apply to (from selectedDates)
    const datesToApply = selectedDates.length > 0 
      ? selectedDates.map(d => format(d, 'yyyy-MM-dd'))
      : (selectedDate ? [format(selectedDate, 'yyyy-MM-dd')] : []);
    
    if (datesToApply.length === 0) return;
    
    // Get the request being edited to find matching requests on other dates
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Find all matching confirmed requests on selected dates (same project)
    const matchingRequests = scheduleRequests.filter(r => 
      (r.sub_company_id === companyId || r.intermediary_company_id === companyId) &&
      r.project_id === currentRequest.project_id &&
      datesToApply.includes(r.scheduled_date) &&
      r.status === 'confirmed'
    );
    
    if (matchingRequests.length === 0) return;
    
    // If checkedEmployeeIds provided, update those employees' availability for each date
    if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
      for (const req of matchingRequests) {
        const scheduledDate = req.scheduled_date;
        for (const empId of checkedEmployeeIds) {
          const empAvails = availabilities.filter(a => {
            const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
            return a.employee_id === empId && availDate === scheduledDate;
          });
          for (const avail of empAvails) {
            await supabase
              .from('availability')
              .update({ start_time: `${scheduledDate}T${startTime}:00`, end_time: `${scheduledDate}T${endTime}:00` })
              .eq('id', avail.id);
          }
        }
      }
      await fetchAvailabilities();
    }
    
    // Update all matching requests
    for (const req of matchingRequests) {
      const origEmpIds = req.original_employee_ids?.length 
        ? req.original_employee_ids 
        : req.employee_ids || [];
      const originalStartTimeVal = req.original_start_time || req.start_time;
      const originalEndTimeVal = req.original_end_time || req.end_time;
      
      // Recalculate times for this specific date if we updated availability
      let reqStartTime = startTime;
      let reqEndTime = endTime;
      if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
        const updatedAvails = await supabase
          .from('availability')
          .select('*')
          .in('employee_id', employeeIds);
        if (updatedAvails.data && updatedAvails.data.length > 0) {
          const dateAvails = updatedAvails.data.filter(a => {
            const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
            return availDate === req.scheduled_date;
          });
          if (dateAvails.length > 0) {
            const earliest = dateAvails.reduce((min, a) => new Date(a.start_time) < new Date(min.start_time) ? a : min);
            const latest = dateAvails.reduce((max, a) => new Date(a.end_time) > new Date(max.end_time) ? a : max);
            const d1 = new Date(earliest.start_time);
            const d2 = new Date(latest.end_time);
            reqStartTime = `${d1.getUTCHours().toString().padStart(2, '0')}:${d1.getUTCMinutes().toString().padStart(2, '0')}`;
            reqEndTime = `${d2.getUTCHours().toString().padStart(2, '0')}:${d2.getUTCMinutes().toString().padStart(2, '0')}`;
          }
        }
      }
      
      const updateData: Record<string, any> = { 
        edited: true, 
        employee_ids: employeeIds,
        original_employee_ids: origEmpIds,
        original_start_time: originalStartTimeVal,
        original_end_time: originalEndTimeVal,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
      };
      
      if (reqStartTime) updateData.start_time = reqStartTime;
      if (reqEndTime) updateData.end_time = reqEndTime;
      
      await supabase
        .from('schedule_requests')
        .update(updateData)
        .eq('id', req.id);
    }
    
    // Update local state
    setScheduleRequests(prev => prev.map(r => {
      if (matchingRequests.some(m => m.id === r.id)) {
        const origEmpIds = r.original_employee_ids?.length 
          ? r.original_employee_ids 
          : r.employee_ids || [];
        const originalStartTimeVal = r.original_start_time || r.start_time;
        const originalEndTimeVal = r.original_end_time || r.end_time;
        
        return { 
          ...r, 
          edited: true, 
          employee_ids: employeeIds,
          original_employee_ids: origEmpIds,
          original_start_time: originalStartTimeVal,
          original_end_time: originalEndTimeVal,
          last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
          ...(startTime ? { start_time: startTime } : {}),
          ...(endTime ? { end_time: endTime } : {})
        };
      }
      return r;
    }));
    
    toast({ 
      title: "All schedules updated", 
      description: `Updated ${matchingRequests.length} request(s) across selected dates.` 
    });
  };

  // Handle GC editing their own request (sends it back to Sub for re-approval)
  const handleEditGCRequest = async (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Find the current request to save original values
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Save original values if not already saved (first edit)
    const originalEmployeeIds = currentRequest.original_employee_ids?.length 
      ? currentRequest.original_employee_ids 
      : currentRequest.employee_ids || [];
    const originalStartTime = currentRequest.original_start_time || currentRequest.start_time;
    const originalEndTime = currentRequest.original_end_time || currentRequest.end_time;
    
    // If checkedEmployeeIds provided, update only those employees' availability records
    if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
      const scheduledDate = currentRequest.scheduled_date;
      
      for (const empId of checkedEmployeeIds) {
        const empAvails = availabilities.filter(a => {
          const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
          return a.employee_id === empId && availDate === scheduledDate;
        });
        for (const avail of empAvails) {
          await supabase
            .from('availability')
            .update({ start_time: `${scheduledDate}T${startTime}:00`, end_time: `${scheduledDate}T${endTime}:00` })
            .eq('id', avail.id);
        }
      }
      await fetchAvailabilities();
      
      // Recalculate request times from all remaining employees' availability
      const updatedAvails = await supabase
        .from('availability')
        .select('*')
        .in('employee_id', employeeIds);
      
      if (updatedAvails.data && updatedAvails.data.length > 0) {
        const dateAvails = updatedAvails.data.filter(a => {
          const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
          return availDate === scheduledDate;
        });
        if (dateAvails.length > 0) {
          const earliest = dateAvails.reduce((min, a) => new Date(a.start_time) < new Date(min.start_time) ? a : min);
          const latest = dateAvails.reduce((max, a) => new Date(a.end_time) > new Date(max.end_time) ? a : max);
          const d1 = new Date(earliest.start_time);
          const d2 = new Date(latest.end_time);
          startTime = `${d1.getUTCHours().toString().padStart(2, '0')}:${d1.getUTCMinutes().toString().padStart(2, '0')}`;
          endTime = `${d2.getUTCHours().toString().padStart(2, '0')}:${d2.getUTCMinutes().toString().padStart(2, '0')}`;
        }
      }
    }
    
    // GC edits require Sub re-approval - set status to pending
    const { error } = await supabase
      .from('schedule_requests')
      .update({ 
        employee_ids: employeeIds,
        status: 'pending',
        edited: true,
        original_employee_ids: originalEmployeeIds,
        original_start_time: originalStartTime,
        original_end_time: originalEndTime,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
        ...(startTime && { start_time: startTime }),
        ...(endTime && { end_time: endTime })
      })
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { 
        ...r, 
        employee_ids: employeeIds,
        status: 'pending',
        edited: true,
        original_employee_ids: originalEmployeeIds,
        original_start_time: originalStartTime,
        original_end_time: originalEndTime,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
        ...(startTime && { start_time: startTime }),
        ...(endTime && { end_time: endTime })
      } : r
    ));
    toast({ title: "Schedule updated", description: "The subcontractor will need to re-approve." });
  };

  // Handle GC editing all requests on selected dates at once
  const handleEditGCRequestForAllDates = async (requestId: string, employeeIds: string[], startTime?: string, endTime?: string, checkedEmployeeIds?: string[], editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Get the dates to apply to (from selectedDates)
    const datesToApply = selectedDates.length > 0 
      ? selectedDates.map(d => format(d, 'yyyy-MM-dd'))
      : (selectedDate ? [format(selectedDate, 'yyyy-MM-dd')] : []);
    
    if (datesToApply.length === 0) return;
    
    // Get the request being edited to find matching requests on other dates
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Find all matching requests on selected dates (same sub, same project, pending/confirmed status)
    const matchingRequests = scheduleRequests.filter(r => 
      r.sub_company_id === currentRequest.sub_company_id &&
      r.project_id === currentRequest.project_id &&
      datesToApply.includes(r.scheduled_date) &&
      (r.status === 'pending' || r.status === 'confirmed')
    );
    
    if (matchingRequests.length === 0) return;
    
    // If checkedEmployeeIds provided, update those employees' availability for each date
    if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
      for (const req of matchingRequests) {
        const scheduledDate = req.scheduled_date;
        for (const empId of checkedEmployeeIds) {
          const empAvails = availabilities.filter(a => {
            const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
            return a.employee_id === empId && availDate === scheduledDate;
          });
          for (const avail of empAvails) {
            await supabase
              .from('availability')
              .update({ start_time: `${scheduledDate}T${startTime}:00`, end_time: `${scheduledDate}T${endTime}:00` })
              .eq('id', avail.id);
          }
        }
      }
      await fetchAvailabilities();
    }
    
    // Update all matching requests
    for (const req of matchingRequests) {
      const originalEmployeeIds = req.original_employee_ids?.length 
        ? req.original_employee_ids 
        : req.employee_ids || [];
      const origStartTime = req.original_start_time || req.start_time;
      const origEndTime = req.original_end_time || req.end_time;
      
      // Recalculate times for this specific date if we updated availability
      let reqStartTime = startTime;
      let reqEndTime = endTime;
      if (checkedEmployeeIds && checkedEmployeeIds.length > 0 && startTime && endTime) {
        const updatedAvails = await supabase
          .from('availability')
          .select('*')
          .in('employee_id', employeeIds);
        if (updatedAvails.data && updatedAvails.data.length > 0) {
          const dateAvails = updatedAvails.data.filter(a => {
            const availDate = format(new Date(new Date(a.start_time).getUTCFullYear(), new Date(a.start_time).getUTCMonth(), new Date(a.start_time).getUTCDate()), 'yyyy-MM-dd');
            return availDate === req.scheduled_date;
          });
          if (dateAvails.length > 0) {
            const earliest = dateAvails.reduce((min, a) => new Date(a.start_time) < new Date(min.start_time) ? a : min);
            const latest = dateAvails.reduce((max, a) => new Date(a.end_time) > new Date(max.end_time) ? a : max);
            const d1 = new Date(earliest.start_time);
            const d2 = new Date(latest.end_time);
            reqStartTime = `${d1.getUTCHours().toString().padStart(2, '0')}:${d1.getUTCMinutes().toString().padStart(2, '0')}`;
            reqEndTime = `${d2.getUTCHours().toString().padStart(2, '0')}:${d2.getUTCMinutes().toString().padStart(2, '0')}`;
          }
        }
      }
      
      await supabase
        .from('schedule_requests')
        .update({ 
          employee_ids: employeeIds,
          status: 'pending',
          edited: true,
          original_employee_ids: originalEmployeeIds,
          original_start_time: origStartTime,
          original_end_time: origEndTime,
          last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
          ...(reqStartTime && { start_time: reqStartTime }),
          ...(reqEndTime && { end_time: reqEndTime })
        })
        .eq('id', req.id);
    }
    
    // Update local state
    setScheduleRequests(prev => prev.map(r => {
      if (matchingRequests.some(m => m.id === r.id)) {
        const originalEmployeeIds = r.original_employee_ids?.length 
          ? r.original_employee_ids 
          : r.employee_ids || [];
        const origStartTime = r.original_start_time || r.start_time;
        const origEndTime = r.original_end_time || r.end_time;
        
        return { 
          ...r, 
          employee_ids: employeeIds,
          status: 'pending',
          edited: true,
          original_employee_ids: originalEmployeeIds,
          original_start_time: origStartTime,
          original_end_time: origEndTime,
          last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null,
          ...(startTime && { start_time: startTime }),
          ...(endTime && { end_time: endTime })
        };
      }
      return r;
    }));
    
    toast({ 
      title: "All schedules updated", 
      description: `Updated ${matchingRequests.length} request(s) across selected dates.` 
    });
  };

  // Handle GC/Sub acknowledging an edited request (clears the edited flag and original values)
  const handleAcknowledgeEdit = async (requestId: string, editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    // GC confirming the sub's edit is final agreement: clear the edit markers
    // AND confirm the request so both calendars turn green.
    const { error } = await supabase
      .from('schedule_requests')
      .update({ 
        status: 'confirmed',
        edited: false,
        original_employee_ids: [],
        original_start_time: null,
        original_end_time: null,
        last_edited_by_company_id: null,
        edit_reason: editReason ?? null
      })
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { 
        ...r, 
        status: 'confirmed',
        edited: false,
        original_employee_ids: [],
        original_start_time: null,
        original_end_time: null,
        last_edited_by_company_id: null,
        edit_reason: editReason ?? null
      } : r
    ));
    toast({ title: "Schedule confirmed", description: "The updated schedule has been confirmed." });

    // Notify the subcontractor's scheduled personnel, same as a normal approval.
    try {
      await notifyScheduledPersonnel(requestId);
    } catch (e) {
      console.error('[handleAcknowledgeEdit] notifyScheduledPersonnel failed', e);
    }
  };


  // Handle Sub editing and resending a pending request before approving
  const handleSubEditAndResend = async (requestId: string, employeeIds: string[], editReason?: string, employeeStops?: Record<string, string[]>) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Find the current request to save original values
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Save original values if not already saved (first edit)
    const originalEmployeeIds = currentRequest.original_employee_ids?.length 
      ? currentRequest.original_employee_ids 
      : currentRequest.employee_ids || [];
    const originalStartTime = currentRequest.original_start_time || currentRequest.start_time;
    const originalEndTime = currentRequest.original_end_time || currentRequest.end_time;
    const stops = employeeStops ?? currentRequest.employee_stops ?? {};
    // Drop stop entries for personnel no longer on the request.
    const cleanedStops: Record<string, string[]> = {};
    employeeIds.forEach(id => {
      const list = stops[id];
      if (list && list.length > 0) cleanedStops[id] = list;
    });
    
    // Sub edits and resends - stays pending but now GC must re-approve
    const { error } = await supabase
      .from('schedule_requests')
      .update({ 
        employee_ids: employeeIds,
        employee_stops: cleanedStops,
        edited: true,
        original_employee_ids: originalEmployeeIds,
        original_start_time: originalStartTime,
        original_end_time: originalEndTime,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
      } as any)
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { 
        ...r, 
        employee_ids: employeeIds,
        employee_stops: cleanedStops,
        edited: true,
        original_employee_ids: originalEmployeeIds,
        original_start_time: originalStartTime,
        original_end_time: originalEndTime,
        last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
      } : r
    ));
    toast({ title: "Changes sent", description: "The GC will need to confirm your changes." });
  };

  // Handle Sub editing and resending all requests on selected dates at once
  const handleSubEditAndResendForAllDates = async (requestId: string, employeeIds: string[], editReason?: string) => {
    if (!ensureCanActOnRequests()) return;
    const companyId = impersonatedCompany?.id || profile?.company_id;
    
    // Get the dates to apply to (from selectedDates)
    const datesToApply = selectedDates.length > 0 
      ? selectedDates.map(d => format(d, 'yyyy-MM-dd'))
      : (selectedDate ? [format(selectedDate, 'yyyy-MM-dd')] : []);
    
    if (datesToApply.length === 0) return;
    
    // Get the request being edited to find matching requests on other dates
    const currentRequest = scheduleRequests.find(r => r.id === requestId);
    if (!currentRequest) return;
    
    // Find all matching pending requests on selected dates (same project)
    const matchingRequests = scheduleRequests.filter(r => 
      (r.sub_company_id === companyId || r.intermediary_company_id === companyId) &&
      r.project_id === currentRequest.project_id &&
      datesToApply.includes(r.scheduled_date) &&
      r.status === 'pending'
    );
    
    if (matchingRequests.length === 0) return;
    
    // Update all matching requests
    for (const req of matchingRequests) {
      const originalEmployeeIds = req.original_employee_ids?.length 
        ? req.original_employee_ids 
        : req.employee_ids || [];
      const originalStartTime = req.original_start_time || req.start_time;
      const originalEndTime = req.original_end_time || req.end_time;
      
      await supabase
        .from('schedule_requests')
        .update({ 
          employee_ids: employeeIds,
          edited: true,
          original_employee_ids: originalEmployeeIds,
          original_start_time: originalStartTime,
          original_end_time: originalEndTime,
          last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
        })
        .eq('id', req.id);
    }
    
    // Update local state
    setScheduleRequests(prev => prev.map(r => {
      if (matchingRequests.some(m => m.id === r.id)) {
        const originalEmployeeIds = r.original_employee_ids?.length 
          ? r.original_employee_ids 
          : r.employee_ids || [];
        const originalStartTime = r.original_start_time || r.start_time;
        const originalEndTime = r.original_end_time || r.end_time;
        
        return { 
          ...r, 
          employee_ids: employeeIds,
          edited: true,
          original_employee_ids: originalEmployeeIds,
          original_start_time: originalStartTime,
          original_end_time: originalEndTime,
          last_edited_by_company_id: companyId,
        edit_reason: editReason ?? null
        };
      }
      return r;
    }));
    
    toast({ 
      title: "All changes sent", 
      description: `Updated ${matchingRequests.length} request(s) across selected dates.` 
    });
  };

  // Handle GC acknowledging a rejected/cancelled request (deletes the request)
  const handleAcknowledgeRejection = async (requestId: string) => {
    if (!ensureCanActOnRequests()) return;
    const { error } = await supabase
      .from('schedule_requests')
      .delete()
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Either the row was deleted, or it was already gone (e.g. acknowledged
    // from another tab / cleared by realtime). Both cases are success from
    // the user's perspective — never surface "Permission denied" here, since
    // RLS already allows this delete for requesting / sub / project-owning
    // companies.
    setScheduleRequests(prev => prev.filter(r => r.id !== requestId));
    toast({ title: "Request dismissed", description: "The rejected/cancelled request has been acknowledged." });
  };

  // Get days range from selected weeks
  const getDaysFromWeeks = (weeks: number[]): { start: number; end: number }[] => {
    return weeks.map(w => ({
      start: (w - 1) * 7,
      end: w * 7
    }));
  };

  const handleGenerateSchedule = async (data: { selectedSubs: { id: string; trade: string }[]; selectedWeeks: number[] }) => {
    const today = new Date();
    const weekRanges = getDaysFromWeeks(data.selectedWeeks);
    
    // Get all days to check from selected weeks
    const daysToCheck: Date[] = [];
    weekRanges.forEach(range => {
      for (let i = range.start; i < range.end; i++) {
        daysToCheck.push(addDays(today, i));
      }
    });

    const relevantTasks = tasks.filter(t => {
      const taskStart = new Date(t.start_date);
      const taskEnd = new Date(t.end_date);
      return daysToCheck.some(d => d >= taskStart && d <= taskEnd);
    });

    if (relevantTasks.length === 0) {
      toast({ title: "No tasks", description: "No tasks found in the scheduling period" });
      return;
    }

    const companyId = impersonatedCompany?.id || profile?.company_id;
    if (!companyId) return;

    let recommendationsGenerated = 0;
    
    for (const currentDate of daysToCheck) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      
      const tasksForDate = relevantTasks.filter(t => {
        const start = new Date(t.start_date);
        const end = new Date(t.end_date);
        return currentDate >= start && currentDate <= end;
      });

      for (const task of tasksForDate) {
        for (const sub of data.selectedSubs) {
          const tradeLower = sub.trade.toLowerCase();
          const taskNameLower = task.name.toLowerCase();
          
          const isMatch = taskNameLower.includes(tradeLower) || 
                          tradeLower.includes(taskNameLower.split(' ')[0]) ||
                          (tradeLower === 'electrical' && taskNameLower.includes('electric')) ||
                          (tradeLower === 'plumbing' && taskNameLower.includes('plumb')) ||
                          (tradeLower === 'hvac' && (taskNameLower.includes('hvac') || taskNameLower.includes('heating') || taskNameLower.includes('cooling'))) ||
                          (tradeLower === 'drywall' && taskNameLower.includes('drywall'));
          
          if (!isMatch) continue;

          const subEmployees = employees.filter(e => e.company_id === sub.id);
          const hasAvailability = subEmployees.some(emp => 
            availabilities.some(a => {
        const _d = new Date(a.start_time);
              const availDate = `${_d.getUTCFullYear()}-${String(_d.getUTCMonth() + 1).padStart(2, '0')}-${String(_d.getUTCDate()).padStart(2, '0')}`;
              return availDate === dateStr && a.employee_id === emp.id;
            })
          );

          if (hasAvailability) {
            const existingRequest = scheduleRequests.find(r => 
              r.sub_company_id === sub.id && r.scheduled_date === dateStr
            );

            if (!existingRequest) {
              const { error } = await supabase.from('schedule_requests').insert({
                project_id: task.project_id,
                sub_company_id: sub.id,
                requesting_company_id: companyId,
                scheduled_date: dateStr,
                description: `AI Recommended: ${task.name}`,
                status: 'draft'
              });

              if (!error) {
                recommendationsGenerated++;
              }
            }
          }
        }
      }
    }

    if (recommendationsGenerated > 0) {
      toast({ 
        title: "Recommendations generated", 
        description: `${recommendationsGenerated} draft recommendation(s) created. Review and send to subs.` 
      });
      fetchScheduleRequests();
    } else {
      toast({ 
        title: "No recommendations", 
        description: "Could not match tasks to available subcontractors. Ensure subs have set their availability." 
      });
    }
  };

  const getDraftRecommendations = () => {
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    return scheduleRequests
      .filter(req => req.status === 'draft' && req.requesting_company_id === activeCompanyId)
      .map(req => {
        const subCompany = companies.find(c => c.id === req.sub_company_id);
        return {
          id: req.id,
          subId: req.sub_company_id,
          subName: subCompany?.name || 'Unknown',
          trade: subCompany?.trade || '',
          date: req.scheduled_date,
          taskName: req.description?.replace('AI Recommended: ', '') || '',
          startTime: req.start_time,
          endTime: req.end_time
        };
      });
  };

  const handleApproveDraft = async (requestId: string) => {
    const { error } = await supabase
      .from('schedule_requests')
      .update({ status: 'pending' })
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { ...r, status: 'pending' } : r
    ));
    toast({ title: "Request sent to subcontractor" });
  };

  const handleDeleteDraft = async (requestId: string) => {
    const { data, error } = await supabase
      .from('schedule_requests')
      .delete()
      .eq('id', requestId)
      .select();

    if (error) {
      toast({ title: "Error deleting recommendation", description: error.message, variant: "destructive" });
      return;
    }

    if (!data || data.length === 0) {
      toast({ title: "Error", description: "Could not delete recommendation. Permission denied.", variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.filter(r => r.id !== requestId));
    toast({ title: "Recommendation deleted" });
  };

  const handleUpdateDraft = async (requestId: string, updates: { 
    subId?: string; 
    date?: string; 
    startTime?: string; 
    endTime?: string; 
    description?: string 
  }) => {
    const updateData: Record<string, any> = {};
    if (updates.subId) updateData.sub_company_id = updates.subId;
    if (updates.date) updateData.scheduled_date = updates.date;
    if (updates.startTime) updateData.start_time = updates.startTime;
    if (updates.endTime) updateData.end_time = updates.endTime;
    if (updates.description) updateData.description = updates.description;

    const { error } = await supabase
      .from('schedule_requests')
      .update(updateData)
      .eq('id', requestId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setScheduleRequests(prev => prev.map(r => 
      r.id === requestId ? { ...r, ...updateData } : r
    ));
    toast({ title: "Recommendation updated" });
  };

  const handleDayClick = (date: Date) => {
    setScheduleModalOpen(true);
  };

  const getAvailabilitiesForDate = () => {
    if (!selectedDate && selectedDates.length === 0) return [];
    
    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    const dateStrs = datesToCheck.map(d => format(d, 'yyyy-MM-dd'));
    
    if (scheduleViewMode === 'gc') {
      const connectedSubs = getConnectedSubCompanies();
      const connectedSubEmployeeIds = employees
        .filter(e => connectedSubs.some(sub => sub.id === e.company_id))
        .map(e => e.id);
      
      return availabilities.filter(a => {
        const _d = new Date(a.start_time);
        const availDate = `${_d.getUTCFullYear()}-${String(_d.getUTCMonth() + 1).padStart(2, '0')}-${String(_d.getUTCDate()).padStart(2, '0')}`;
        return dateStrs.includes(availDate) && connectedSubEmployeeIds.includes(a.employee_id);
      });
    } else {
      const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
      let companyEmployeeIds = employees
        .filter(e => e.company_id === activeCompanyId)
        .map(e => e.id);
      
      // Basic users can only see their own linked employee's availability
      if (effectiveIsBasicUser && effectiveUserId) {
        const linkedEmployee = employees.find(e => e.company_id === activeCompanyId && e.linked_user_id === effectiveUserId);

        companyEmployeeIds = linkedEmployee ? [linkedEmployee.id] : [];
      }
      
      return availabilities.filter(a => {
        const _d = new Date(a.start_time);
        const availDate = `${_d.getUTCFullYear()}-${String(_d.getUTCMonth() + 1).padStart(2, '0')}-${String(_d.getUTCDate()).padStart(2, '0')}`;
        return dateStrs.includes(availDate) && companyEmployeeIds.includes(a.employee_id);
      });
    }
  };

  const getScheduleRequestsForDate = () => {
    if (!selectedDate && selectedDates.length === 0) return [];
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    const ownedProjectIds = projects
      .filter(p => p.company_id === activeCompanyId || aliasVisibleProjectIds.includes(p.id))
      .map(p => p.id);
    
    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    const dateStrs = datesToCheck.map(d => format(d, 'yyyy-MM-dd'));
    
    return scheduleRequests.filter(req => {
      const isForDate = dateStrs.includes(req.scheduled_date);
      
      // Filter by selected project for GC/MOA view
      if (scheduleViewMode === 'gc') {
        // GC sees:
        // - Active requests (pending, confirmed)
        // - Rejected/cancelled requests BY SUB (to acknowledge)
        const isCancelledByOther = (req.status === 'rejected' || req.status === 'cancelled' || req.status === 'canceled') && 
          req.cancelled_by_company_id && 
          req.cancelled_by_company_id !== activeCompanyId;
        const isActive = req.status === 'pending' || req.status === 'confirmed';
        
        if (!isCancelledByOther && !isActive) return false;
        
        const isForProject = selectedProject === 'master' || req.project_id === selectedProject;
        // GC sees requests they initiated OR any request (e.g. sub-initiated self-assignment)
        // for projects they own.
        const isMine = req.requesting_company_id === activeCompanyId;
        const isOwnedByMe = ownedProjectIds.includes(req.project_id);
        return isForDate && isForProject && (isMine || isOwnedByMe);
      } else {
        // Sub sees cancelled requests that were cancelled by GC (to acknowledge) + active requests
        // Hide rejected (sub rejected) and cancelled-by-self
        const isCancelledByOther = (req.status === 'cancelled' || req.status === 'canceled') && 
          req.cancelled_by_company_id && 
          req.cancelled_by_company_id !== activeCompanyId;
        const isActive = req.status === 'pending' || req.status === 'confirmed';
        
        if (!isCancelledByOther && !isActive) return false;
        
        const isForProject = selectedProject === 'master' || req.project_id === selectedProject;
        // Include requests routed through this company as the in-between main subcontractor.
        const isForMyCompany = req.sub_company_id === activeCompanyId || req.intermediary_company_id === activeCompanyId;
        return isForDate && isForMyCompany && isForProject;
      }
    });
  };

  // Get confirmed employee IDs for the selected date(s)
  const getConfirmedEmployeeIds = () => {
    if (!selectedDate && selectedDates.length === 0) return [];
    
    const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
    const dateStrs = datesToCheck.map(d => format(d, 'yyyy-MM-dd'));
    
    const confirmedRequests = scheduleRequests.filter(r => 
      dateStrs.includes(r.scheduled_date) && r.status === 'confirmed'
    );
    
    // Only return employee IDs that were explicitly stored in the employee_ids array
    const confirmedEmpIds = confirmedRequests.flatMap(r => r.employee_ids || []);
    return [...new Set(confirmedEmpIds)]; // Deduplicate
  };

  const getPendingRequestDates = () => {
    // Master schedule with no overlays toggled = show nothing (GC/MOA only)
    if (scheduleViewMode === 'gc' && selectedProject === 'master' && masterOverlayProjectIds.length === 0) return [];
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    const projectFilter = selectedProject === 'master' ? masterOverlayProjectIds : [selectedProject];
    return scheduleRequests
      .filter(req => req.status === 'pending' && (req.sub_company_id === activeCompanyId || req.intermediary_company_id === activeCompanyId) && (selectedProject === 'master' ? true : projectFilter.includes(req.project_id)))
      .map(req => req.scheduled_date);
  };

  const getDayStatuses = () => {
    // Master schedule with no overlays toggled = show clean calendar (GC/MOA only)
    if (scheduleViewMode === 'gc' && selectedProject === 'master' && masterOverlayProjectIds.length === 0) return [];
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    const statusMap: { [date: string]: { confirmedCount: number; pendingCount: number; rejectedCount: number; totalRequestedSubs: number; scheduledEmployeeCount: number; availableEmployeeCount: number; hasEdited: boolean; subAssignedCount: number } } = {};
    
    if (scheduleViewMode === 'gc') {
      const ownedProjectIds = projects
        .filter(p => p.company_id === activeCompanyId || aliasVisibleProjectIds.includes(p.id))
        .map(p => p.id);
      
      // Filter requests - only show for the selected project (or overlay-selected on master)
      const projectFilter = selectedProject === 'master' 
        ? masterOverlayProjectIds.filter(id => ownedProjectIds.includes(id))
        : [selectedProject];
      
      // Include rejected/cancelled requests for GC to see them.
      // Also include sub-initiated requests against projects the GC owns
      // (where requesting_company_id is the sub, not the GC).
      const myRequests = scheduleRequests.filter(r => 
        (r.requesting_company_id === activeCompanyId || ownedProjectIds.includes(r.project_id)) && 
        projectFilter.includes(r.project_id) &&
        (r.status === 'pending' || r.status === 'confirmed' || r.status === 'rejected' || r.status === 'cancelled')
      );
      
      myRequests.forEach(req => {
        if (!statusMap[req.scheduled_date]) {
          statusMap[req.scheduled_date] = { confirmedCount: 0, pendingCount: 0, rejectedCount: 0, totalRequestedSubs: 0, scheduledEmployeeCount: 0, availableEmployeeCount: 0, hasEdited: false, subAssignedCount: 0 };
        }
        // Only count active requests in totalRequestedSubs
        if (req.status === 'pending' || req.status === 'confirmed') {
          statusMap[req.scheduled_date].totalRequestedSubs++;
        }
        if (req.status === 'confirmed') {
          statusMap[req.scheduled_date].confirmedCount++;
        } else if (req.status === 'pending') {
          statusMap[req.scheduled_date].pendingCount++;
        } else if (req.status === 'rejected' || req.status === 'cancelled') {
          // Only count as rejected if the SUB initiated the cancellation/rejection (not the GC)
          // If cancelled_by_company_id matches the requesting_company_id, the GC cancelled their own request
          if (req.cancelled_by_company_id && req.cancelled_by_company_id !== activeCompanyId) {
            statusMap[req.scheduled_date].rejectedCount++;
          }
        }
        // Only flag as edited if the OTHER party made the edit AND the request is still active
        if (
          (req.status === 'pending' || req.status === 'confirmed') &&
          req.edited &&
          req.last_edited_by_company_id &&
          req.last_edited_by_company_id !== activeCompanyId
        ) {
          statusMap[req.scheduled_date].hasEdited = true;
        }
        // Count sub-assigned requests
        if (req.sub_assigned && req.status === 'confirmed') {
          statusMap[req.scheduled_date].subAssignedCount++;
        }
      });
    } else {
      const companyEmployeeIds = employees.filter(e => e.company_id === activeCompanyId).map(e => e.id);
      
      // Filter availability by selected project for sub view
      const filteredAvailabilities = selectedProject === 'master' 
        ? availabilities.filter(a => companyEmployeeIds.includes(a.employee_id))
        : availabilities.filter(a => 
            companyEmployeeIds.includes(a.employee_id) && 
            (a.all_projects || a.project_id === selectedProject || a.project_id === null)
          );
      
      const availDates: { [date: string]: Set<string> } = {};
      filteredAvailabilities.forEach(a => {
        const d = new Date(a.start_time);
        const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        if (!availDates[dateStr]) availDates[dateStr] = new Set();
        availDates[dateStr].add(a.employee_id);
      });
      
      // Filter schedule requests by selected project for sub view
      const projectFilterSub = selectedProject === 'master' ? null : selectedProject;
      
      // A main subcontractor also sees days for requests routed through them to a
      // sub-of-sub (they are the intermediary, the sub-of-sub owns the personnel).
      const isMine = (r: any) =>
        r.sub_company_id === activeCompanyId || r.intermediary_company_id === activeCompanyId;

      const confirmedRequests = scheduleRequests.filter(r => 
        isMine(r) && r.status === 'confirmed' &&
        (!projectFilterSub || r.project_id === projectFilterSub)
      );
      const pendingRequests = scheduleRequests.filter(r => 
        isMine(r) && r.status === 'pending' &&
        (!projectFilterSub || r.project_id === projectFilterSub)
      );
      // Cancelled/rejected requests by the other party that the sub needs to acknowledge
      const cancelledRequests = scheduleRequests.filter(r => 
        isMine(r) && 
        (r.status === 'cancelled' || r.status === 'rejected') && 
        r.cancelled_by_company_id && 
        r.cancelled_by_company_id !== activeCompanyId &&
        (!projectFilterSub || r.project_id === projectFilterSub)
      );
      
      const scheduledDates: { [date: string]: Set<string> } = {};
      const confirmedDateFlags = new Set<string>();
      confirmedRequests.forEach(r => {
        confirmedDateFlags.add(r.scheduled_date);
        if (!scheduledDates[r.scheduled_date]) scheduledDates[r.scheduled_date] = new Set();
        // Track scheduled employee IDs (own personnel only feed the availability math)
        (r.employee_ids || [])
          .filter((empId: string) => companyEmployeeIds.includes(empId))
          .forEach((empId: string) => scheduledDates[r.scheduled_date].add(empId));
      });
      const pendingDates: { [date: string]: number } = {};
      pendingRequests.forEach(r => {
        if (!pendingDates[r.scheduled_date]) pendingDates[r.scheduled_date] = 0;
        pendingDates[r.scheduled_date]++;
      });
      const cancelledDates: { [date: string]: number } = {};
      cancelledRequests.forEach(r => {
        if (!cancelledDates[r.scheduled_date]) cancelledDates[r.scheduled_date] = 0;
        cancelledDates[r.scheduled_date]++;
      });
      // Days where the other party edited a still-active request
      const editedDates = new Set<string>(
        scheduleRequests
          .filter(r =>
            isMine(r) &&
            (r.status === 'pending' || r.status === 'confirmed') &&
            (!projectFilterSub || r.project_id === projectFilterSub) &&
            r.edited &&
            r.last_edited_by_company_id &&
            r.last_edited_by_company_id !== activeCompanyId
          )
          .map(r => r.scheduled_date)
      );
      
      // Combine all dates that have availability, pending requests, cancelled requests, or confirmed requests
      const allDates = new Set([...Object.keys(availDates), ...Object.keys(pendingDates), ...Object.keys(cancelledDates), ...Object.keys(scheduledDates)]);
      
      allDates.forEach(date => {
        const availCount = availDates[date]?.size || 0;
        const scheduledEmployeeIds = scheduledDates[date] || new Set();
        const schedCount = scheduledEmployeeIds.size;
        const pendingCount = pendingDates[date] || 0;
        const cancelledCount = cancelledDates[date] || 0;
        
        // Check if there are available employees who are NOT scheduled
        const availableNotScheduled = availCount > 0 && availDates[date] 
          ? [...availDates[date]].filter(empId => !scheduledEmployeeIds.has(empId)).length 
          : 0;
        
        statusMap[date] = {
          confirmedCount: confirmedDateFlags.has(date) ? 1 : 0, // Has at least one confirmed request
          pendingCount: pendingCount,
          rejectedCount: cancelledCount, // Use rejectedCount for cancelled-by-other-party
          totalRequestedSubs: (confirmedDateFlags.has(date) ? 1 : 0) + pendingCount,
          availableEmployeeCount: availableNotScheduled, // Employees available but not scheduled
          scheduledEmployeeCount: schedCount,
          hasEdited: editedDates.has(date),
          subAssignedCount: 0
        };
      });
    }
    
    return Object.entries(statusMap).map(([date, data]) => ({ date, ...data }));
  };

  const [projectConnections, setProjectConnections] = useState<{ project_id: string; sub_company_id: string }[]>([]);

  useEffect(() => {
    const fetchProjectConnections = async () => {
      const { data, error } = await supabase
        .from('project_connections')
        .select('project_id, sub_company_id');
      if (!error && data) {
        setProjectConnections(data);
      }
    };
    fetchProjectConnections();

    // Realtime subscription so overlay stays in sync when connections change
    const channel = supabase
      .channel('project_connections_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_connections' },
        () => {
          fetchProjectConnections();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        () => {
          fetchProjects();
          fetchProjectConnections();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projects, impersonatedCompany, impersonatedUser, profile?.company_id]);

  const getConnectedSubCompanies = (projectId?: string) => {
    if (scheduleViewMode === 'sub') return [];
    
    const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;
    const activeCompany = companies.find(c => c.id === activeCompanyId);
    
    // Guest GCs use guest_project_connections instead of project_connections
    if (activeCompany?.is_guest) {
      const guestSubIds = guestProjectConnections
        .filter(gc => gc.guest_company_id === activeCompanyId)
        .map(gc => gc.sub_company_id);
      const uniqueSubIds = [...new Set(guestSubIds)];
      return companies.filter(c => uniqueSubIds.includes(c.id) && c.company_type === 'sub');
    }
    
    let filteredProjectIds: string[];
    
    if (projectId && projectId !== 'master') {
      filteredProjectIds = [projectId];
    } else {
      filteredProjectIds = projects
        .filter(p => p.company_id === activeCompanyId)
        .map(p => p.id);
    }
    
    const connectedSubIds = projectConnections
      .filter(pc => filteredProjectIds.includes(pc.project_id))
      .map(pc => pc.sub_company_id);
    
    const uniqueSubIds = [...new Set(connectedSubIds)];
    return companies.filter(c => uniqueSubIds.includes(c.id) && c.company_type === 'sub');
  };

  const activeCompanyId = impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id;

  const viewerEmployeeId = useMemo(() => {
    if (scheduleViewMode !== 'sub' || canActOnRequests || !effectiveUserId) return null;
    return employees.find(employee =>
      employee.company_id === activeCompanyId && employee.linked_user_id === effectiveUserId
    )?.id ?? null;
  }, [scheduleViewMode, canActOnRequests, effectiveUserId, employees, activeCompanyId]);

  const selectedProjectAssignedEmployeeIds = useMemo(() => new Set(
    employeeProjectAssignments
      .filter(assignment => assignment.project_id === selectedProject)
      .map(assignment => assignment.employee_id)
  ), [employeeProjectAssignments, selectedProject]);

  const sharedSubCompanyIds = useMemo(() => new Set(
    sharedContractorAssignments
      .filter(assignment => assignment.main_company_id === activeCompanyId)
      .map(assignment => assignment.sub_company_id)
  ), [sharedContractorAssignments, activeCompanyId]);

  /** sub-of-sub company id -> main subcontractor company id sitting between them and the GC. */
  const intermediaryByCompanyId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const assignment of sharedContractorAssignments) {
      if (assignment.sub_company_id && assignment.main_company_id) {
        map[assignment.sub_company_id] = assignment.main_company_id;
      }
    }
    return map;
  }, [sharedContractorAssignments]);

  const projectScheduleEmployees = useMemo(() => employees.filter(employee => {
    if (!selectedProjectAssignedEmployeeIds.has(employee.id)) return false;
    if (scheduleViewMode === 'sub') return employee.company_id === activeCompanyId;
    return employee.company_id === activeCompanyId || sharedSubCompanyIds.has(employee.company_id);
  }), [employees, selectedProjectAssignedEmployeeIds, activeCompanyId, sharedSubCompanyIds, scheduleViewMode]);

  // Personnel a subcontractor is allowed to see anywhere on the schedule are
  // limited to the active subcontractor company. GC / Guest GC accounts retain
  // full visibility of connected subcontractor personnel.
  const visibleEmployees = useMemo(() => {
    if (scheduleViewMode !== 'sub') return employees;
    return employees.filter(employee => employee.company_id === activeCompanyId);
  }, [employees, scheduleViewMode, activeCompanyId]);





  // The modal must not rely only on the project-assignment query. On mobile this
  // previously produced an empty roster even when the selected day already had
  // saved availability. Reconcile assignments with date/project availability,
  // while keeping the subcontractor roster strictly company-scoped.
  const scheduleModalEmployees = useMemo(() => {
    let roster = scheduleViewMode === 'sub'
      ? employees.filter(employee => employee.company_id === activeCompanyId)
      : employees;

    if (scheduleViewMode === 'sub' && selectedProject !== 'master') {
      const selectedDateKeys = new Set(
        (selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []))
          .map(date => format(date, 'yyyy-MM-dd'))
      );
      const employeeIdsWithApplicableAvailability = new Set(
        availabilities
          .filter(availability => {
            const timestamp = new Date(availability.start_time);
            const dateKey = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}`;
            const isSelectedDate = selectedDateKeys.size === 0 || selectedDateKeys.has(dateKey);
            const isApplicableProject = availability.project_id === selectedProject
              || availability.all_projects === true
              || availability.project_id === null;
            return isSelectedDate && isApplicableProject;
          })
          .map(availability => availability.employee_id)
      );

      roster = roster.filter(employee =>
        selectedProjectAssignedEmployeeIds.has(employee.id)
        || employeeIdsWithApplicableAvailability.has(employee.id)
      );
    }

    if (effectivePermissionLevel === 'basic' && effectiveUserId) {
      roster = roster.filter(employee => employee.linked_user_id === effectiveUserId);
    }

    return roster;
  }, [
    activeCompanyId,
    availabilities,
    effectivePermissionLevel,
    effectiveUserId,
    employees,
    scheduleViewMode,
    selectedDate,
    selectedDates,
    selectedProject,
    selectedProjectAssignedEmployeeIds,
    sharedSubCompanyIds,
  ]);

  const weeklyCompanyGroups = useMemo(() => {
    if (scheduleViewMode === 'sub') {
      return activeCompanyId ? companies.filter(company => company.id === activeCompanyId) : [];
    }

    const directSubs = getConnectedSubCompanies(selectedProject);
    const result: any[] = [...directSubs];
    for (const assignment of sharedContractorAssignments) {
      const subSub = companies.find(company => company.id === assignment.sub_company_id);
      const mainSub = companies.find(company => company.id === assignment.main_company_id);
      if (!subSub) continue;
      const parentListed = result.some(company => company.id === assignment.main_company_id);
      const existingIndex = result.findIndex(company => company.id === subSub.id);
      if (existingIndex >= 0) {
        // Already listed (it also has its own direct project connection) — nest it
        // under its main subcontractor instead of leaving it at the top level.
        if (parentListed && assignment.main_company_id !== subSub.id) {
          result[existingIndex] = { ...result[existingIndex], parentCompanyId: assignment.main_company_id };
        }
        continue;
      }
      // Nest the sub-of-sub under its main subcontractor when that main sub is listed.
      result.push(
        parentListed
          ? { ...subSub, parentCompanyId: assignment.main_company_id }
          : { ...subSub, name: `${mainSub?.name || 'Main Subcontractor'} › ${subSub.name}` }
      );
    }
    return result;


  }, [scheduleViewMode, activeCompanyId, sharedSubCompanyIds, companies, selectedProject, sharedContractorAssignments, projectConnections, guestProjectConnections]);
  
  // Determine if current user is a guest GC
  const isGuestGC = (() => {
    if (!activeCompanyId) return false;
    const activeCompany = companies.find(c => c.id === activeCompanyId);
    return activeCompany?.company_type === 'gc' && activeCompany?.is_guest === true;
  })();

  // Guest GC connect handler - resolves via guest_gc_links OR projects.connection_code
  const handleGuestConnect = async (code: string) => {
    if (!activeCompanyId) return;

    // Normalize: trim whitespace, try uppercase first (guest_gc_links stores upper),
    // then lowercase (projects.connection_code stores lower from md5 substring).
    const trimmed = code.trim();
    const upperCode = trimmed.toUpperCase();
    const lowerCode = trimmed.toLowerCase();

    let resolvedSubCompanyId: string | null = null;

    // 1) Try the sub-issued guest invite link code (uppercase storage)
    const { data: link } = await supabase
      .from('guest_gc_links')
      .select('sub_company_id')
      .eq('connection_code', upperCode)
      .maybeSingle();

    if (link?.sub_company_id) {
      resolvedSubCompanyId = link.sub_company_id;
    } else {
      // 2) Fallback: a project-level connection code (lowercase storage). The
      // project's owning company IS the subcontractor for guest GC purposes.
      const { data: project } = await supabase
        .from('projects')
        .select('company_id, companies:company_id(company_type)')
        .eq('connection_code', lowerCode)
        .maybeSingle();

      const projectCompanyType = (project as any)?.companies?.company_type;
      if (project?.company_id && projectCompanyType === 'sub') {
        resolvedSubCompanyId = project.company_id;
      }
    }

    if (!resolvedSubCompanyId) {
      toast({ title: "Error", description: "Invalid connection code", variant: "destructive" });
      return;
    }

    // Avoid duplicate row error: check first
    const { data: existing } = await supabase
      .from('guest_project_connections')
      .select('id')
      .eq('guest_company_id', activeCompanyId)
      .eq('sub_company_id', resolvedSubCompanyId)
      .maybeSingle();

    if (existing) {
      toast({ title: "Already connected", description: "You are already connected to this subcontractor" });
      fetchGuestProjectConnections();
      fetchProjects();
      return;
    }

    const { error } = await supabase
      .from('guest_project_connections')
      .insert({ guest_company_id: activeCompanyId, sub_company_id: resolvedSubCompanyId });

    if (error) {
      if (error.code === '23505') {
        toast({ title: "Already connected", description: "You are already connected to this subcontractor" });
        fetchGuestProjectConnections();
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Connected!", description: "You can now see this subcontractor's availability" });
    fetchGuestProjectConnections();
    fetchProjects();
  };

  // Filter projects based on active company context
  const filteredProjects = (() => {
    if (!activeCompanyId) return projects;
    if (isMOA && !impersonatedUser && !impersonatedCompany) return projects;
    
    const activeCompany = companies.find(c => c.id === activeCompanyId);
    if (!activeCompany) return projects;
    
    if (activeCompany.company_type === 'gc') {
      let gcProjects: Project[];
      if (activeCompany.is_guest) {
        // Guest GC: project rows are owned by the Sub. The signal that this
        // guest was invited to a project is a project_aliases row for the
        // guest company (written during invite acceptance). Also include any
        // legacy projects the guest owned directly (older accounts).
        const aliasSet = new Set(aliasVisibleProjectIds);
        gcProjects = projects.filter(
          p => p.company_id === activeCompanyId || aliasSet.has(p.id)
        );
      } else {
        // Regular GC sees projects they own
        gcProjects = projects.filter(p => p.company_id === activeCompanyId);
      }
      // Partial users only see assigned projects
      if (effectivePermissionLevel === 'partial' && !effectiveIsMOA) {
        return gcProjects.filter(p => userAssignedProjectIds.includes(p.id));
      }
      return gcProjects;
    } else {
      // Sub sees projects they're connected to + their own projects (except Customers Calendar)
      const connectedProjectIds = projectConnections
        .filter(pc => pc.sub_company_id === activeCompanyId)
        .map(pc => pc.project_id);
      let subProjects = projects.filter(p => 
        (p.company_id === activeCompanyId || connectedProjectIds.includes(p.id))
      );
      // Partial users only see assigned projects
      if (effectivePermissionLevel === 'partial' && !effectiveIsMOA) {
        return subProjects.filter(p => userAssignedProjectIds.includes(p.id));
      }
      return subProjects;
    }
  })();

  // Build a set of project IDs the active (possibly impersonated) company can see.
  // Reused below for tasks and for master-schedule overlay scoping so that stale
  // overlay selections from a previously-viewed company can never render here.
  const visibleProjectIds = new Set(filteredProjects.map(p => p.id));
  const validOverlayProjectIds = masterOverlayProjectIds.filter(id => visibleProjectIds.has(id));

  // Safety net: if the currently-selected project is no longer visible to the
  // active company (e.g. MOA just switched impersonation), fall back to master.
  useEffect(() => {
    if (selectedProject !== 'master' && !visibleProjectIds.has(selectedProject)) {
      setSelectedProject('master');
    }
    // Drop any overlay selections that are no longer in the visible project set.
    if (masterOverlayProjectIds.some(id => !visibleProjectIds.has(id))) {
      setMasterOverlayProjectIds(prev => prev.filter(id => visibleProjectIds.has(id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProjects]);

  // Loading guard placed AFTER all hooks to preserve hook call order across renders.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary">Loading...</div>
      </div>
    );
  }

  const filteredTasks = (() => {
    const sortTasks = (arr: Task[]) => arr.sort((a, b) => {
      const startDiff = a.start_date.localeCompare(b.start_date);
      if (startDiff !== 0) return startDiff;
      return a.end_date.localeCompare(b.end_date);
    });

    // Subs on master schedule: show tasks only for overlay-selected projects
    if (scheduleViewMode === 'sub' && selectedProject === 'master') {
      if (validOverlayProjectIds.length > 0) {
        return sortTasks(tasks.filter(t => validOverlayProjectIds.includes(t.project_id)));
      }
      // Weekly view has no overlay-picker UI for subs — show only tasks for visible projects
      if (matrixViewToggle === 'weekly') {
        return sortTasks(tasks.filter(t => visibleProjectIds.has(t.project_id)));
      }
      return [];
    }
    let result: Task[];
    if (selectedProject === 'master') {
      // In master view, if overlay toggles are used, only show toggled projects
      if (validOverlayProjectIds.length > 0) {
        result = tasks.filter(t => validOverlayProjectIds.includes(t.project_id));
      } else if (matrixViewToggle === 'weekly') {
        // Weekly view: no overlay-picker available — show tasks for visible projects only
        result = tasks.filter(t => visibleProjectIds.has(t.project_id));
      } else {
        // No toggles active on master monthly = show nothing until user picks overlays
        return [];
      }
    } else {
      result = tasks.filter(t => t.project_id === selectedProject && visibleProjectIds.has(t.project_id));
    }
    return sortTasks(result);
  })();

  const getSubOverlayData = () => {
    if (!subOverlayEnabled || selectedOverlaySubIds.length === 0) return [];
    
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    // Extend to full calendar weeks
    const calStart = new Date(monthStart);
    calStart.setDate(calStart.getDate() - calStart.getDay());
    const calEnd = new Date(monthEnd);
    calEnd.setDate(calEnd.getDate() + (6 - calEnd.getDay()));
    
    const result: { date: string; subs: { subName: string; employeeCount: number }[] }[] = [];
    
    for (let d = new Date(calStart); d <= calEnd; d.setDate(d.getDate() + 1)) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const subs: { subName: string; employeeCount: number }[] = [];
      
      for (const subId of selectedOverlaySubIds) {
        const sub = companies.find(c => c.id === subId);
        if (!sub) continue;
        
        const subEmployeeIds = employees
          .filter(e => e.company_id === subId)
          .map(e => e.id);
        
        const availableEmployees = new Set<string>();
        availabilities.forEach(a => {
          if (!subEmployeeIds.includes(a.employee_id)) return;
          const ad = new Date(a.start_time);
          const availDate = `${ad.getUTCFullYear()}-${String(ad.getUTCMonth() + 1).padStart(2, '0')}-${String(ad.getUTCDate()).padStart(2, '0')}`;
          if (availDate === dateStr) {
            availableEmployees.add(a.employee_id);
          }
        });
        
        if (availableEmployees.size > 0) {
          subs.push({ subName: sub.name, employeeCount: availableEmployees.size });
        }
      }
      
      result.push({ date: dateStr, subs });
    }
    
    return result;
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      <DashboardHeader
        viewMode={viewMode}
        setViewMode={setViewMode}
        impersonatedCompany={impersonatedCompany}
        setImpersonatedCompany={setImpersonatedCompany}
        companies={companies}
        impersonatedUser={impersonatedUser}
        onImpersonateUser={(user) => {
          setImpersonatedUser(user);
          setSelectedProject('master');
        }}
        onEmployeesChanged={fetchEmployees}
        onProjectsChanged={fetchProjects}
        matrixViewToggle={matrixViewToggle}
        onMatrixViewToggleChange={setMatrixViewToggle}
        selectedProject={selectedProject}
        visibleProjectIds={Array.from(visibleProjectIds)}
        connectedContractorsCount={connectedContractorsCount}
        onOpenConnectedContractors={() => setConnectedContractorsOpen(true)}
      />

      {activeCompanyIdForConnections && selectedProject !== 'master' && (
        <ConnectedContractorsViewerModal
          open={connectedContractorsOpen}
          onClose={() => setConnectedContractorsOpen(false)}
          effectiveCompanyId={activeCompanyIdForConnections}
          selectedProjectId={selectedProject}
          selectedProjectName={filteredProjects.find(p => p.id === selectedProject)?.name}
          canManageShare={effectiveIsMOA || effectiveIsAccountHolder || effectivePermissionLevel === 'full'}
        />
      )}

      <div className="flex-1 p-4 lg:p-6 overflow-y-auto lg:overflow-hidden min-h-0">
        {matrixViewToggle === 'weekly' ? (
          <div className="h-full w-full min-h-0">
            <ResourceMatrix
              projects={selectedProject === 'master' ? filteredProjects : filteredProjects.filter(p => p.id === selectedProject)}
              employees={selectedProject === 'master'
                ? employees.filter(e => e.company_id === activeCompanyId)
                : projectScheduleEmployees}
              scheduleRequests={scheduleRequests}
              companyId={activeCompanyId || ''}
              onDataChanged={() => {
                fetchScheduleRequests();
                fetchEmployees();
              }}
              tasks={filteredTasks}
              showTaskOverlay={showOverlay}
              onToggleTaskOverlay={setShowOverlay}
              singleProjectMode={selectedProject !== 'master'}
              viewMode={scheduleViewMode}
              connectedSubs={selectedProject === 'master' ? getConnectedSubCompanies() : weeklyCompanyGroups}
              allEmployees={visibleEmployees}
              intermediaryByCompanyId={intermediaryByCompanyId}
              availabilities={availabilities}
              crossGcBookings={crossGcBookings}
              allCompanyProjects={filteredProjects}
              employeeProjectAssignments={(() => {
                const map = new Map<string, Set<string>>();
                for (const a of employeeProjectAssignments) {
                  if (!map.has(a.employee_id)) map.set(a.employee_id, new Set());
                  map.get(a.employee_id)!.add(a.project_id);
                }
                return map;
              })()}
              permissionLevel={effectivePermissionLevel}
              senderUserId={effectiveUserId}
              canActOnRequests={canActOnRequests}
              viewerEmployeeId={viewerEmployeeId}
              onNotifyPersonnel={notifyScheduledPersonnel}
            />

          </div>
        ) : (
          <div className={`flex min-h-0 w-full flex-col gap-4 lg:h-full lg:mx-auto lg:max-w-[1600px] lg:flex-row lg:gap-6 ${subOverlayEnabled ? 'overflow-x-auto lg:overflow-x-visible' : ''}`}>
            <LeftPanel
              viewMode={scheduleViewMode}
              tasks={filteredTasks}
              showOverlay={showOverlay}
              setShowOverlay={setShowOverlay}
              onDeleteTask={handleDeleteTask}
              onCreateTask={() => setCreateTaskModalOpen(true)}
              onReorderTasks={handleReorderTasks}
              onEditTask={handleEditTask}
              connectedSubs={getConnectedSubCompanies()}
              draftRecommendations={getDraftRecommendations()}
              onGenerateSchedule={handleGenerateSchedule}
              onApproveDraft={handleApproveDraft}
              onDeleteDraft={handleDeleteDraft}
              onUpdateDraft={handleUpdateDraft}
              onUploadSchedule={() => setUploadScheduleModalOpen(true)}
              selectedProject={selectedProject}
              projects={filteredProjects}
              masterOverlayProjectIds={masterOverlayProjectIds}
              onToggleMasterOverlay={(projectId: string) => {
                setMasterOverlayProjectIds(prev =>
                  prev.includes(projectId)
                    ? prev.filter(id => id !== projectId)
                    : [...prev, projectId]
                );
              }}
              isReadOnlyOperator={isReadOnlyOperator}
            />
            
            <CalendarPanel
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedDates={selectedDates}
              setSelectedDates={setSelectedDates}
              tasks={filteredTasks}
              showOverlay={showOverlay}
              onDayClick={handleDayClick}
              pendingRequestDates={scheduleViewMode === 'sub' ? getPendingRequestDates() : []}
              viewMode={scheduleViewMode}
              dayStatuses={getDayStatuses()}
              subOverlayData={subOverlayEnabled ? getSubOverlayData() : []}
              tourRole={
                scheduleViewMode === 'sub'
                  ? (Object.keys(intermediaryByCompanyId || {}).length > 0 ? 'mainsub' : 'sub')
                  : (isGuestGC ? 'guest' : 'gc')
              }
            />
            
            <RightPanel
              viewMode={scheduleViewMode}
              projects={filteredProjects}
              selectedProject={selectedProject}
              setSelectedProject={setSelectedProject}
              employees={(() => {
                const co = employees.filter(e => e.company_id === activeCompanyId);
                if (selectedProject === 'master') return co;
                const assigned = new Set(
                  employeeProjectAssignments
                    .filter(a => a.project_id === selectedProject)
                    .map(a => a.employee_id)
                );
                return co.filter(e => assigned.has(e.id));
              })()}
              onCreateProject={handleCreateProject}
              onAddEmployee={handleAddEmployee}
              onDeleteEmployee={handleDeleteEmployee}
              onConnectProject={handleConnectProject}
              onDeleteProject={handleDeleteProject}
              onDisconnectProject={handleDisconnectProject}
              isGuestGC={isGuestGC}
              onGuestConnect={handleGuestConnect}
              isBasicUser={effectiveIsBasicUser}
              hasLevel1OrHigher={effectiveHasLevel1OrHigher}
              isAdminOrHigher={effectiveIsMOA || effectiveIsAccountHolder || effectivePermissionLevel === 'full'}

              connectedSubs={getConnectedSubCompanies(selectedProject)}
              subSubCompanies={companies.filter(c => sharedSubCompanyIds.has(c.id) && c.id !== activeCompanyId)}
              allEmployees={visibleEmployees}
              allAvailabilities={availabilities}
              currentDate={currentDate}
              subOverlayEnabled={subOverlayEnabled}
              onSubOverlayEnabledChange={setSubOverlayEnabled}
              selectedOverlaySubIds={selectedOverlaySubIds}
              onSelectedOverlaySubIdsChange={setSelectedOverlaySubIds}
              companyId={activeCompanyId}
              isReadOnlyOperator={isReadOnlyOperator}
              onTeamRefresh={fetchEmployeeProjectAssignments}
            />
          </div>
        )}
      </div>

      <ScheduleModal
        isOpen={scheduleModalOpen}
        onClose={() => {
          setScheduleModalOpen(false);
          setSelectedDates([]);
        }}
        selectedDate={selectedDate}
        selectedDates={selectedDates}
        viewMode={scheduleViewMode}
        employees={scheduleModalEmployees}
        rosterLoading={rosterLoading}
        allEmployees={visibleEmployees}

        readOnly={effectiveIsBasicUser || (!effectiveHasLevel1OrHigher && !effectiveIsMOA)}
        canActOnRequests={canActOnRequests}
        projects={filteredProjects}
        allProjectsList={projects}
        availabilities={getAvailabilitiesForDate()}
        connectedSubCompanies={getConnectedSubCompanies(selectedProject)}
        subParentByCompanyId={intermediaryByCompanyId}
        scheduleRequests={getScheduleRequestsForDate()}
        allScheduleRequests={scheduleRequests}
        tasks={filteredTasks}
        confirmedEmployeeIds={getConfirmedEmployeeIds()}
        requestingCompanyId={activeCompanyId}
        currentSelectedProject={selectedProject}
        isGuestGC={isGuestGC}
        guestCompanyName={companies.find(c => c.id === activeCompanyId)?.name || ''}
        onScheduleGC={handleScheduleGC}
        onScheduleSub={handleScheduleSub}
        onRemoveAvailability={handleRemoveAvailability}
        onApproveRequest={handleApproveRequest}
        onRejectRequest={handleRejectRequest}
        onCancelRequest={handleCancelRequest}
        onEditPendingRequestRemoveEmployee={handleEditPendingRequestRemoveEmployee}
        onEditConfirmedRequest={handleEditConfirmedRequest}
        onEditConfirmedRequestForAllDates={handleEditConfirmedRequestForAllDates}
        onEditGCRequest={handleEditGCRequest}
        onEditGCRequestForAllDates={handleEditGCRequestForAllDates}
        onAcknowledgeEdit={handleAcknowledgeEdit}
        onAcknowledgeRejection={handleAcknowledgeRejection}
        onSubEditAndResend={handleSubEditAndResend}
        onSubEditAndResendForAllDates={handleSubEditAndResendForAllDates}
        onSubAssign={handleSubAssign}
        onNotifyPersonnel={handleNotifyPersonnel}
        hasPartialOrHigher={effectiveHasPartialOrHigher}
        employeeProjectAssignments={employeeProjectAssignments.map(a => ({ employee_id: a.employee_id, project_id: a.project_id }))}
        isHistoricalLock={(() => {
          const lockDate = getHistoricalLockDate();
          const datesToCheck = selectedDates.length > 0 ? selectedDates : (selectedDate ? [selectedDate] : []);
          if (datesToCheck.length === 0) return false;
          return datesToCheck.every(d => isBefore(d, lockDate)) && !isMOA;
        })()}
      />

      <CreateTaskModal
        isOpen={createTaskModalOpen}
        onClose={() => setCreateTaskModalOpen(false)}
        onCreateTask={handleCreateTask}
        selectedProject={selectedProject}
        isGCView={scheduleViewMode === 'gc'}
      />

      <EditTaskModal
        isOpen={editTaskModalOpen}
        onClose={() => setEditTaskModalOpen(false)}
        task={taskToEdit}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTask}
        isGCView={scheduleViewMode === 'gc'}
      />

      <UploadScheduleModal
        isOpen={uploadScheduleModalOpen}
        onClose={() => setUploadScheduleModalOpen(false)}
        projectId={selectedProject}
        existingTasks={filteredTasks.map(t => ({ id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date }))}
        onTasksCreated={() => fetchTasks()}
        isGCView={scheduleViewMode === 'gc'}
      />

      {profile?.force_password_change && (
        <ForcePasswordChangeModal
          open={true}
          profileId={profile.id}
          currentName={profile.full_name}
          onComplete={() => {
            // Profile state was refreshed inside the modal — nothing more to do.
          }}
        />
      )}

      <SpotlightTourMount />
    </div>
  );
};

const TOUR_STEP_ORDER: { key: TooltipKey; selector: string }[] = [
  { key: 'tour_calendar_toggle', selector: 'calendar-view-toggle' },
  { key: 'project_dropdown', selector: 'projects-dropdown' },
  { key: 'tour_master_schedule', selector: 'master-schedule' },
  { key: 'tour_team', selector: 'project-team' },
  { key: 'tour_company_account', selector: 'manage-company' },
  { key: 'messages', selector: 'messages-button' },
];

const SpotlightTourMount = () => {
  const { loaded, hasSeen, markSeen } = useTooltipFlags();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'welcome' | 'tour' | 'done'>('idle');
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Frozen for the lifetime of the tour so marking steps seen can't mutate the sequence.
  const [steps, setSteps] = useState<{ key: TooltipKey; selector: string; title?: string; copy: string }[]>([]);

  useEffect(() => {
    // Give the dashboard a beat to mount its anchors before measuring.
    const t = window.setTimeout(() => setReady(true), 800);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!loaded || !ready || phase !== 'idle') return;
    if (hasSeen('guided_tour_done')) { setPhase('done'); return; }

    const resolved = TOUR_STEP_ORDER
      .filter((s) => !hasSeen(s.key))
      .filter((s) => !!document.querySelector(`[data-tour="${s.selector}"]`))
      .map((s) => ({
        key: s.key,
        selector: s.selector,
        title: TOUR_COPY[s.key]?.title,
        copy: TOUR_COPY[s.key]?.copy ?? '',
      }))
      .filter((s) => !!s.copy);

    if (resolved.length === 0) { setPhase('done'); return; }
    setSteps(resolved);
    setPhase('welcome');
  }, [loaded, ready, phase, hasSeen]);

  const finish = () => {
    setPhase('done');
    void markSeen('guided_tour_done');
  };

  if (phase === 'welcome') {
    return (
      <>
        <WelcomeDialog
          open={!confirmSkip}
          onStart={() => setPhase('tour')}
          onSkip={() => setConfirmSkip(true)}
        />
        <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
          <AlertDialogContent className="z-[80]">
            <AlertDialogHeader>
              <AlertDialogTitle>Skip the guided tour?</AlertDialogTitle>
              <AlertDialogDescription>
                You won't be able to restart this tour. Anything you haven't seen yet will still be
                explained the first time you click it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmSkip(false)}>Take the Tour</AlertDialogCancel>
              <AlertDialogAction onClick={finish}>Skip</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (phase !== 'tour' || steps.length === 0) return null;

  return (
    <SpotlightTour
      steps={steps}
      onStepSeen={(k) => { void markSeen(k as TooltipKey); }}
      onFinish={finish}
    />
  );
};


export default Dashboard;