import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { LogOut, Building2, User, Settings, X, Users, Check, Mail, CreditCard, UserCheck, UserCog, Shield, MessageSquare, MoreVertical, Calendar as CalendarIcon, Link2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { useConversations } from '@/hooks/useMessaging';
import { useLanguage } from '@/contexts/LanguageContext';
import ManageProfileModal from './ManageProfileModal';
import ManageCompanyModal from './ManageCompanyModal';
import ManageSSAAModal from './ManageSSAAModal';
import { usePendingCancellationCount } from '@/hooks/usePendingCancellationCount';
import { useFirstClickTooltip } from '@/components/onboarding/useFirstClickTooltip';
import { TOUR_COPY } from '@/components/onboarding/tourSteps';
import FirstClickTooltip from '@/components/onboarding/FirstClickTooltip';
import NotificationBell from './NotificationBell';

// Notification dot component
const NotificationDot = () => (
  <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive border-2 border-primary" />
);

interface Company {
  id: string;
  name: string;
  company_type: 'gc' | 'sub';
  is_guest?: boolean;
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

interface DashboardHeaderProps {
  viewMode: 'moa' | 'gc' | 'sub';
  setViewMode: (mode: 'moa' | 'gc' | 'sub') => void;
  impersonatedCompany: Company | null;
  setImpersonatedCompany: (company: Company | null) => void;
  companies: Company[];
  impersonatedUser?: ImpersonatedUser | null;
  onImpersonateUser?: (user: ImpersonatedUser | null) => void;
  onEmployeesChanged?: () => void;
  onProjectsChanged?: () => void;
  matrixViewToggle?: 'monthly' | 'weekly';
  onMatrixViewToggleChange?: (value: 'monthly' | 'weekly') => void;
  selectedProject?: string;
  visibleProjectIds?: string[];
  connectedContractorsCount?: number;
  onOpenConnectedContractors?: () => void;
}

const DashboardHeader = ({
  viewMode,
  setViewMode,
  impersonatedCompany,
  setImpersonatedCompany,
  companies,
  impersonatedUser,
  onImpersonateUser,
  onEmployeesChanged,
  onProjectsChanged,
  matrixViewToggle,
  onMatrixViewToggleChange,
  selectedProject,
  visibleProjectIds,
  connectedContractorsCount = 0,
  onOpenConnectedContractors,
}: DashboardHeaderProps) => {
  const { profile, signOut, isMOA, isAccountHolder, permissionLevel, user, isOMO, isReadOnlyOperator, isMainOperator, rolesLoading, userRole, hasPartialOrHigher } = useAuth();
  const navigate = useNavigate();
  const { totalUnread: messagesUnreadTotal } = useConversations(impersonatedUser?.user_id ?? null);
  const { t } = useLanguage();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const msgTip = useFirstClickTooltip('messages');
  const profTip = useFirstClickTooltip('manage_profile');
  const ccTip = useFirstClickTooltip('connected_contractors_dashboard');
  const companyTip = useFirstClickTooltip('tour_company_account');
  const toggleTip = useFirstClickTooltip('tour_calendar_toggle');
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<ImpersonatedUser[]>([]);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [moaTabOpen, setMoaTabOpen] = useState(false);
  const [moaTabOpenMobile, setMoaTabOpenMobile] = useState(false);
  const [ssaaModalOpen, setSSAAModalOpen] = useState(false);
  const [guestGCTabOpen, setGuestGCTabOpen] = useState(false);
  const [guestGCTabOpenMobile, setGuestGCTabOpenMobile] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [pendingJoinCount, setPendingJoinCount] = useState(0);
  const { count: pendingCancellationCount } = usePendingCancellationCount();

  // Fetch pending join requests count for admin users
  const fetchPendingJoinRequests = React.useCallback(async () => {
    if (!profile?.company_id || !user) return;

    // Determine company type to apply GC-specific gating (only account_holder approves for GC)
    const { data: companyRow } = await supabase
      .from('companies')
      .select('company_type')
      .eq('id', profile.company_id)
      .maybeSingle();
    const isGC = companyRow?.company_type === 'gc';

    if (!isMOA) {
      if (isGC) {
        if (!isAccountHolder) {
          setPendingJoinCount(0);
          return;
        }
      } else if (!isAccountHolder) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('permission_level')
          .eq('user_id', user.id)
          .eq('company_id', profile.company_id)
          .single();

        if (!roleData || (roleData.permission_level !== 'full' && roleData.permission_level !== 'account_holder')) {
          setPendingJoinCount(0);
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from('company_join_requests')
      .select('id')
      .eq('company_id', profile.company_id)
      .eq('status', 'pending');

    if (!error && data) {
      setPendingJoinCount(data.length);
    }
  }, [profile?.company_id, user, isAccountHolder, isMOA]);

  useEffect(() => {
    fetchPendingJoinRequests();
  }, [fetchPendingJoinRequests]);

  // Realtime: refetch the pending count whenever join requests change for this company
  useEffect(() => {
    if (!profile?.company_id) return;
    const channel = supabase
      .channel(`join-requests-${profile.company_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'company_join_requests',
          filter: `company_id=eq.${profile.company_id}`,
        },
        () => {
          fetchPendingJoinRequests();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.company_id, fetchPendingJoinRequests]);

  // Fetch all users for MOA impersonation
  useEffect(() => {
    const fetchAllUsers = async () => {
      if (!isMOA) return;

      const [{ data: profiles, error }, { data: roles, error: rolesErr }] = await Promise.all([
        supabase.from('profiles').select('id, user_id, full_name, email, company_id'),
        supabase.from('user_roles').select('user_id, company_id, permission_level'),
      ]);

      if (error) {
        console.error('Error fetching profiles:', error);
        return;
      }
      if (rolesErr) {
        console.error('Error fetching user_roles:', rolesErr);
      }

      const roleMap = new Map<string, PermissionLevel>();
      (roles || []).forEach(r => {
        if (r.user_id && r.company_id) {
          roleMap.set(`${r.user_id}:${r.company_id}`, r.permission_level as PermissionLevel);
        }
      });

      const usersWithCompanies: ImpersonatedUser[] = (profiles || []).map(p => {
        const company = companies.find(c => c.id === p.company_id);
        return {
          id: p.id,
          user_id: p.user_id,
          full_name: p.full_name,
          email: p.email,
          company_id: p.company_id,
          company_name: company?.name || null,
          company_type: company?.company_type || null,
          permission_level: p.company_id ? (roleMap.get(`${p.user_id}:${p.company_id}`) || null) : null,
        };
      });

      setAllUsers(usersWithCompanies);
    };

    fetchAllUsers();
  }, [isMOA, companies]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleExitImpersonation = () => {
    if (onImpersonateUser) {
      onImpersonateUser(null);
    }
    setMoaTabOpen(true);
    setMoaTabOpenMobile(true);
  };

  const handleSelectUser = (selectedUser: ImpersonatedUser) => {
    if (onImpersonateUser) {
      onImpersonateUser(selectedUser);
      if (selectedUser.company_type) {
        setViewMode(selectedUser.company_type);
      }
      if (selectedUser.company_id && selectedUser.company_name && selectedUser.company_type) {
        setImpersonatedCompany({
          id: selectedUser.company_id,
          name: selectedUser.company_name,
          company_type: selectedUser.company_type
        });
      }
    }
    setUserSearchOpen(false);
    setMoaTabOpen(false);
    setMoaTabOpenMobile(false);
    setGuestGCTabOpen(false);
    setGuestGCTabOpenMobile(false);
  };

  const impersonatePrimaryHolderForCompany = async (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    try {
      const { data, error } = await supabase
        .rpc('get_primary_account_holder_for_company', { p_company_id: companyId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.user_id) {
        handleSelectUser({
          id: row.profile_id,
          user_id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          company_id: row.company_id,
          company_name: row.company_name,
          company_type: row.company_type,
          permission_level: (row as { permission_level?: PermissionLevel | null }).permission_level ?? null,
        });
        return;
      }
    } catch (e) {
      console.error('Failed to load primary account holder', e);
    }
    // Fallback: just set the company context so the operator can still browse.
    if (company) {
      setImpersonatedCompany({
        id: company.id,
        name: company.name,
        company_type: company.company_type,
      });
    }
    setMoaTabOpen(false);
    setMoaTabOpenMobile(false);
    setGuestGCTabOpen(false);
    setGuestGCTabOpenMobile(false);
  };

  const filteredCompanies = guestMode
    ? companies.filter(c => c.company_type === 'gc' && (c as any).is_guest)
    : companies.filter(c => {
        if (viewMode === 'gc') return c.company_type === 'gc' && !(c as any).is_guest;
        return c.company_type === 'sub';
      });

  // A company deleted while selected leaves a stale id behind; Radix then tries to
  // scroll to a non-existent item on open (jitter / can't reach the bottom).
  const selectedCompanyId = filteredCompanies.some(c => c.id === impersonatedCompany?.id)
    ? (impersonatedCompany?.id as string)
    : '';

  // Disambiguate companies that share a display name.
  const duplicateCompanyNames = (() => {
    const counts = new Map<string, number>();
    filteredCompanies.forEach(c => counts.set(c.name, (counts.get(c.name) || 0) + 1));
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([n]) => n));
  })();
  const companyLabel = (c: { id: string; name: string }) =>
    duplicateCompanyNames.has(c.name) ? `${c.name} (${c.id.slice(0, 6)})` : c.name;

  const guestGCCompanies = companies.filter(c => c.company_type === 'gc' && (c as any).is_guest);

  // While roles are still hydrating after login/onboarding, optimistically show
  // the management button to any user who has a company so account holders and
  // full admins never see it disappear due to a transient unresolved role state.
  // This handles the race where profile.company_id arrives before the matching
  // user_roles row in AuthContext (the realtime subscription on user_roles will
  // then reconcile to the precise permission level).
  const authHydrating = rolesLoading || (!!profile?.company_id && !userRole && !isMOA);
  const canManageCompany =
    isAccountHolder ||
    isMOA ||
    permissionLevel === 'full' ||
    (authHydrating && !!profile?.company_id);

  return (
    <>
      <header className="bg-primary text-primary-foreground shadow-md overflow-hidden">
        <div className="px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl lg:text-2xl font-bold">{isMOA ? 'SSAA Operator Dashboard' : 'SSAA'}</h1>
              
              {/* Desktop MOA tabs */}
              {isMOA && (
                <div className="hidden md:flex items-center gap-2 bg-primary-foreground/10 rounded-lg p-1">
                  <button
                    onClick={() => setSSAAModalOpen(true)}
                    className="relative px-4 py-1.5 rounded-md text-sm font-medium transition-colors text-primary-foreground/80 hover:text-primary-foreground flex items-center gap-2 whitespace-nowrap"
                  >
                    <Shield className="h-4 w-4" />
                    Manage SSAA
                    {pendingCancellationCount > 0 && <NotificationDot />}
                  </button>

                  <Popover open={moaTabOpen} onOpenChange={setMoaTabOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                          moaTabOpen 
                            ? 'bg-primary-foreground text-primary' 
                            : 'text-primary-foreground/80 hover:text-primary-foreground'
                        }`}
                      >
                        <Users className="h-4 w-4" />
                        {t('header.moa')}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <Command>
                        <CommandInput placeholder={t('header.searchUsers')} />
                        <CommandList>
                          <CommandEmpty>{t('header.noUsersFound')}</CommandEmpty>
                          <CommandGroup heading={t('header.allUsers')}>
                            {allUsers.map((u) => (
                              <CommandItem
                                key={u.id}
                                value={`${u.full_name || ''} ${u.email}`}
                                onSelect={() => handleSelectUser(u)}
                                className="cursor-pointer"
                              >
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    {u.full_name || u.email}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {u.email} {u.company_name ? `• ${u.company_name}` : `• ${t('header.noCompany')}`}
                                    {u.company_type && ` (${u.company_type.toUpperCase()})`}
                                  </span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {(['sub', 'gc'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setViewMode(mode);
                        if (onImpersonateUser) onImpersonateUser(null);
                        setImpersonatedCompany(null);
                        setGuestMode(false);
                        setMoaTabOpen(false);
                        setGuestGCTabOpen(false);
                      }}
                      className={`relative px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                        viewMode === mode && !impersonatedUser && !guestMode
                          ? 'bg-primary-foreground text-primary' 
                          : 'text-primary-foreground/80 hover:text-primary-foreground'
                      }`}
                    >
                      {mode === 'gc' ? t('header.generalContractor') : t('header.subcontractor')}
                    </button>
                  ))}

                  <button
                    onClick={() => {
                      setViewMode('gc');
                      if (onImpersonateUser) onImpersonateUser(null);
                      setImpersonatedCompany(null);
                      setGuestMode(true);
                      setMoaTabOpen(false);
                    }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                      guestMode && !impersonatedUser
                        ? 'bg-primary-foreground text-primary'
                        : 'text-primary-foreground/80 hover:text-primary-foreground'
                    }`}
                  >
                    <UserCheck className="h-4 w-4" />
                    {t('header.guestGCs')}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 lg:gap-4">
              {/* Weekly/Monthly toggle - available on all project views */}
              {matrixViewToggle && onMatrixViewToggleChange && (
                <div
                  data-tour="calendar-view-toggle"
                  ref={(el) => toggleTip.setAnchor(el)}
                  onClickCapture={() => toggleTip.trigger()}
                  className="hidden lg:flex items-center gap-1 bg-muted rounded-lg p-0.5"
                >
                  <button
                    onClick={() => onMatrixViewToggleChange('monthly')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      matrixViewToggle === 'monthly' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => onMatrixViewToggleChange('weekly')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      matrixViewToggle === 'weekly' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Weekly
                  </button>
                </div>
              )}

              {/* Connected Contractors ribbon tab removed — access lives in Manage My Company Account */}

              {/* User impersonation banner */}
              {isMOA && impersonatedUser && (
                <div className="flex items-center gap-2 bg-destructive/20 border border-destructive/40 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-medium text-destructive-foreground">
                    {t('header.viewingAs')} {impersonatedUser.full_name || impersonatedUser.email}
                    {impersonatedUser.company_name && ` (${impersonatedUser.company_name})`}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleExitImpersonation}
                    className="h-6 w-6 text-destructive hover:bg-destructive/20"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {isMOA && viewMode !== 'moa' && !impersonatedUser && (
                <Select 
                  value={selectedCompanyId} 
                  onValueChange={(id) => { void impersonatePrimaryHolderForCompany(id); }}
                >
                  <SelectTrigger className="w-48 bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground">
                    <Building2 className="w-4 h-4 mr-2" />
                    <SelectValue placeholder={t('header.selectCompany')} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCompanies.map((company) => (
                      <SelectItem 
                        key={company.id} 
                        value={company.id}
                      >
                        {companyLabel(company)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}


              {canManageCompany && (
                <Button
                  ref={(el) => companyTip.setAnchor(el)}
                  data-tour="manage-company"
                  variant="ghost"
                  size="sm"
                  onClick={() => { companyTip.trigger(); setCompanyModalOpen(true); }}
                  className="text-primary-foreground hover:bg-primary-foreground/10 hidden lg:flex relative"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  {t('header.manageCompanyAccount')}
                  {pendingJoinCount > 0 && <NotificationDot />}
                </Button>
              )}

              {/* Mobile overflow menu - exposes Manage Company, view toggle, MOA company select on small screens */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary-foreground hover:bg-primary-foreground/10 lg:hidden relative"
                  >
                    <MoreVertical className="h-5 w-5" />
                    {pendingJoinCount > 0 && canManageCompany && <NotificationDot />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {matrixViewToggle && onMatrixViewToggleChange && (
                    <>
                      <DropdownMenuLabel>Calendar view</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onMatrixViewToggleChange('monthly')}>
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        Monthly {matrixViewToggle === 'monthly' && <Check className="h-4 w-4 ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onMatrixViewToggleChange('weekly')}>
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        Weekly {matrixViewToggle === 'weekly' && <Check className="h-4 w-4 ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {/* Connected Contractors menu entry removed — access lives in Manage My Company Account */}

                  {canManageCompany && (
                    <DropdownMenuItem onClick={() => setCompanyModalOpen(true)}>
                      <Settings className="h-4 w-4 mr-2" />
                      {t('header.manageCompanyAccount')}
                      {pendingJoinCount > 0 && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />
                      )}
                    </DropdownMenuItem>
                  )}
                  {isMOA && viewMode !== 'moa' && !impersonatedUser && filteredCompanies.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Impersonate company</DropdownMenuLabel>
                      <div className="px-2 pb-2">
                        <Select
                          value={selectedCompanyId}
                          onValueChange={(id) => { void impersonatePrimaryHolderForCompany(id); }}
                        >
                          <SelectTrigger>
                            <Building2 className="w-4 h-4 mr-2" />
                            <SelectValue placeholder={t('header.selectCompany')} />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredCompanies.map((company) => (
                              <SelectItem
                                key={company.id}
                                value={company.id}
                              >
                                {companyLabel(company)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <NotificationBell userId={impersonatedUser?.user_id ?? user?.id} suppressReadReceipts={!!impersonatedUser} />

              <Button
                data-tour="messages-button"
                ref={(el) => msgTip.setAnchor(el)}
                variant="ghost"
                size="sm"
                onClick={() => { msgTip.trigger(); navigate('/messages'); }}
                className="text-primary-foreground hover:bg-primary-foreground/10 relative"
              >
                <MessageSquare className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">{t('header.messages') || 'Messages'}</span>
                {messagesUnreadTotal > 0 && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {messagesUnreadTotal > 99 ? '99+' : messagesUnreadTotal}
                  </span>
                )}
              </Button>

              <Button
                ref={(el) => profTip.setAnchor(el)}
                variant="ghost"
                size="sm"
                onClick={() => { profTip.trigger(); setProfileModalOpen(true); }}
                className="text-primary-foreground hover:bg-primary-foreground/10"
              >
                <User className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">{t('header.manageMyProfile')}</span>
              </Button>

              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleSignOut}
                className="text-primary-foreground hover:bg-primary-foreground/10"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Mobile MOA tabs */}
          {isMOA && (
            <div className="flex md:hidden overflow-x-auto w-full mt-2 gap-1 bg-primary-foreground/10 rounded-lg p-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
              <button
                onClick={() => setSSAAModalOpen(true)}
                className="relative flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors text-primary-foreground/80 hover:text-primary-foreground flex items-center gap-1 whitespace-nowrap"
              >
                <Shield className="h-4 w-4" />
                Manage SSAA
                {pendingCancellationCount > 0 && <NotificationDot />}
              </button>

              <Popover open={moaTabOpenMobile} onOpenChange={setMoaTabOpenMobile}>
                <PopoverTrigger asChild>
                  <button
                    className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                      moaTabOpenMobile 
                        ? 'bg-primary-foreground text-primary' 
                        : 'text-primary-foreground/80 hover:text-primary-foreground'
                    }`}
                  >
                    <Users className="h-4 w-4" />
                    {t('header.moa')}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('header.searchUsers')} />
                    <CommandList>
                      <CommandEmpty>{t('header.noUsersFound')}</CommandEmpty>
                      <CommandGroup heading={t('header.allUsers')}>
                        {allUsers.map((u) => (
                          <CommandItem
                            key={u.id}
                            value={`${u.full_name || ''} ${u.email}`}
                            onSelect={() => handleSelectUser(u)}
                            className="cursor-pointer"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{u.full_name || u.email}</span>
                              <span className="text-xs text-muted-foreground">
                                {u.email} {u.company_name ? `• ${u.company_name}` : `• ${t('header.noCompany')}`}
                                {u.company_type && ` (${u.company_type.toUpperCase()})`}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {(['sub', 'gc'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode);
                    if (onImpersonateUser) onImpersonateUser(null);
                    setImpersonatedCompany(null);
                    setGuestMode(false);
                    setMoaTabOpenMobile(false);
                    setGuestGCTabOpenMobile(false);
                  }}
                  className={`relative flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === mode && !impersonatedUser && !guestMode
                      ? 'bg-primary-foreground text-primary' 
                      : 'text-primary-foreground/80 hover:text-primary-foreground'
                  }`}
                >
                  {mode === 'gc' ? t('header.generalContractor') : t('header.subcontractor')}
                </button>
              ))}

              <button
                onClick={() => {
                  setViewMode('gc');
                  if (onImpersonateUser) onImpersonateUser(null);
                  setImpersonatedCompany(null);
                  setGuestMode(true);
                  setMoaTabOpenMobile(false);
                }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${
                  guestMode && !impersonatedUser
                    ? 'bg-primary-foreground text-primary'
                    : 'text-primary-foreground/80 hover:text-primary-foreground'
                }`}
              >
                <UserCheck className="h-4 w-4" />
                {t('header.guestGCs')}
              </button>
            </div>
          )}
        </div>
      </header>

      <ManageProfileModal open={profileModalOpen} onOpenChange={setProfileModalOpen} impersonatedUser={impersonatedUser} />
      <ManageCompanyModal
        open={companyModalOpen}
        onOpenChange={(open) => {
          setCompanyModalOpen(open);
          if (!open && onEmployeesChanged) {
            onEmployeesChanged();
          }
          if (!open && onProjectsChanged) {
            onProjectsChanged();
          }
        }}
        impersonatedUser={impersonatedUser}
        pendingJoinCount={pendingJoinCount}
        onJoinRequestsChanged={fetchPendingJoinRequests}
        onProjectsChanged={onProjectsChanged}
        visibleProjectIds={visibleProjectIds}
      />
      <ManageSSAAModal open={ssaaModalOpen} onOpenChange={setSSAAModalOpen} />
      {msgTip.show && <FirstClickTooltip anchor={msgTip.anchor} copy="Communicate directly with your team. Access project specific correspondence, direct messages, and group chats here." onDismiss={msgTip.dismiss} />}
      {profTip.show && <FirstClickTooltip anchor={profTip.anchor} copy="Update your personal details, profile photo, contact information, and change your password here." onDismiss={profTip.dismiss} />}
      {ccTip.show && <FirstClickTooltip anchor={ccTip.anchor} copy="Open the read-only viewer for a sub-of-sub you're connected with. See their roster and availability for this project, and use the toggle to share their availability onto your project schedule so General Contractors can book them." onDismiss={ccTip.dismiss} />}
      {companyTip.show && <FirstClickTooltip anchor={companyTip.anchor} copy={TOUR_COPY.tour_company_account.copy} onDismiss={companyTip.dismiss} />}
      {toggleTip.show && <FirstClickTooltip anchor={toggleTip.anchor} copy={TOUR_COPY.tour_calendar_toggle.copy} onDismiss={toggleTip.dismiss} />}
    </>
  );
};

export default DashboardHeader;
