import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { format, subWeeks, startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import bulkImportTemplate from '@/assets/bulk-import-template.xlsx.asset.json';

import { fetchCompanyUsage, isAtEmployeeLimit, remainingEmployees, detectLimitError, type CompanyUsage } from '@/lib/planLimits';
import { PlanLimitDialog } from './PlanLimitDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Users, Plus, Edit, Trash2, Shield, User, Link, Download, CalendarIcon, ChevronDown, ChevronRight, CheckCircle, XCircle, Upload, FileSpreadsheet, Image, Loader2, ArrowLeft } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import * as XLSX from 'xlsx';

type PermissionLevel = Database['public']['Enums']['permission_level'];

interface ProfilesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overrideCompanyId?: string;
  onBack?: () => void;
  onJoinRequestsChanged?: () => void;
}

interface UserRole {
  id: string;
  user_id: string;
  permission_level: PermissionLevel;
  is_company_creator: boolean;
  profile?: {
    full_name: string | null;
    email: string;
    phone: string | null;
  };
}

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  linked_user_id: string | null;
  profile_picture_url: string | null;
  employee_id?: string | null;
}

type CompanyType = 'gc' | 'sub';

const SUB_PERMISSION_DESCRIPTIONS: Record<PermissionLevel, { title: string; description: string }> = {
  account_holder: {
    title: 'Main Company Account Holder',
    description: 'Full access including billing, subscriptions, and all company settings. Can manage team profiles and projects. Can only be transferred by the current account holder.',
  },
  full: {
    title: 'Level 4 Admin',
    description: 'Can manage team profiles, projects, schedules, and requests. Can view Manage My Company Account (Team & Projects tabs only). Cannot access billing or company info.',
  },
  partial: {
    title: 'Level 3 Admin (Partial)',
    description: 'Can manage schedules, view team, manage projects. Cannot change billing or company info. Cannot view Manage My Company Account. Cannot view Master Schedule.',
  },
  level_1: {
    title: 'Level 2 (Foreman Permissions)',
    description: "Can view all employees' availability on the projects they are assigned to (read-only). Can view schedules and assigned tasks. Cannot edit availability.",
  },
  basic: {
    title: 'Level 1 (Basic Permissions)',
    description: 'Can only view their own availability. View schedules and assigned tasks. Cannot edit or change any availability.',
  },
  standard: {
    title: 'User (Legacy)',
    description: 'Basic access only. View schedules and assigned tasks.',
  },
};

const GC_PERMISSION_DESCRIPTIONS: Record<PermissionLevel, { title: string; description: string }> = {
  account_holder: {
    title: 'Main Company Account Holder',
    description: 'Full access including billing, subscriptions, and all company settings. Can manage team profiles and projects. Can only be transferred by the current account holder.',
  },
  full: {
    title: 'Level 2 Admin',
    description: 'Can manage team profiles, projects, schedules, and requests. Can view Manage My Company Account (Team & Projects tabs only). Cannot access billing or company info.',
  },
  partial: {
    title: 'Level 1 Admin (Partial)',
    description: 'Can manage schedules, view team, manage projects. Cannot change billing or company info. Cannot view Manage My Company Account. Cannot view Master Schedule.',
  },
  level_1: {
    title: 'Level 1 (Foreman)',
    description: 'Legacy permission — not assignable to GC team members.',
  },
  basic: {
    title: 'Basic',
    description: 'Legacy permission — not assignable to GC team members.',
  },
  standard: {
    title: 'User (Legacy)',
    description: 'Basic access only. View schedules and assigned tasks.',
  },
};

const getPermissionDescriptions = (companyType: CompanyType | null) =>
  companyType === 'gc' ? GC_PERMISSION_DESCRIPTIONS : SUB_PERMISSION_DESCRIPTIONS;

const getVisiblePermissions = (companyType: CompanyType | null): PermissionLevel[] =>
  companyType === 'gc'
    ? ['account_holder', 'full', 'partial']
    : ['account_holder', 'full', 'partial', 'level_1', 'basic'];

const TimesheetDownloadCard = ({ employees, effectiveCompanyId }: { employees: Employee[]; effectiveCompanyId: string | null | undefined }) => {
  const [selectedWeeks, setSelectedWeeks] = useState('1');
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>();
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>();
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const handleDownload = async () => {
    if (!effectiveCompanyId || employees.length === 0) {
      toast({ title: 'No Employees', description: 'There are no employees to generate timesheets for.', variant: 'destructive' });
      return;
    }

    let computedStart: Date;
    let computedEnd: Date;
    const now = new Date();

    if (useCustomRange && customStartDate && customEndDate) {
      computedStart = startOfDay(customStartDate);
      computedEnd = endOfDay(customEndDate);
    } else {
      const weeks = parseInt(selectedWeeks);
      computedStart = startOfDay(subWeeks(now, weeks));
      computedEnd = endOfDay(now);
    }

    setDownloading(true);
    try {
      const employeeIds = employees.map(e => e.id);

      // Get confirmed schedule requests for these employees in the date range
      const startDateStr = format(computedStart, 'yyyy-MM-dd');
      const endDateStr = format(computedEnd, 'yyyy-MM-dd');

      const { data: confirmedRequests, error: reqError } = await supabase
        .from('schedule_requests')
        .select('*, projects:project_id(name, company_id, owner_display_name, companies:company_id(name))')
        .eq('status', 'confirmed')
        .gte('scheduled_date', startDateStr)
        .lte('scheduled_date', endDateStr)
        .order('scheduled_date', { ascending: true });

      if (reqError) throw reqError;

      const rows: string[] = ['Employee ID,Employee Name,Date,Start Time,End Time,Hours,Job Name,General Contractor'];
      const employeeMap = new Map(employees.map(e => [e.id, { name: e.name, employee_id: ((e as any).employee_id as string | null) || '' }]));

      // Use schedule request start_time/end_time directly — these are the actual scheduled hours
      (confirmedRequests || []).forEach((req: any) => {
        const reqEmployeeIds = (req.employee_ids || []) as string[];
        const jobName = req.projects?.name || 'Unknown';
        const gcName = req.projects?.companies?.name || req.projects?.owner_display_name || req.guest_gc_company_name || 'Former Guest Account';
        reqEmployeeIds.forEach((empId: string) => {
          if (!employeeIds.includes(empId)) return;
          const empInfo = employeeMap.get(empId);
          const name = empInfo?.name || 'Unknown';
          const empIdValue = empInfo?.employee_id || '';

          if (req.start_time && req.end_time) {
            const [sh, sm] = req.start_time.split(':').map(Number);
            const [eh, em] = req.end_time.split(':').map(Number);
            const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
            const hours = (totalMinutes / 60).toFixed(2);
            const startDate = new Date(2000, 0, 1, sh, sm);
            const endDate = new Date(2000, 0, 1, eh, em);
            rows.push(`"${empIdValue}","${name}","${req.scheduled_date}","${format(startDate, 'h:mm a')}","${format(endDate, 'h:mm a')}","${hours}","${jobName}","${gcName}"`);
          }
        });
      });

      if (rows.length === 1) {
        toast({ title: 'No Data', description: 'No timesheet records found for the selected period.' });
        setDownloading(false);
        return;
      }

      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const label = useCustomRange
        ? `${format(computedStart, 'yyyy-MM-dd')}_to_${format(computedEnd, 'yyyy-MM-dd')}`
        : `${selectedWeeks}wk`;
      a.download = `timesheets_${label}_${format(now, 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: 'Download Complete', description: `${rows.length - 1} timesheet records exported.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to download timesheets.', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" />
          Download Timesheets
        </CardTitle>
        <CardDescription>
          Export employee availability timesheets as CSV
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "w-[130px] justify-start text-left font-normal",
                  !customStartDate && "text-muted-foreground"
                )}
                onClick={() => setUseCustomRange(true)}
              >
                <CalendarIcon className="h-3 w-3 mr-1" />
                {customStartDate ? format(customStartDate, 'MMM d, yyyy') : 'Start date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-50" align="start">
              <Calendar
                mode="single"
                selected={customStartDate}
                onSelect={(d) => { setCustomStartDate(d); setUseCustomRange(true); }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "w-[130px] justify-start text-left font-normal",
                  !customEndDate && "text-muted-foreground"
                )}
                onClick={() => setUseCustomRange(true)}
              >
                <CalendarIcon className="h-3 w-3 mr-1" />
                {customEndDate ? format(customEndDate, 'MMM d, yyyy') : 'End date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-50" align="start">
              <Calendar
                mode="single"
                selected={customEndDate}
                onSelect={(d) => { setCustomEndDate(d); setUseCustomRange(true); }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          <span className="text-xs text-muted-foreground">or</span>

          <Select value={useCustomRange ? '' : selectedWeeks} onValueChange={(v) => { setSelectedWeeks(v); setUseCustomRange(false); setCustomStartDate(undefined); setCustomEndDate(undefined); }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Quick select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Week</SelectItem>
              <SelectItem value="2">2 Weeks</SelectItem>
              <SelectItem value="3">3 Weeks</SelectItem>
              <SelectItem value="4">4 Weeks</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={handleDownload}
            disabled={downloading || (useCustomRange && (!customStartDate || !customEndDate))}
            size="sm"
          >
            <Download className="h-4 w-4 mr-1" />
            {downloading ? 'Downloading...' : 'Download'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const ProfilesModal = ({ open, onOpenChange, overrideCompanyId, onBack, onJoinRequestsChanged }: ProfilesModalProps) => {
  const { profile, isMOA, isAccountHolder, hasPartialOrHigher, permissionLevel } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companyIsGuest, setCompanyIsGuest] = useState(false);
  const [companyType, setCompanyType] = useState<CompanyType | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ roleId: string; userId: string; name: string } | null>(null);
  const [companyProjects, setCompanyProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectAssignments, setProjectAssignments] = useState<Record<string, { projectIds: string[]; receiveNotifications: boolean }>>({});
  const [employeeProjectAssignments, setEmployeeProjectAssignments] = useState<Record<string, { projectIds: string[]; receiveNotifications: boolean }>>({});
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<string[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<{ id: string; user_id: string; user_email: string; user_name: string | null; created_at: string; metadata?: any }[]>([]);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  
  // Form state
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [employeePhone, setEmployeePhone] = useState('');
  const [employeeJobTitle, setEmployeeJobTitle] = useState('');
  const [employeeIdValue, setEmployeeIdValue] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>('basic');
  const [employeePassword, setEmployeePassword] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [neverLoggedIn, setNeverLoggedIn] = useState(false);
  const [employeePhotoUrl, setEmployeePhotoUrl] = useState<string | null>(null);
  const [isUploadingEmpPhoto, setIsUploadingEmpPhoto] = useState(false);
  const employeeFileInputRef = useRef<HTMLInputElement>(null);
  const pendingRequestsRef = useRef<HTMLDivElement>(null);
  // Bulk import state
  interface BulkEmployee {
    name: string;
    job_title: string | null;
    phone: string | null;
    email: string | null;
    employee_id: string | null;
    approved: boolean;
    password: string;
  }
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkEmployees, setBulkEmployees] = useState<BulkEmployee[]>([]);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  };

  const handleBulkFileUpload = async (file: File) => {
    setBulkParsing(true);
    try {
      if (file.type.startsWith('image/')) {
        // OCR via edge function
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const { data, error } = await supabase.functions.invoke('parse-employee-roster', {
          body: { imageBase64: base64, mimeType: file.type },
        });
        if (error) throw new Error(error.message);
        const parsed = (data?.employees || []).map((e: any) => ({
          name: e.name || '',
          job_title: e.job_title || null,
          phone: e.phone || null,
          email: e.email || null,
          employee_id: e.employee_id || null,
          approved: true,
          password: generatePassword(),
        }));
        setBulkEmployees(parsed);
      } else {
        // Excel/CSV
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const findCol = (row: any, ...candidates: string[]) => {
          for (const key of Object.keys(row)) {
            const lower = key.toLowerCase().trim();
            if (candidates.some(c => lower.includes(c))) return String(row[key] || '').trim();
          }
          return '';
        };

        // Treat blank/placeholder employee IDs as truly blank — never auto-fill.
        const sanitizeEmployeeId = (raw: string): string | null => {
          const v = (raw || '').trim();
          if (!v) return null;
          if (['n/a', 'na', '-', '--', 'none', 'null'].includes(v.toLowerCase())) return null;
          return v;
        };

        const parsed: BulkEmployee[] = rows
          .map(row => ({
            name: findCol(row, 'name', 'full name', 'employee'),
            job_title: findCol(row, 'title', 'job', 'position', 'role') || null,
            phone: findCol(row, 'phone', 'mobile', 'cell', 'tel') || null,
            email: findCol(row, 'email', 'e-mail', 'mail') || null,
            employee_id: sanitizeEmployeeId(findCol(row, 'employee id', 'emp id', 'employee #', 'employee number', 'emp #')),
            approved: true,
            password: generatePassword(),
          }))
          .filter(e => e.name.length > 0);

        setBulkEmployees(parsed);
      }
      setShowBulkImport(true);
    } catch (err: any) {
      toast({ title: 'Error parsing file', description: err.message, variant: 'destructive' });
    } finally {
      setBulkParsing(false);
    }
  };

  const handleBulkCreate = async () => {
    if (!effectiveCompanyId) return;
    const approved = bulkEmployees.filter(e => e.approved && e.name);
    if (approved.length === 0) return;
    const invalidEmailRows = approved.filter(e => !e.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim()));
    if (invalidEmailRows.length > 0) {
      toast({ title: 'Email required', description: 'Every employee must have a valid email address before they can be imported.', variant: 'destructive' });
      return;
    }

    // Short-circuit bulk to remaining slots
    const fresh = await fetchCompanyUsage(effectiveCompanyId);
    setEmployeeUsage(fresh);
    const remaining = remainingEmployees(fresh);
    if (remaining <= 0) {
      setEmployeeLimitOpen(true);
      return;
    }
    const toCreate = approved.slice(0, remaining);
    if (toCreate.length < approved.length) {
      toast({ title: 'Plan limit', description: `Only ${remaining} of ${approved.length} employees will be added. Upgrade your plan to add the rest.` });
    }

    setBulkCreating(true);
    let created = 0;
    let emailed = 0;
    for (const emp of toCreate) {
      try {
        const normalizedEmail = emp.email.trim().toLowerCase();
        const cleanedEmpId = (emp.employee_id || '').trim();
        const empIdValue = cleanedEmpId && !['n/a','na','-','--','none','null'].includes(cleanedEmpId.toLowerCase())
          ? cleanedEmpId
          : null;
        const { data: newEmp, error } = await supabase.from('employees').insert({
          name: emp.name,
          email: normalizedEmail,
          phone: emp.phone || null,
          job_title: emp.job_title || null,
          employee_id: empIdValue,
          company_id: effectiveCompanyId,
        } as any).select().single();

        if (error) { console.error('Bulk create error:', error); continue; }

        const { data: accountResult, error: accountError } = await supabase.functions.invoke('create-employee-user', {
          body: {
            email: normalizedEmail,
            name: emp.name,
            companyId: effectiveCompanyId,
            permissionLevel: companyIsGuest ? 'account_holder' : 'level_1',
            employeeId: newEmp.id,
            password: emp.password,
          },
        });
        if (accountError) {
          await supabase.from('employees').delete().eq('id', newEmp.id);
          throw accountError;
        }
        created++;
        if ((accountResult as any)?.emailSent) emailed++;
      } catch (err) {
        console.error('Bulk create error:', err);
      }
    }
    toast({
      title: 'Bulk Import Complete',
      description: emailed === created
        ? `${created} of ${approved.length} employees created. Welcome emails sent to all ${emailed}.`
        : `${created} of ${approved.length} employees created. Welcome emails sent to ${emailed} — ${created - emailed} could not be emailed.`,
      variant: emailed === created ? undefined : 'destructive',
    });
    setBulkEmployees([]);
    setShowBulkImport(false);
    setBulkCreating(false);
    // Reset the create-employee form state so the Edit buttons re-enable
    // (they're gated on `isCreating || !!editingEmployee`). Without this,
    // freshly imported employees stay un-editable until the user logs out.
    resetForm();
    await fetchData();
  };

  const effectiveCompanyId = overrideCompanyId || profile?.company_id;

  // Check if user can manage permissions (change permission levels)
  const canManagePermissions = isMOA || isAccountHolder || permissionLevel === 'full' || permissionLevel === 'partial';

  // Permission hierarchy for determining what levels a user can assign
  const PERMISSION_HIERARCHY: Record<string, number> = {
    basic: 0,
    level_1: 1,
    partial: 2,
    full: 3,
    account_holder: 4,
  };

  const currentUserRank = PERMISSION_HIERARCHY[permissionLevel || 'basic'] ?? 0;

  // Determine which permission levels the current user can assign to a target
  const getAssignablePermissions = (targetRole: UserRole): PermissionLevel[] => {
    const targetIsCurrentUser = targetRole.user_id === profile?.user_id;
    const targetRank = PERMISSION_HIERARCHY[targetRole.permission_level] ?? 0;

    // Can't change own permission level (unless MOA)
    if (targetIsCurrentUser && !isMOA) return [];

    // Can't change someone at same or higher level (unless MOA or account_holder)
    if (!isMOA && !isAccountHolder && targetRank >= currentUserRank) return [];

    // Only MOA and account_holder can assign 'full' or 'account_holder'
    const allLevels: PermissionLevel[] = ['basic', 'level_1', 'partial', 'full', 'account_holder'];
    return allLevels.filter((level) => {
      if (level === 'standard') return false;
      if (level === 'account_holder') return isMOA || isAccountHolder;
      if (level === 'full') return isMOA || isAccountHolder;
      return true;
    });
  };
  // Check if user can assign projects (partial+ or MOA)
  const canAssignProjects = isMOA || hasPartialOrHigher;

  const fetchData = async () => {
    if (!effectiveCompanyId) return;

    // Fetch user roles with profile data
    const { data: rolesData, error: rolesError } = await supabase
      .from('user_roles')
      .select('*')
      .eq('company_id', effectiveCompanyId);

    if (rolesError) {
      console.error('Error fetching roles:', rolesError);
    } else if (rolesData) {
      // Fetch profiles for each role
      const rolesWithProfiles = await Promise.all(
        rolesData.map(async (role) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, email, phone')
            .eq('user_id', role.user_id)
            .single();
          return { ...role, profile: profileData || undefined };
        })
      );
      setUserRoles(rolesWithProfiles);
    }

    // Fetch employees
    const { data: employeesData, error: employeesError } = await supabase
      .from('employees')
      .select('*')
      .eq('company_id', effectiveCompanyId);

    if (employeesError) {
      console.error('Error fetching employees:', employeesError);
    } else {
      setEmployees(employeesData || []);
    }

    // Fetch company guest status + type (gates team-edit + permission labels)
    const { data: companyData } = await supabase
      .from('companies')
      .select('is_guest, company_type')
      .eq('id', effectiveCompanyId)
      .maybeSingle();
    setCompanyIsGuest(!!companyData?.is_guest);
    setCompanyType((companyData?.company_type as CompanyType | null) ?? null);

    // Fetch company projects (owned + connected)
    const { data: ownedProjects } = await supabase
      .from('projects')
      .select('id, name')
      .eq('company_id', effectiveCompanyId);
    
    const { data: connectedProjectIds } = await supabase
      .from('project_connections')
      .select('project_id')
      .eq('sub_company_id', effectiveCompanyId);
    
    let connectedProjects: { id: string; name: string }[] = [];
    if (connectedProjectIds && connectedProjectIds.length > 0) {
      const { data: connProjs } = await supabase
        .from('projects')
        .select('id, name')
        .in('id', connectedProjectIds.map(c => c.project_id));
      connectedProjects = connProjs || [];
    }

    const allProjects = [...(ownedProjects || []), ...connectedProjects];
    // Deduplicate and filter out Customers Calendar
    const uniqueProjects = Array.from(new Map(allProjects.map(p => [p.id, p])).values());
    setCompanyProjects(uniqueProjects);

    // Fetch user project assignments for this company
    const { data: assignments } = await supabase
      .from('user_project_assignments')
      .select('*')
      .eq('company_id', effectiveCompanyId);
    
    if (assignments) {
      const assignmentMap: Record<string, { projectIds: string[]; receiveNotifications: boolean }> = {};
      for (const a of assignments) {
        if (!assignmentMap[a.user_id]) {
          assignmentMap[a.user_id] = { projectIds: [], receiveNotifications: true };
        }
        assignmentMap[a.user_id].projectIds.push(a.project_id);
        assignmentMap[a.user_id].receiveNotifications = a.receive_notifications;
      }
      setProjectAssignments(assignmentMap);
    }

    // Fetch employee project assignments for this company
    const { data: empAssignments } = await supabase
      .from('employee_project_assignments')
      .select('*')
      .eq('company_id', effectiveCompanyId);
    
    if (empAssignments) {
      const empAssignmentMap: Record<string, { projectIds: string[]; receiveNotifications: boolean }> = {};
      for (const a of empAssignments) {
        if (!empAssignmentMap[a.employee_id]) {
          empAssignmentMap[a.employee_id] = { projectIds: [], receiveNotifications: true };
        }
        empAssignmentMap[a.employee_id].projectIds.push(a.project_id);
        empAssignmentMap[a.employee_id].receiveNotifications = a.receive_notifications;
      }
      setEmployeeProjectAssignments(empAssignmentMap);
    }

    // Fetch pending join requests.
    // Visibility: account_holder/full/MOA for sub companies; account_holder/MOA only for GC.
    const isGCCompany = companyType === 'gc';
    const canSeePendingJoinRequests = isMOA || isAccountHolder || (!isGCCompany && canManagePermissions);
    if (canSeePendingJoinRequests) {
      const { data: joinRequests } = await supabase
        .from('company_join_requests')
        .select('id, user_id, user_email, user_name, created_at, metadata')
        .eq('company_id', effectiveCompanyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      setPendingJoinRequests(joinRequests || []);
    }
  };

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, effectiveCompanyId]);

  // Scroll to pending requests when the modal has any
  useEffect(() => {
    if (open && pendingJoinRequests.length > 0 && pendingRequestsRef.current) {
      const timer = setTimeout(() => {
        pendingRequestsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [open, pendingJoinRequests.length]);

  const resetForm = () => {
    setEmployeeName('');
    setEmployeeEmail('');
    setEmployeePhone('');
    setEmployeeJobTitle('');
    setEmployeeIdValue('');
    setSelectedPermission('basic');
    setEmployeePassword('');
    setResetPasswordValue('');
    setNeverLoggedIn(false);
    setEmployeePhotoUrl(null);
    setIsCreating(false);
    setEditingEmployee(null);
  };

  const handleEmployeePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingEmployee) return;
    setIsUploadingEmpPhoto(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `employees/${editingEmployee.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from('profile-pictures').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('profile-pictures').getPublicUrl(path);
      const url = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase.from('employees').update({ profile_picture_url: url }).eq('id', editingEmployee.id);
      setEmployeePhotoUrl(url);
      toast({ title: 'Photo updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploadingEmpPhoto(false);
    }
  };

  const handleRemoveEmployeePhoto = async () => {
    if (!editingEmployee) return;
    try {
      await supabase.from('employees').update({ profile_picture_url: null }).eq('id', editingEmployee.id);
      setEmployeePhotoUrl(null);
      toast({ title: 'Photo removed' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // Check if a user with this email already exists and link them
  const checkAndLinkUser = async (email: string | null, employeeId: string) => {
    if (!email || !effectiveCompanyId) return null;
    const normalizedEmail = email.trim().toLowerCase();

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .ilike('email', normalizedEmail)
      .eq('company_id', effectiveCompanyId)
      .single();

    if (existingProfile) {
      await supabase
        .from('employees')
        .update({ linked_user_id: existingProfile.user_id })
        .eq('id', employeeId);

      return existingProfile;
    }

    return null;
  };

  // Process any pending email sync queue items
  const processEmailSyncQueue = async () => {
    try {
      const { error } = await supabase.functions.invoke('process-profile-email-sync');
      if (error) {
        throw error;
      }
    } catch (err) {
      console.error('Error processing email sync queue:', err);
      throw err;
    }
  };

  const [employeeLimitOpen, setEmployeeLimitOpen] = useState(false);
  const [employeeUsage, setEmployeeUsage] = useState<CompanyUsage | null>(null);

  const handleCreateEmployee = async () => {
    if (!employeeName || !effectiveCompanyId) return;
    const normalizedEmail = employeeEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast({ title: 'Email required', description: 'Every employee must have a valid email address so their account can be created.', variant: 'destructive' });
      return;
    }

    // Pre-check
    const fresh = await fetchCompanyUsage(effectiveCompanyId);
    setEmployeeUsage(fresh);
    if (isAtEmployeeLimit(fresh)) {
      setEmployeeLimitOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      const { data: newEmployee, error } = await supabase.from('employees').insert({
        name: employeeName,
        email: normalizedEmail,
        phone: employeePhone || null,
        job_title: employeeJobTitle || null,
        employee_id: employeeIdValue.trim() || null,
        company_id: effectiveCompanyId,
      } as any).select().single();

      if (error) {
        if (detectLimitError(error) === 'employee') {
          setEmployeeUsage(await fetchCompanyUsage(effectiveCompanyId));
          setEmployeeLimitOpen(true);
          setIsLoading(false);
          return;
        }
        throw error;
      }

      // Every employee receives an account immediately, before their first login.
      {
        const { data: createResult, error: createError } = await supabase.functions.invoke('create-employee-user', {
          body: {
            email: normalizedEmail,
            name: employeeName,
            companyId: effectiveCompanyId,
            permissionLevel: companyIsGuest ? 'account_holder' : selectedPermission,
            employeeId: newEmployee.id,
            password: employeePassword || undefined,
          }
        });

        if (createError) {
          await supabase.from('employees').delete().eq('id', newEmployee.id);
          throw new Error(`Employee account could not be created: ${createError.message}`);
        } else if (createResult?.isExisting) {
          toast({
            title: "Employee Created & Linked",
            description: `${employeeName} has been linked to an existing user account.`,
          });
        } else {
          toast({
            title: "Employee Created",
            description: `${employeeName} has been created. An invitation email has been sent.`,
          });
        }
      }

      resetForm();
      fetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;

    setIsLoading(true);
    let employeeSaved = false;
    try {
      const normalizedEmail = employeeEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('Every employee must have a valid email address.');
      }
      const cleanedEmpIdRaw = (employeeIdValue || '').trim();
      const cleanedEmpId = cleanedEmpIdRaw && !['n/a','na','-','--','none','null'].includes(cleanedEmpIdRaw.toLowerCase())
        ? cleanedEmpIdRaw
        : null;

      const previousEmployee = {
        name: editingEmployee.name,
        email: editingEmployee.email,
        phone: editingEmployee.phone,
        job_title: editingEmployee.job_title,
        employee_id: editingEmployee.employee_id || null,
      };
      const employeeUpdate = {
        name: employeeName,
        email: normalizedEmail,
        phone: employeePhone || null,
        job_title: employeeJobTitle || null,
        employee_id: cleanedEmpId,
      } as any;
      const { error } = await supabase
        .from('employees')
        .update(employeeUpdate)
        .eq('id', editingEmployee.id);

      if (error) throw error;
      employeeSaved = true;

      // An employee without a linked login must be provisioned before the edit completes.
      if (!editingEmployee.linked_user_id) {
        const { error: accountError } = await supabase.functions.invoke('create-employee-user', {
          body: {
            email: normalizedEmail,
            name: employeeName,
            companyId: effectiveCompanyId,
            permissionLevel: companyIsGuest ? 'account_holder' : selectedPermission,
            employeeId: editingEmployee.id,
          },
        });
        if (accountError) {
          await supabase.from('employees').update(previousEmployee).eq('id', editingEmployee.id);
          throw new Error(`Employee account could not be created: ${accountError.message}`);
        }
      }

      // SECONDARY (non-blocking): sync linked profile + auth email + permission.
      try {
        if (editingEmployee.linked_user_id) {
          const profileUpdate: any = {};
          if (employeeName) profileUpdate.full_name = employeeName;
          if (employeePhone) profileUpdate.phone = employeePhone.replace(/\D/g, '');
          const emailChanged = !!normalizedEmail && normalizedEmail !== (editingEmployee.email || '').trim().toLowerCase();
          if (emailChanged) profileUpdate.email = normalizedEmail;

          if (Object.keys(profileUpdate).length > 0) {
            const { error: profileError } = await supabase
              .from('profiles')
              .update(profileUpdate)
              .eq('user_id', editingEmployee.linked_user_id);
            if (profileError) console.error('Linked profile update warning:', profileError);
          }

          if (emailChanged) {
            try {
              await processEmailSyncQueue();
            } catch (syncErr) {
              console.error('Email sync queue processing failed (non-blocking):', syncErr);
            }
          }

          // Update permission level if changed
          const linkedRole = userRoles.find(r => r.user_id === editingEmployee.linked_user_id);
          const effectivePermission: PermissionLevel = companyIsGuest ? 'account_holder' : selectedPermission;
          if (linkedRole && linkedRole.permission_level !== effectivePermission && (canManagePermissions || companyIsGuest)) {
            try {
              if (effectivePermission === 'account_holder' && !linkedRole.is_company_creator) {
                const currentAccountHolderRole = userRoles.find(
                  r => r.permission_level === 'account_holder' || r.is_company_creator
                );
                if (currentAccountHolderRole && currentAccountHolderRole.id !== linkedRole.id) {
                  await supabase
                    .from('user_roles')
                    .update({ permission_level: 'account_holder', is_company_creator: true })
                    .eq('id', currentAccountHolderRole.id);
                }
                await supabase
                  .from('user_roles')
                  .update({ permission_level: 'account_holder', is_company_creator: companyIsGuest ? true : false })
                  .eq('id', linkedRole.id);
              } else {
                await supabase
                  .from('user_roles')
                  .update({ permission_level: effectivePermission })
                  .eq('id', linkedRole.id);
              }
            } catch (roleErr) {
              console.error('Permission update warning (non-blocking):', roleErr);
            }
          }
        }

        if (normalizedEmail && !editingEmployee.linked_user_id) {
          try {
            await checkAndLinkUser(normalizedEmail, editingEmployee.id);
          } catch (linkErr) {
            console.error('Link-user warning (non-blocking):', linkErr);
          }
        }
      } catch (secondaryErr) {
        console.error('Post-save secondary work failed (non-blocking):', secondaryErr);
      }

      toast({
        title: "Employee Updated",
        description: "The employee profile has been updated successfully.",
      });
    } catch (error: any) {
      if (employeeSaved) {
        // Should not happen — primary already succeeded — but be defensive.
        toast({ title: "Employee Updated", description: "Saved with warnings." });
      } else {
        toast({
          title: "Error",
          description: error.message || 'Failed to update employee.',
          variant: "destructive",
        });
      }
    } finally {
      // Always reset & refresh so the UI never appears stuck.
      try { resetForm(); } catch {}
      try { await fetchData(); } catch {}
      setIsLoading(false);
    }
  };


  const handleDeleteEmployee = async (employeeId: string) => {
    setIsLoading(true);
    try {
      // Check if employee is linked to a user account
      const employee = employees.find(e => e.id === employeeId);
      const linkedUserId = employee?.linked_user_id;

      // Remove employee from FUTURE schedule requests only
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: futureRequests } = await supabase
        .from('schedule_requests')
        .select('id, employee_ids')
        .gt('scheduled_date', today)
        .or(`status.eq.pending,status.eq.confirmed`);

      if (futureRequests) {
        for (const req of futureRequests) {
          const empIds = req.employee_ids || [];
          if (empIds.includes(employeeId)) {
            const updatedIds = empIds.filter((id: string) => id !== employeeId);
            await supabase
              .from('schedule_requests')
              .update({ employee_ids: updatedIds })
              .eq('id', req.id);
          }
        }
      }

      const { error } = await supabase.from('employees').delete().eq('id', employeeId);

      if (error) throw error;

      // If employee was linked to a user and caller is MOA, also delete the auth user
      if (linkedUserId && isMOA) {
        try {
          await supabase.functions.invoke('delete-auth-user', {
            body: { user_id: linkedUserId }
          });
        } catch (authErr) {
          console.error('Error deleting auth user:', authErr);
        }
      }

      toast({
        title: t('employee.deleted'),
        description: t('employee.deletedDesc'),
      });
      setEmployeeToDelete(null);
      fetchData();
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveJoinRequest = async (requestId: string, userId: string, userEmail: string) => {
    setIsLoading(true);
    try {
      // 1. Determine default permission based on company type
      const { data: companyData } = await supabase
        .from('companies')
        .select('company_type, is_guest')
        .eq('id', effectiveCompanyId!)
        .single();

      const defaultPermission: PermissionLevel = companyData?.is_guest
        ? 'account_holder'
        : companyData?.company_type === 'gc' ? 'partial' : 'basic';

      // 2. Call the SECURITY DEFINER RPC. This handles:
      //    - profile.company_id update (bypasses RLS limitation when current company_id is NULL)
      //    - user_roles upsert
      //    - case-insensitive employee link + admin-data overwrite of profile name/phone/email
      //    - marking the request approved
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        'approve_company_join_request',
        {
          p_request_id: requestId,
          p_default_permission: defaultPermission,
        },
      );

      if (rpcError) throw rpcError;

      const result = (rpcResult as {
        linked_employee_id: string | null;
        requester_user_id: string;
        requester_email: string;
        requester_name: string | null;
        company_id: string;
      } | null) || null;

      // 3. If no pre-existing employee was linked, create a new employees row
      //    so the approved user shows up under "Employee Profiles" right away.
      if (result && !result.linked_employee_id) {
        const { error: empInsertError } = await supabase
          .from('employees')
          .insert({
            company_id: effectiveCompanyId!,
            name: result.requester_name || result.requester_email,
            email: result.requester_email,
            linked_user_id: result.requester_user_id,
          });
        if (empInsertError) {
          console.error('Failed to auto-create employee row:', empInsertError);
        }
      }

      // 4. Notify the requester (fire-and-forget)
      try {
        await supabase.functions.invoke('notify-join-request', {
          body: { requestId, action: 'approved' },
        });
      } catch (notifyErr) {
        console.error('Failed to send approval notification:', notifyErr);
      }

      toast({
        title: "Request Approved",
        description: `${userEmail} has been added to the company.`,
      });
      fetchData();
      onJoinRequestsChanged?.();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDenyJoinRequest = async (requestId: string, userEmail: string) => {
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('company_join_requests')
        .update({ status: 'denied', reviewed_by: profile?.user_id })
        .eq('id', requestId);

      if (error) throw error;

      // Notify the requester (fire-and-forget)
      try {
        await supabase.functions.invoke('notify-join-request', {
          body: { requestId, action: 'denied' },
        });
      } catch (notifyErr) {
        console.error('Failed to send denial notification:', notifyErr);
      }

      toast({
        title: "Request Denied",
        description: `Join request from ${userEmail} has been denied.`,
      });
      fetchData();
      onJoinRequestsChanged?.();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePermission = async (roleId: string, newLevel: PermissionLevel) => {
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ permission_level: newLevel })
        .eq('id', roleId);

      if (error) throw error;

      toast({
        title: "Permissions Updated",
        description: "User permissions have been updated successfully.",
      });
      fetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransferAccountHolder = async () => {
    if (!transferTarget || !effectiveCompanyId) return;
    
    setIsLoading(true);
    try {
      // Find the current account holder's role — keep them as account_holder, just remove creator flag
      const currentAccountHolderRole = userRoles.find(
        r => r.permission_level === 'account_holder' || r.is_company_creator
      );
      
      if (currentAccountHolderRole) {
        // Current holder REMAINS an account_holder; only release the is_company_creator flag.
        const { error: keepError } = await supabase
          .from('user_roles')
          .update({ permission_level: 'account_holder', is_company_creator: true })
          .eq('id', currentAccountHolderRole.id);
        
        if (keepError) throw keepError;
      }
      
      // Promote target user to account_holder as well (both will be account_holder).
      const { error: promoteError } = await supabase
        .from('user_roles')
        .update({ permission_level: 'account_holder', is_company_creator: false })
        .eq('id', transferTarget.roleId);
      
      if (promoteError) throw promoteError;
      
      toast({
        title: "Account Holder Granted",
        description: `${transferTarget.name} is now a Main Company Account Holder. You remain a Main Company Account Holder as well.`,
      });
      
      setTransferTarget(null);
      fetchData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startEdit = async (employee: Employee) => {
    setEditingEmployee(employee);
    setEmployeeName(employee.name);
    setEmployeeEmail(employee.email || '');
    setEmployeePhone(employee.phone || '');
    setEmployeeJobTitle(employee.job_title || '');
    setEmployeeIdValue(((employee as any).employee_id as string | null) || '');
    setEmployeePhotoUrl(employee.profile_picture_url || null);
    setNeverLoggedIn(false);
    
    if (employee.linked_user_id) {
      const { data } = await supabase.rpc('check_user_never_logged_in', { p_user_id: employee.linked_user_id });
      if (data === true) {
        setNeverLoggedIn(true);
      }
      // Load the employee's current permission level
      const linkedRole = userRoles.find(r => r.user_id === employee.linked_user_id);
      if (linkedRole) {
        setSelectedPermission(linkedRole.permission_level);
      }
    } else {
      setSelectedPermission('basic');
    }
  };

  const toggleExpandUser = (userId: string) => {
    setExpandedUserIds(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const toggleExpandEmployee = (employeeId: string) => {
    setExpandedEmployeeIds(prev => 
      prev.includes(employeeId) ? prev.filter(id => id !== employeeId) : [...prev, employeeId]
    );
  };

  const handleToggleProjectAssignment = async (userId: string, projectId: string, isAssigned: boolean) => {
    if (!effectiveCompanyId) return;
    
    if (isAssigned) {
      await supabase
        .from('user_project_assignments')
        .delete()
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .eq('company_id', effectiveCompanyId);
    } else {
      const currentNotifSetting = projectAssignments[userId]?.receiveNotifications ?? true;
      await supabase
        .from('user_project_assignments')
        .insert({
          user_id: userId,
          project_id: projectId,
          company_id: effectiveCompanyId,
          receive_notifications: currentNotifSetting,
        });
    }

    setProjectAssignments(prev => {
      const current = prev[userId] || { projectIds: [], receiveNotifications: true };
      const newProjectIds = isAssigned
        ? current.projectIds.filter(id => id !== projectId)
        : [...current.projectIds, projectId];
      return { ...prev, [userId]: { ...current, projectIds: newProjectIds } };
    });
  };

  const handleToggleNotifications = async (userId: string, enabled: boolean) => {
    if (!effectiveCompanyId) return;
    
    await supabase
      .from('user_project_assignments')
      .update({ receive_notifications: enabled })
      .eq('user_id', userId)
      .eq('company_id', effectiveCompanyId);
    
    setProjectAssignments(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] || { projectIds: [] }), receiveNotifications: enabled },
    }));
  };

  const handleToggleEmployeeProjectAssignment = async (employeeId: string, projectId: string, isAssigned: boolean) => {
    if (!effectiveCompanyId) return;
    
    if (isAssigned) {
      await supabase
        .from('employee_project_assignments')
        .delete()
        .eq('employee_id', employeeId)
        .eq('project_id', projectId)
        .eq('company_id', effectiveCompanyId);
    } else {
      const currentNotifSetting = employeeProjectAssignments[employeeId]?.receiveNotifications ?? true;
      await supabase
        .from('employee_project_assignments')
        .insert({
          employee_id: employeeId,
          project_id: projectId,
          company_id: effectiveCompanyId,
          receive_notifications: currentNotifSetting,
        });
    }

    setEmployeeProjectAssignments(prev => {
      const current = prev[employeeId] || { projectIds: [], receiveNotifications: true };
      const newProjectIds = isAssigned
        ? current.projectIds.filter(id => id !== projectId)
        : [...current.projectIds, projectId];
      return { ...prev, [employeeId]: { ...current, projectIds: newProjectIds } };
    });
  };

  const handleToggleEmployeeNotifications = async (employeeId: string, enabled: boolean) => {
    if (!effectiveCompanyId) return;
    
    await supabase
      .from('employee_project_assignments')
      .update({ receive_notifications: enabled })
      .eq('employee_id', employeeId)
      .eq('company_id', effectiveCompanyId);
    
    setEmployeeProjectAssignments(prev => ({
      ...prev,
      [employeeId]: { ...(prev[employeeId] || { projectIds: [] }), receiveNotifications: enabled },
    }));
  };

  const PERMISSION_DESCRIPTIONS = getPermissionDescriptions(companyType);
  const VISIBLE_PERMISSIONS = getVisiblePermissions(companyType);

  // Bulk Assign Personnel to Projects
  const [bulkSelectedEmployees, setBulkSelectedEmployees] = useState<Set<string>>(new Set());
  const [bulkSelectedProjects, setBulkSelectedProjects] = useState<Set<string>>(new Set());
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false);

  const toggleBulkEmployee = (id: string) => {
    setBulkSelectedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleBulkProject = (id: string) => {
    setBulkSelectedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAssign = async (mode: 'assign' | 'unassign') => {
    if (!effectiveCompanyId) return;
    const empIds = Array.from(bulkSelectedEmployees);
    const projIds = Array.from(bulkSelectedProjects);
    if (empIds.length === 0 || projIds.length === 0) return;
    setBulkAssignBusy(true);
    try {
      if (mode === 'assign') {
        const rows = empIds.flatMap(eid => projIds.map(pid => ({
          employee_id: eid,
          project_id: pid,
          company_id: effectiveCompanyId,
          receive_notifications: employeeProjectAssignments[eid]?.receiveNotifications ?? true,
        })));
        const { error } = await supabase
          .from('employee_project_assignments')
          .upsert(rows, { onConflict: 'employee_id,project_id' });
        if (error) throw error;
        setEmployeeProjectAssignments(prev => {
          const next = { ...prev };
          empIds.forEach(eid => {
            const cur = next[eid] || { projectIds: [], receiveNotifications: true };
            const merged = Array.from(new Set([...cur.projectIds, ...projIds]));
            next[eid] = { ...cur, projectIds: merged };
          });
          return next;
        });
        toast({ title: 'Assigned', description: `${empIds.length} personnel assigned to ${projIds.length} project${projIds.length === 1 ? '' : 's'}.` });
      } else {
        const { error } = await supabase
          .from('employee_project_assignments')
          .delete()
          .in('employee_id', empIds)
          .in('project_id', projIds)
          .eq('company_id', effectiveCompanyId);
        if (error) throw error;
        setEmployeeProjectAssignments(prev => {
          const next = { ...prev };
          empIds.forEach(eid => {
            const cur = next[eid] || { projectIds: [], receiveNotifications: true };
            next[eid] = { ...cur, projectIds: cur.projectIds.filter(pid => !projIds.includes(pid)) };
          });
          return next;
        });
        toast({ title: 'Unassigned', description: `${empIds.length} personnel removed from ${projIds.length} project${projIds.length === 1 ? '' : 's'}.` });
      }
      setBulkSelectedEmployees(new Set());
      setBulkSelectedProjects(new Set());
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to update assignments', variant: 'destructive' });
    } finally {
      setBulkAssignBusy(false);
    }
  };


  const renderEmployeeEditForm = () => (
                    <div className="p-4 border border-border rounded-lg space-y-4">
                      {/* Profile Picture (edit mode only) */}
                      {editingEmployee && (
                        <div className="flex items-center gap-3">
                          {employeePhotoUrl ? (
                            <img src={employeePhotoUrl} alt="Employee" className="w-12 h-12 rounded-full object-cover border border-border" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold border border-border">
                              {employeeName ? employeeName.substring(0, 2).toUpperCase() : 'NA'}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => employeeFileInputRef.current?.click()} disabled={isUploadingEmpPhoto}>
                              {isUploadingEmpPhoto ? 'Uploading...' : employeePhotoUrl ? 'Change Photo' : 'Add Photo'}
                            </Button>
                            {employeePhotoUrl && (
                              <Button variant="ghost" size="sm" onClick={handleRemoveEmployeePhoto}>Remove</Button>
                            )}
                          </div>
                          <input ref={employeeFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleEmployeePhotoUpload} />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="employeeName">Name *</Label>
                          <Input
                            id="employeeName"
                            value={employeeName}
                            onChange={(e) => setEmployeeName(e.target.value)}
                            placeholder="Full name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="employeeJobTitle">Job Title</Label>
                          <Input
                            id="employeeJobTitle"
                            value={employeeJobTitle}
                            onChange={(e) => setEmployeeJobTitle(e.target.value)}
                            placeholder="e.g. Project Manager"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="employeeEmail">Email</Label>
                          <Input
                            id="employeeEmail"
                            type="email"
                            required
                            value={employeeEmail}
                            onChange={(e) => setEmployeeEmail(e.target.value)}
                            placeholder="email@company.com"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="employeePhone">Phone</Label>
                          <Input
                            id="employeePhone"
                            type="tel"
                            value={employeePhone}
                            onChange={(e) => setEmployeePhone(e.target.value)}
                            placeholder="(555) 123-4567"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employeeIdValue">
                          Employee ID <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Input
                          id="employeeIdValue"
                          value={employeeIdValue}
                          onChange={(e) => setEmployeeIdValue(e.target.value)}
                          placeholder="e.g. EMP-1234"
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional payroll/HR identifier. Shown on timesheet exports and employee profiles only.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employeePermission">Permission Level</Label>
                        {companyIsGuest && (
                          <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md p-2">
                            Because this isn't a full company account, every user automatically has Main Company Account Holder permissions. You can adjust and control permissions after upgrading to a full company account.
                          </p>
                        )}
                        <Select
                          value={companyIsGuest ? 'account_holder' : selectedPermission}
                          onValueChange={(value) => setSelectedPermission(value as PermissionLevel)}
                          disabled={!canManagePermissions || companyIsGuest}
                        >
                          <SelectTrigger
                            id="employeePermission"
                            className={(!canManagePermissions || companyIsGuest) ? "opacity-50 cursor-not-allowed" : ""}
                          >
                            <SelectValue placeholder="Select permission level" />
                          </SelectTrigger>
                          <SelectContent>
                            {VISIBLE_PERMISSIONS.map((level) => (
                              <SelectItem
                                key={level}
                                value={level}
                                disabled={level === 'account_holder' && !isMOA && !isAccountHolder}
                              >
                                {PERMISSION_DESCRIPTIONS[level].title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {PERMISSION_DESCRIPTIONS[companyIsGuest ? 'account_holder' : selectedPermission]?.description}
                          {!canManagePermissions && !companyIsGuest && " (Requires account holder or MOA permissions)"}
                        </p>
                      </div>
                      {/* Assign to Projects - for editing employees */}
                      {editingEmployee && canAssignProjects && companyProjects.length > 0 && (
                        <div className="space-y-2 border border-border rounded-lg p-3">
                          <button
                            type="button"
                            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => toggleExpandEmployee(editingEmployee.id)}
                          >
                            {expandedEmployeeIds.includes(editingEmployee.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Assign to Projects ({(employeeProjectAssignments[editingEmployee.id]?.projectIds || []).length})
                          </button>

                          {expandedEmployeeIds.includes(editingEmployee.id) && (
                            <div className="mt-2 space-y-3 pl-4">
                              <div className="space-y-2">
                                {companyProjects.map((proj) => {
                                  const isAssigned = (employeeProjectAssignments[editingEmployee.id]?.projectIds || []).includes(proj.id);
                                  return (
                                    <div key={proj.id} className="flex items-center gap-2">
                                      <Checkbox
                                        id={`emp-proj-${editingEmployee.id}-${proj.id}`}
                                        checked={isAssigned}
                                        onCheckedChange={() => handleToggleEmployeeProjectAssignment(editingEmployee.id, proj.id, isAssigned)}
                                      />
                                      <Label
                                        htmlFor={`emp-proj-${editingEmployee.id}-${proj.id}`}
                                        className="text-sm cursor-pointer"
                                      >
                                        {proj.name}
                                      </Label>
                                    </div>
                                  );
                                })}
                              </div>

                              {(employeeProjectAssignments[editingEmployee.id]?.projectIds || []).length > 0 && (
                                <div className="flex items-center gap-3 p-2 bg-background rounded border border-border">
                                  <Switch
                                    id={`emp-notif-${editingEmployee.id}`}
                                    checked={employeeProjectAssignments[editingEmployee.id]?.receiveNotifications ?? true}
                                    onCheckedChange={(checked) => handleToggleEmployeeNotifications(editingEmployee.id, checked)}
                                  />
                                  <Label htmlFor={`emp-notif-${editingEmployee.id}`} className="text-xs cursor-pointer">
                                    Receive project correspondence (Emails, Push Notifications and Messages)?
                                  </Label>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Password field - only show when email is provided */}
                      {employeeEmail && canManagePermissions && !editingEmployee && (
                        <div className="space-y-2">
                          <Label htmlFor="employeePassword">Password (optional)</Label>
                          <Input
                            id="employeePassword"
                            type="password"
                            value={employeePassword}
                            onChange={(e) => setEmployeePassword(e.target.value)}
                            placeholder="Set initial password for employee"
                          />
                          <p className="text-xs text-muted-foreground">
                            If set, the employee can log in with this password. They'll be prompted to change it on first login.
                          </p>
                        </div>
                      )}
                      {/* Never logged in warning */}
                      {editingEmployee?.linked_user_id && neverLoggedIn && (
                        <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-md p-3 text-sm font-medium">
                          ⚠️ This user has never logged in before.
                        </div>
                      )}
                      {/* Reset password field - only show when editing a linked employee */}
                      {editingEmployee?.linked_user_id && canManagePermissions && (
                        <div className="space-y-2">
                          <Label htmlFor="resetPassword">Reset Password</Label>
                          <div className="flex gap-2">
                            <Input
                              id="resetPassword"
                              type="password"
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              placeholder="New password for this employee"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!resetPasswordValue || resetPasswordValue.length < 6 || isLoading}
                              onClick={async () => {
                                setIsLoading(true);
                                try {
                                  const { error } = await supabase.functions.invoke('create-employee-user', {
                                    body: {
                                      email: '',
                                      name: '',
                                      companyId: effectiveCompanyId,
                                      permissionLevel: '',
                                      employeeId: '',
                                      resetPassword: resetPasswordValue,
                                      targetUserId: editingEmployee.linked_user_id,
                                    }
                                  });
                                  if (error) throw error;
                                  toast({ title: 'Password Reset', description: 'Employee will be prompted to change password on next login.' });
                                  setResetPasswordValue('');
                                } catch (err: any) {
                                  toast({ title: 'Error', description: err.message, variant: 'destructive' });
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                            >
                              Reset
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Min 6 characters. Employee will be prompted to change it on next login.
                          </p>
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={resetForm}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={editingEmployee ? handleUpdateEmployee : handleCreateEmployee}
                          disabled={!employeeName || isLoading}
                        >
                          {isLoading ? 'Saving...' : editingEmployee ? 'Update' : 'Create'}
                        </Button>
                      </div>

                      {/* Bulk Import Section */}
                      {!editingEmployee && (
                        <div className="border-t border-border pt-3 mt-3">
                          <Label className="text-sm font-medium flex items-center gap-2 mb-2">
                            <Upload className="h-4 w-4" />
                            Bulk Import from File
                          </Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
                              className="hidden"
                              id="bulk-import-file"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleBulkFileUpload(f);
                                e.target.value = '';
                              }}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              disabled={bulkParsing}
                              onClick={() => document.getElementById('bulk-import-file')?.click()}
                            >
                              {bulkParsing ? (
                                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Parsing...</>
                              ) : (
                                <><FileSpreadsheet className="h-3 w-3 mr-1" /> Excel / CSV</>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              disabled={bulkParsing}
                              onClick={() => document.getElementById('bulk-import-file')?.click()}
                            >
                              {bulkParsing ? (
                                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Parsing...</>
                              ) : (
                                <><Image className="h-3 w-3 mr-1" /> Image (OCR)</>
                              )}
                            </Button>
                          </div>
                          <a
                            href={bulkImportTemplate.url}
                            download="SSAA_Bulk_Import_Template.xlsx"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            Download template (Excel)
                          </a>
                          <p className="text-xs text-muted-foreground mt-1">
                            Upload an Excel/CSV file or image with employee names, job titles, phones, and emails. Download the template above to get the correct column format.
                          </p>

                        </div>
                      )}
                    </div>
  );



  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl h-[90vh] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {onBack && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mr-1"
                  onClick={() => {
                    onOpenChange(false);
                    onBack();
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <Users className="h-5 w-5" />
              {t('profiles.manageTeamProfiles')}
            </DialogTitle>
            <DialogDescription>
              {t('profiles.manageTeamDesc')}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 pb-4">

              {/* Permission Level Descriptions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Permission Levels</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {VISIBLE_PERMISSIONS.map((level) => (
                      <div key={level} className="p-3 bg-muted/50 rounded-lg">
                        <p className="font-medium text-sm">{PERMISSION_DESCRIPTIONS[level].title}</p>
                        <p className="text-xs text-muted-foreground">{PERMISSION_DESCRIPTIONS[level].description}</p>
                      </div>
                    ))}
                </CardContent>
              </Card>

              {/* Employees Section */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Employee Profiles
                    </CardTitle>
                    <CardDescription>
                      Pre-create profiles that link when users sign up
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setIsCreating(true)} disabled={isCreating || !!editingEmployee}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isCreating && !editingEmployee && renderEmployeeEditForm()}

                  {/* Bulk Import Review */}
                  {showBulkImport && bulkEmployees.length > 0 && (
                    <div className="p-4 border border-primary/30 rounded-lg space-y-3 bg-primary/5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">
                          Review Imported Employees ({bulkEmployees.filter(e => e.approved).length} / {bulkEmployees.length} approved)
                        </Label>
                        <Button variant="ghost" size="sm" onClick={() => { setBulkEmployees([]); setShowBulkImport(false); }}>
                          Cancel
                        </Button>
                      </div>
                      <ScrollArea className="max-h-60">
                        <div className="space-y-2 pr-2">
                          {bulkEmployees.map((emp, idx) => (
                            <div key={idx} className={cn("p-2 rounded border text-xs space-y-1", emp.approved ? "bg-background" : "bg-muted/50 opacity-60")}>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  checked={emp.approved}
                                  onCheckedChange={(checked) => {
                                    setBulkEmployees(prev => prev.map((e, i) => i === idx ? { ...e, approved: !!checked } : e));
                                  }}
                                  className="h-3.5 w-3.5"
                                />
                                <Input
                                  value={emp.name}
                                  onChange={(e) => setBulkEmployees(prev => prev.map((el, i) => i === idx ? { ...el, name: e.target.value } : el))}
                                  className="h-6 text-xs flex-1"
                                  placeholder="Name"
                                />
                                <Input
                                  value={emp.job_title || ''}
                                  onChange={(e) => setBulkEmployees(prev => prev.map((el, i) => i === idx ? { ...el, job_title: e.target.value || null } : el))}
                                  className="h-6 text-xs w-28"
                                  placeholder="Job Title"
                                />
                              </div>
                              <div className="flex items-center gap-2 pl-6">
                                <Input
                                  type="email"
                                  required={emp.approved}
                                  value={emp.email || ''}
                                  onChange={(e) => setBulkEmployees(prev => prev.map((el, i) => i === idx ? { ...el, email: e.target.value || null } : el))}
                                  className="h-6 text-xs flex-1"
                                  placeholder="Email"
                                />
                                <Input
                                  value={emp.phone || ''}
                                  onChange={(e) => setBulkEmployees(prev => prev.map((el, i) => i === idx ? { ...el, phone: e.target.value || null } : el))}
                                  className="h-6 text-xs w-28"
                                  placeholder="Phone"
                                />
                                <Input
                                  value={emp.employee_id || ''}
                                  onChange={(e) => setBulkEmployees(prev => prev.map((el, i) => i === idx ? { ...el, employee_id: e.target.value || null } : el))}
                                  className="h-6 text-xs w-24"
                                  placeholder="Employee ID"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <Button
                        className="w-full"
                        size="sm"
                        disabled={bulkCreating || bulkEmployees.filter(e => e.approved && e.name && e.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim())).length === 0}
                        onClick={handleBulkCreate}
                      >
                        {bulkCreating ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Creating...</>
                        ) : (
                          <>Create All Approved ({bulkEmployees.filter(e => e.approved && e.name).length})</>
                        )}
                      </Button>
                    </div>
                  )}

                  {employees.map((employee) => {
                    const linkedRole = employee.linked_user_id 
                      ? userRoles.find(r => r.user_id === employee.linked_user_id)
                      : null;

                    return (
                    <Fragment key={employee.id}>
                    <div
                      className="flex items-start justify-between gap-2 p-3 bg-muted/50 rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium break-words">{employee.name}</p>
                        </div>
                        <p className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                          {employee.job_title || 'No title'} • {employee.email || 'No email'}
                        </p>
                        {linkedRole?.profile && (
                          <p className="text-xs text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
                            Account: {linkedRole.profile.full_name || linkedRole.profile.email} • {PERMISSION_DESCRIPTIONS[linkedRole.permission_level]?.title || linkedRole.permission_level}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 self-start">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(employee)}
                          disabled={isCreating || !!editingEmployee}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEmployeeToDelete(employee)}
                          disabled={isLoading}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {editingEmployee?.id === employee.id && (
                      <div className="pl-3">{renderEmployeeEditForm()}</div>
                    )}
                    </Fragment>
                    );
                  })}


                  {employees.length === 0 && !isCreating && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No employee profiles yet. Create one to pre-configure team members.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Quickly Assign Personnel to Projects */}
              {canAssignProjects && companyProjects.length > 0 && employees.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Link className="h-4 w-4" />
                      Quickly Assign Personnel to Projects
                    </CardTitle>
                    <CardDescription>
                      Select personnel and projects, then assign or unassign in bulk.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Personnel dropdown */}
                      <div className="space-y-1">
                        <Label className="text-xs">Personnel</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-between h-9 text-sm font-normal">
                              <span className="truncate">
                                {bulkSelectedEmployees.size === 0
                                  ? 'Select personnel...'
                                  : `${bulkSelectedEmployees.size} selected`}
                              </span>
                              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => setBulkSelectedEmployees(new Set(employees.map(e => e.id)))}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:underline"
                                onClick={() => setBulkSelectedEmployees(new Set())}
                              >
                                Clear
                              </button>
                            </div>
                            <ScrollArea className="max-h-64">
                              <div className="p-1">
                                {employees.map(emp => {
                                  const checked = bulkSelectedEmployees.has(emp.id);
                                  return (
                                    <label
                                      key={emp.id}
                                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={() => toggleBulkEmployee(emp.id)}
                                      />
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-sm truncate">{emp.name}</span>
                                        {emp.job_title && (
                                          <span className="text-[10px] text-muted-foreground truncate">{emp.job_title}</span>
                                        )}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Projects dropdown */}
                      <div className="space-y-1">
                        <Label className="text-xs">Projects</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-between h-9 text-sm font-normal">
                              <span className="truncate">
                                {bulkSelectedProjects.size === 0
                                  ? 'Select projects...'
                                  : `${bulkSelectedProjects.size} selected`}
                              </span>
                              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => setBulkSelectedProjects(new Set(companyProjects.map(p => p.id)))}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:underline"
                                onClick={() => setBulkSelectedProjects(new Set())}
                              >
                                Clear
                              </button>
                            </div>
                            <ScrollArea className="max-h-64">
                              <div className="p-1">
                                {companyProjects.map(proj => {
                                  const checked = bulkSelectedProjects.has(proj.id);
                                  const assignedCount = Array.from(bulkSelectedEmployees).filter(eid =>
                                    (employeeProjectAssignments[eid]?.projectIds || []).includes(proj.id)
                                  ).length;
                                  const totalSelected = bulkSelectedEmployees.size;
                                  let status = '';
                                  if (totalSelected > 0) {
                                    if (assignedCount === totalSelected) status = 'all assigned';
                                    else if (assignedCount === 0) status = 'none assigned';
                                    else status = `${assignedCount}/${totalSelected} assigned`;
                                  }
                                  return (
                                    <label
                                      key={proj.id}
                                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        onCheckedChange={() => toggleBulkProject(proj.id)}
                                      />
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-sm truncate">{proj.name}</span>
                                        {status && (
                                          <span className="text-[10px] text-muted-foreground">{status}</span>
                                        )}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkAssignBusy || bulkSelectedEmployees.size === 0 || bulkSelectedProjects.size === 0}
                        onClick={() => handleBulkAssign('unassign')}
                      >
                        Unassign from selected projects
                      </Button>
                      <Button
                        size="sm"
                        disabled={bulkAssignBusy || bulkSelectedEmployees.size === 0 || bulkSelectedProjects.size === 0}
                        onClick={() => handleBulkAssign('assign')}
                      >
                        {bulkAssignBusy ? 'Saving...' : 'Assign to selected projects'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Pending Join Requests Section - only for account_holder/full/MOA */}

              {(isMOA || isAccountHolder || (companyType !== 'gc' && canManagePermissions)) && pendingJoinRequests.length > 0 && (
                <Card ref={pendingRequestsRef} className="border-destructive/30 ring-2 ring-destructive/30">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-destructive">
                      <Users className="h-4 w-4" />
                      Pending Join Requests ({pendingJoinRequests.length})
                    </CardTitle>
                    <CardDescription>
                      These users are requesting to join your company
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {pendingJoinRequests.map((req) => {
                      const isMerge = req.metadata?.merge === true;
                      const guestName = req.metadata?.source_guest_company_name;
                      return (
                        <div key={req.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
                          <div>
                            <p className="font-medium text-sm">{req.user_name || req.user_email}</p>
                            <p className="text-xs text-muted-foreground">{req.user_email}</p>
                            <p className="text-xs text-muted-foreground">
                              Requested {new Date(req.created_at).toLocaleDateString()}
                            </p>
                            {isMerge && (
                              <div className="mt-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                                Guest Account merge{guestName ? ` — ${guestName}` : ''}
                              </div>
                            )}
                            {isMerge && (
                              <p className="text-xs text-muted-foreground mt-1">
                                On approval, this user's Guest Account projects and subcontractor
                                connections will be carried over to your company.
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApproveJoinRequest(req.id, req.user_id, req.user_email)}
                              disabled={isLoading}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDenyJoinRequest(req.id, req.user_email)}
                              disabled={isLoading}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Deny
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Download Timesheets Section — Subcontractor only */}
              {companyType === 'sub' && (
                <TimesheetDownloadCard employees={employees} effectiveCompanyId={effectiveCompanyId} />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Transfer Account Holder Confirmation Dialog */}
      <AlertDialog open={!!transferTarget} onOpenChange={(open) => !open && setTransferTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer Main Company Account Holder Status?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to give Main Company Account Holder status to {transferTarget?.name}? This action cannot be undone unless you reach out to the SSAA team. You will still remain a Main Company Account Holder and {transferTarget?.name} will gain full billing and company control.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTransferAccountHolder}>
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Employee Deletion Confirmation Dialog */}
      <AlertDialog open={!!employeeToDelete} onOpenChange={(open) => !open && setEmployeeToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('employee.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('employee.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => employeeToDelete && handleDeleteEmployee(employeeToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PlanLimitDialog
        open={employeeLimitOpen}
        onOpenChange={setEmployeeLimitOpen}
        kind="employee"
        planName={employeeUsage?.plan_display_name}
        current={employeeUsage?.employee_count}
        max={employeeUsage?.max_users}
      />
    </>
  );
};

export default ProfilesModal;
