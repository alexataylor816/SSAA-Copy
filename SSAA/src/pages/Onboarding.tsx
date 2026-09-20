import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Building2, CreditCard, CheckCircle, ArrowLeft, Users, FolderOpen, Check, UserCheck } from 'lucide-react';

interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  monthly_price: number;
  annual_price_per_month: number;
  max_projects: number;
  max_users: number;
  is_active: boolean;
  sort_order: number;
  free_period_months: number | null;
}

type CompanyType = 'gc' | 'sub';

const TRADES = [
  'Drywall', 'HVAC', 'Electrical', 'Sprinkler', 'Flooring', 'Security',
  'Masonry', 'Millworkers', 'Structural Steel', 'Plumbing', 'Roofing', 'Painting',
  'Carpentry', 'Concrete', 'Glass & Glazing', 'Insulation', 'Fire Protection',
  'Low Voltage Telecommunication Services', 'Building Automation & Controls',
  'Air Balancer',

  'Other'
];

interface Company {
  id: string;
  name: string;
  company_type: CompanyType;
}

const Onboarding = () => {
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [companyType, setCompanyType] = useState<CompanyType | ''>('');
  const [existingCompany, setExistingCompany] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [isNewCompany, setIsNewCompany] = useState(false);
  const [isGuestAccount, setIsGuestAccount] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // New company fields
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [selectedTrade, setSelectedTrade] = useState('');
  const [customTrade, setCustomTrade] = useState('');
  const [showOtherTradeDialog, setShowOtherTradeDialog] = useState(false);
  const [otherTradeDraft, setOtherTradeDraft] = useState('');
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  // Card fields removed - now using Stripe Checkout
  const [discountCode, setDiscountCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ id: string; code: string; discount_percent: number | null; discount_amount: number | null } | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [guestProjectName, setGuestProjectName] = useState('');
  const [guestProjectAddress, setGuestProjectAddress] = useState('');
  
  const { profile, user, signOut, signUp, refreshProfile, waitForAccountHolder } = useAuth();
  const [finalizing, setFinalizing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  // Deferred signup credentials from Landing.
  // Prefer router state, but fall back to sessionStorage so a lost
  // location.state (e.g. from a re-render or auth-driven redirect) cannot
  // bounce the user back to "/" mid-signup.
  const routeCreds = location.state as { signupEmail?: string; signupPassword?: string; signupFullName?: string; signupLanguage?: string } | null;
  const [signupCreds] = useState<typeof routeCreds>(() => {
    if (routeCreds?.signupEmail) return routeCreds;
    try {
      const raw = sessionStorage.getItem('ssaa_pending_signup');
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });
  const isDeferredSignup = !!signupCreds?.signupEmail && !user;

  const isAlreadyRegisteredAuthError = (error: any) => {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('already registered') || message.includes('already exists') || message.includes('user already');
  };

  const formatGuestSetupError = (error: any) => {
    const message = String(error?.message || error || '');
    if (message.includes('ACCOUNT_ALREADY_HAS_COMPANY')) {
      return 'This login is already connected to a company. Please sign in to continue.';
    }
    if (message.toLowerCase().includes('row-level security') || message.toLowerCase().includes('companies')) {
      return 'We could not finish setting up your guest account. Please try again.';
    }
    return message || 'We could not finish setting up your guest account. Please try again.';
  };

  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [pendingCompanyName, setPendingCompanyName] = useState('');

  useEffect(() => {
    if (isLoading || finalizing) return;
    // Operators (moa role) should never be in onboarding — send to dashboard
    if (profile?.company_id || profile?.role === 'moa') {
      try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
      navigate('/dashboard');
      return;
    }
    // Only bounce to landing if there is truly no user AND no pending
    // deferred-signup payload. Without this guard, a freshly arrived
    // onboarding page can race ahead of router state hydration and
    // redirect the brand-new signup back to "/".
    if (!user && !isDeferredSignup) {
      navigate('/');
    }
  }, [profile, navigate, user, isDeferredSignup, isLoading, finalizing]);


  // Check for pending join requests
  useEffect(() => {
    const checkPendingRequest = async () => {
      if (!user || profile?.company_id) return;
      
      const { data } = await supabase
        .from('company_join_requests')
        .select('id, company_id, status')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .maybeSingle();
      
      if (data) {
        setHasPendingRequest(true);
        // Fetch company name
        const { data: companyData } = await supabase
          .from('companies')
          .select('name')
          .eq('id', data.company_id)
          .single();
        if (companyData) setPendingCompanyName(companyData.name);
      }
    };
    checkPendingRequest();
  }, [user, profile?.company_id]);

  useEffect(() => {
    const fetchPlans = async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (data) {
        setPlans(data);
        const freeTrial = data.find(p => p.name === 'free_trial');
        if (freeTrial) setSelectedPlanId(freeTrial.id);
      }
    };
    fetchPlans();
  }, []);

  useEffect(() => {
    const fetchCompanies = async () => {
      if (!companyType) return;
      
      const { data, error } = await supabase
        .rpc('search_companies_for_onboarding', { search_term: '' })
        .then(res => ({
          data: res.data?.filter((c: any) => c.company_type === companyType) || [],
          error: res.error
        }));
      
      if (error) {
        console.error('Error fetching companies:', error);
        return;
      }
      
      setCompanies(data || []);
    };

    fetchCompanies();
  }, [companyType]);

  const checkAndLinkEmployee = async (userId: string, companyId: string, userEmail: string) => {
    try {
      if (!companyId) return null;
      const normalizedEmail = userEmail.trim().toLowerCase();
      const { data: matchingEmployee } = await supabase
        .from('employees')
        .select('*')
        .eq('company_id', companyId)
        .ilike('email', normalizedEmail)
        .is('linked_user_id', null)
        .single();

      if (matchingEmployee) {
        await supabase
          .from('employees')
          .update({ linked_user_id: userId })
          .eq('id', matchingEmployee.id);
        return matchingEmployee;
      }
      return null;
    } catch (error) {
      console.error('Error checking for matching employee:', error);
      return null;
    }
  };

  const waitForActiveAuthSession = async (timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) return session;
      await new Promise(r => setTimeout(r, 250));
    }
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ? session : null;
  };

  const rollbackJustCreatedAuthUser = async () => {
    // The user was created during this onboarding attempt but the backend setup failed.
    // delete-own-account handles the "no company yet" lone_user case by deleting the
    // profile + auth user cleanly, so retrying signup won't hit "already registered".
    try {
      await supabase.functions.invoke('delete-own-account');
    } catch (err) {
      console.error('Rollback of partial signup failed:', err);
    }
  };

  const sendToLoginAfterGuestSetupDelay = async (
    title = "Account created",
    description = "Please sign in to continue to your dashboard.",
    opts: { rollback?: boolean } = {}
  ) => {
    setFinalizing(false);
    if (opts.rollback) {
      await rollbackJustCreatedAuthUser();
    }
    try { localStorage.removeItem('ssaa_just_onboarded'); } catch {}
    try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
    try { sessionStorage.setItem('ssaa_skip_onboarding_redirect', '1'); } catch {}
    toast({
      title,
      description,
    });
    try { await signOut(); } catch {}
    window.location.replace('/');
  };

  const handleJoinCompany = async () => {
    if (!existingCompany) return;
    if (!isDeferredSignup && (!profile || !user)) return;

    setIsLoading(true);
    try {
      // Run deferred signup first if user landed here via Landing's deferred flow
      const activeProfile = isDeferredSignup ? await performDeferredSignup() : profile;
      if (!activeProfile) throw new Error('Failed to create account');
      if (activeProfile.company_id) {
        try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
        await refreshProfile();
        navigate('/dashboard', { replace: true });
        return;
      }
      const activeUserId = activeProfile.user_id;
      const activeEmail = activeProfile.email;
      const activeName = activeProfile.full_name || activeEmail;

      const selectedCompany = companies.find(c => c.id === existingCompany);

      // Check if there's already a pending request
      const { data: existingRequest } = await supabase
        .from('company_join_requests')
        .select('id')
        .eq('user_id', activeUserId)
        .eq('company_id', existingCompany)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingRequest) {
        toast({
          title: "Request Already Pending",
          description: "You already have a pending request to join this company.",
        });
        setIsLoading(false);
        return;
      }

      // Insert a join request instead of directly joining
      const { error } = await supabase
        .from('company_join_requests')
        .insert({
          user_id: activeUserId,
          company_id: existingCompany,
          user_email: activeEmail,
          user_name: activeName,
        });

      if (error) throw error;

      setHasPendingRequest(true);
      setPendingCompanyName(selectedCompany?.name || '');

      // Look up the request id we just inserted, then fire-and-forget the
      // notify-join-request edge function (service-role; doesn't depend on the
      // brand-new client session being fully ready).
      try {
        const { data: insertedReq } = await supabase
          .from('company_join_requests')
          .select('id')
          .eq('user_id', activeUserId)
          .eq('company_id', existingCompany)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (insertedReq?.id) {
          await supabase.functions.invoke('notify-join-request', {
            body: { requestId: insertedReq.id, action: 'submitted' },
          });
        }
      } catch (notifyErr) {
        console.error('Failed to notify account holder of join request:', notifyErr);
      }

      toast({
        title: "Request Submitted!",
        description: "Your request to join has been submitted. The Main Company Account Holder has been notified and will review it.",
      });
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

  const handleContinueToSubscription = () => {
    setStep(3);
  };

  const handleContinueToPayment = () => {
    const selectedPlan = plans.find(p => p.id === selectedPlanId);
    const hasFreePeriod = selectedPlan?.free_period_months != null && selectedPlan.free_period_months > 0;
    
    if (hasFreePeriod) {
      // Skip payment step entirely for free trial plans
      setStep(4); // Step 4 will now show free trial confirmation instead of card form
    } else {
      setStep(4); // Step 4 will show Stripe checkout for paid plans
    }
  };

  // Helper to perform deferred signup if needed
  const performDeferredSignup = async () => {
    if (!isDeferredSignup) return profile;
    const normalizedEmail = signupCreds!.signupEmail!.trim().toLowerCase();
    const completeSignedInProfile = async () => {
      let activeSession = await waitForActiveAuthSession(5000);
      if (!activeSession?.user?.id) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: signupCreds!.signupPassword!,
        });
        if (signInError) throw signInError;
        activeSession = await waitForActiveAuthSession(5000);
      }

      if (!activeSession?.user?.id) {
        throw new Error('Account sign-in is still finalizing. Please sign in from the home page to continue.');
      }

      const activeUser = activeSession.user;
      await supabase
        .from('profiles')
        .update({ language: signupCreds!.signupLanguage || 'en' })
        .eq('user_id', activeUser.id);
      await checkAndLinkEmployee(activeUser.id, '', normalizedEmail);
      await refreshProfile();

      let newProfile = null;
      const profileDeadline = Date.now() + 5000;
      while (Date.now() < profileDeadline && !newProfile) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', activeUser.id)
          .maybeSingle();
        newProfile = data;
        if (!newProfile) await new Promise(r => setTimeout(r, 250));
      }
      try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
      return newProfile;
    };

    const { error, data } = await signUp(normalizedEmail, signupCreds!.signupPassword!, signupCreds!.signupFullName!);
    const identities = (data?.user as any)?.identities;
    const alreadyRegistered = isAlreadyRegisteredAuthError(error) || (Array.isArray(identities) && identities.length === 0);
    if (error && !alreadyRegistered) throw error;

    if (alreadyRegistered) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: signupCreds!.signupPassword!,
      });
      if (signInError) {
        try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
        throw new Error('This email already has an account. Please sign in instead of creating a new account.');
      }
      return completeSignedInProfile();
    }

    return completeSignedInProfile();
  };

  // Guest account registration - skips subscription and payment
  const handleGuestRegistration = async () => {
    if (!companyName.trim() || !guestProjectName.trim() || !guestProjectAddress.trim()) return;

    setIsLoading(true);
    try {
      // Perform deferred signup if coming from Landing
      const activeProfile = isDeferredSignup ? await performDeferredSignup() : profile;
      if (!activeProfile && !isDeferredSignup) throw new Error('Failed to create account');

      const activeSession = await waitForActiveAuthSession(5000);
      if (!activeSession?.user?.id) {
        throw new Error('Account sign-in is still finalizing. Please sign in from the home page to continue.');
      }

      if (activeProfile?.company_id) {
        try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
        await refreshProfile();
        navigate('/dashboard', { replace: true });
        return;
      }

      const activeUserId = activeProfile?.user_id || activeSession.user.id;

      setFinalizing(true);

      // Atomic backend setup: creates company, links profile, inserts
      // account_holder role, creates first project, subscribes to guest plan.
      const { data: rpcRows, error: rpcError } = await supabase.rpc('create_guest_gc_account', {
        p_company_name: companyName.trim(),
        p_company_address: companyAddress.trim(),
        p_project_name: guestProjectName.trim() || companyName.trim(),
        p_project_address: guestProjectAddress.trim() || companyAddress.trim(),
      });

      if (rpcError) throw rpcError;
      const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      const newCompanyId = row?.created_company_id as string | undefined;
      const newProjectId = row?.created_project_id as string | undefined;
      if (!newCompanyId || !newProjectId) throw new Error('Guest account setup did not return a company');
      const newCompany = { id: newCompanyId };
      const newProject = { id: newProjectId };

      toast({
        title: "Guest Account Created!",
        description: "Your project has been created. Use a connection code to connect to a subcontractor.",
      });

      try {
        localStorage.setItem('ssaa_just_onboarded', String(Date.now()));
      } catch {}

      const deadline = Date.now() + 45000;
      let ready = false;
      while (Date.now() < deadline) {
        const [{ data: refreshedProfile }, { data: refreshedRole }] = await Promise.all([
          supabase.from('profiles').select('company_id').eq('user_id', activeUserId).maybeSingle(),
          supabase.from('user_roles')
            .select('id, permission_level, is_company_creator')
            .eq('user_id', activeUserId)
            .eq('company_id', newCompany.id)
            .maybeSingle(),
        ]);

        const dbReady =
          refreshedProfile?.company_id === newCompany.id &&
          !!refreshedRole?.id &&
          (refreshedRole.permission_level === 'account_holder' || refreshedRole.is_company_creator === true);

        if (dbReady) {
          await refreshProfile();
          ready = true;
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }

      if (!ready) {
        // Backend setup timed out — roll back so the auth user isn't stranded.
        await sendToLoginAfterGuestSetupDelay(
          'Signup could not be completed',
          'We could not finish setting up your guest account. Please try again.',
          { rollback: true }
        );
        return;
      }

      await refreshProfile();
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      console.error('Guest account setup error:', error);
      if (isAlreadyRegisteredAuthError(error) || String(error?.message || '').includes('Please sign in instead')) {
        // Email is already in use — don't roll back (existing account is not ours to delete).
        await sendToLoginAfterGuestSetupDelay(
          'Account already exists',
          'Please sign in with this email instead of creating a new account.'
        );
      } else {
        // Any other error after signup means we have a partial account — roll it back.
        await sendToLoginAfterGuestSetupDelay(
          'Signup could not be completed',
          formatGuestSetupError(error),
          { rollback: true }
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteRegistration = async () => {
    if (!companyName.trim() || !companyType) return;
    if (!isDeferredSignup && !profile) return;

    setIsLoading(true);
    try {
      // Perform deferred signup if needed
      const activeProfile = isDeferredSignup ? await performDeferredSignup() : profile;
      if (!activeProfile) throw new Error('Failed to create account');
      if (activeProfile.company_id) {
        try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
        await refreshProfile();
        navigate('/dashboard', { replace: true });
        return;
      }

      const tradeValue = companyType === 'sub' 
        ? (selectedTrade === 'Other' ? customTrade.trim() : selectedTrade)
        : null;

      const selectedPlan = plans.find(p => p.id === selectedPlanId);
      const hasFreePeriod = selectedPlan?.free_period_months != null && selectedPlan.free_period_months > 0;

      // Calculate expiry date for free trial
      const expiresAt = hasFreePeriod
        ? new Date(Date.now() + (selectedPlan!.free_period_months! * 30 * 24 * 60 * 60 * 1000)).toISOString()
        : null;

      const { data: newCompany, error: companyError } = await supabase
        .from('companies')
        .insert({
          name: companyName.trim(),
          company_type: companyType as CompanyType,
          address: companyAddress.trim(),
          subscription_status: hasFreePeriod ? 'trial' : 'pending_payment',
          trade: tradeValue,
          has_payment_method: false,
        })
        .select()
        .single();
      
      if (companyError) throw companyError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ company_id: newCompany.id })
        .eq('id', activeProfile.id);
      
      if (profileError) throw profileError;

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: activeProfile.user_id,
          company_id: newCompany.id,
          permission_level: 'account_holder',
          is_company_creator: true,
        });
      
      if (roleError) {
        // Rollback: clear profile.company_id and delete the orphaned company
        // so the user can retry signup cleanly without being stuck without a role.
        await supabase.from('profiles').update({ company_id: null }).eq('id', activeProfile.id);
        await supabase.from('companies').delete().eq('id', newCompany.id);
        throw roleError;
      }

      // Create employee record for the creator (idempotent)
      try {
        const { data: existingEmp } = await supabase
          .from('employees')
          .select('id')
          .eq('company_id', newCompany.id)
          .eq('linked_user_id', activeProfile.user_id)
          .maybeSingle();
        if (!existingEmp) {
          await supabase.from('employees').insert({
            company_id: newCompany.id,
            name: activeProfile.full_name || activeProfile.email,
            email: activeProfile.email,
            phone: (activeProfile as any).phone || null,
            linked_user_id: activeProfile.user_id,
          });
        }
      } catch (empErr) {
        console.error('Employee record creation warning (non-blocking):', empErr);
      }

      // Create company subscription record
      await supabase
        .from('company_subscriptions')
        .insert({
          company_id: newCompany.id,
          plan_id: selectedPlanId,
          billing_cycle: billingCycle,
          status: hasFreePeriod ? 'trial' : 'pending',
          expires_at: expiresAt,
          discount_code_id: appliedDiscount?.id || null,
        });

      if (hasFreePeriod) {
        const trialLabel = selectedPlan!.free_period_months === 12
          ? '1-year'
          : `${selectedPlan!.free_period_months}-month`;
        toast({
          title: "Welcome to SSAA!",
          description: `Your account is ready. Enjoy your ${trialLabel} free trial! You'll be reminded before it expires.`,
        });
        // Mark a short-lived flag so Dashboard suppresses the
        // "no company → /onboarding" guard while the new profile/company
        // link is propagating.
        try {
          localStorage.setItem('ssaa_just_onboarded', String(Date.now()));
        } catch {}
        // Block navigation behind a visible "Finalizing your account..." gate
        // until BOTH the DB rows AND the AuthContext snapshot confirm the
        // account_holder role for the new company. This guarantees the
        // "Manage My Company Account" header button is available on first
        // paint of the dashboard.
        setFinalizing(true);
        const deadline = Date.now() + 45000;
        let ready = false;
        while (Date.now() < deadline) {
          const [{ data: refreshedProfile }, { data: refreshedRole }] = await Promise.all([
            supabase.from('profiles').select('company_id').eq('id', activeProfile.id).maybeSingle(),
            supabase.from('user_roles')
              .select('id, permission_level, is_company_creator')
              .eq('user_id', activeProfile.user_id)
              .eq('company_id', newCompany.id)
              .maybeSingle(),
          ]);
          const dbReady =
            refreshedProfile?.company_id === newCompany.id &&
            !!refreshedRole?.id &&
            (refreshedRole.permission_level === 'account_holder' || refreshedRole.is_company_creator === true);
          if (dbReady) {
            await refreshProfile();
            const ctxReady = await waitForAccountHolder(newCompany.id, Math.max(1000, deadline - Date.now()));
            if (ctxReady) { ready = true; break; }
          }
          await new Promise(r => setTimeout(r, 250));
        }
        if (!ready) {
          setFinalizing(false);
          try { localStorage.removeItem('ssaa_just_onboarded'); } catch {}
          try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
          try { sessionStorage.setItem('ssaa_skip_onboarding_redirect', '1'); } catch {}
          toast({
            title: "Account created",
            description: "Please sign in to continue to your dashboard.",
          });
          try { await signOut(); } catch {}
          window.location.replace('/');
          return;
        }
        navigate('/dashboard?firstrun=1', { replace: true });
      } else {
        // For paid plans, redirect to Stripe Checkout
        try {
          const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke('create-checkout-session', {
            body: {
              plan_id: selectedPlanId,
              billing_cycle: billingCycle,
              discount_code_id: appliedDiscount?.id || null,
              company_id: newCompany.id,
              success_url: `${window.location.origin}/dashboard?checkout=success`,
              cancel_url: `${window.location.origin}/dashboard?checkout=cancelled`,
            },
          });

          if (checkoutError) throw checkoutError;
          if (checkoutData?.url) {
            window.location.href = checkoutData.url;
          } else {
            throw new Error('No checkout URL returned');
          }
        } catch (checkoutErr: any) {
          console.error('Checkout error:', checkoutErr);
          toast({
            title: "Registration Complete",
            description: "Your account is created. You can add payment information from your dashboard.",
          });
          await refreshProfile();
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (error: any) {
      // Any failure after signup left a partial account — roll it back so the
      // email is free and the user isn't stuck in an onboarding loop next time.
      if (isAlreadyRegisteredAuthError(error) || String(error?.message || '').includes('Please sign in instead')) {
        await sendToLoginAfterGuestSetupDelay(
          'Account already exists',
          'Please sign in with this email instead of creating a new account.'
        );
      } else {
        await sendToLoginAfterGuestSetupDelay(
          'Signup could not be completed',
          error?.message || 'We could not finish setting up your account. Please try again.',
          { rollback: true }
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLanding = async () => {
    // User explicitly abandoned onboarding — drop any pending deferred-signup
    // payload so it doesn't auto-resume the next time they hit "/".
    try { sessionStorage.removeItem('ssaa_pending_signup'); } catch {}
    if (user) {
      await signOut();
    }
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {finalizing && (
        <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md px-6">
            <div className="mx-auto w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <h2 className="text-xl font-semibold">Finalizing your account…</h2>
            <p className="text-sm text-muted-foreground">
              We're setting up your company workspace. This may take a few seconds — please don't close this window.
            </p>
          </div>
        </div>
      )}
      <div className="w-full max-w-4xl">
        {/* Progress indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            {(isGuestAccount ? [1, 2] : [1, 2, 3, 4]).map((s) => (
              <div
                key={s}
                className={`w-3 h-3 rounded-full transition-colors ${
                  s <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Pending approval state */}
        {hasPendingRequest && step === 1 && (
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="text-center">
              <Users className="w-12 h-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl">{t('onboarding.waitingApproval')}</CardTitle>
              <CardDescription>
                {t('onboarding.pendingReview', { company: pendingCompanyName })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                {t('onboarding.accessAfterApproval')}
              </p>
              <Button
                variant="ghost"
                onClick={handleBackToLanding}
                className="w-full mt-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('onboarding.backToHome')}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 1 && !hasPendingRequest && (
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="text-center">
              <Building2 className="w-12 h-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl">{t('onboarding.companySetup')}</CardTitle>
              <CardDescription>
                {t('onboarding.connectCompany')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('onboarding.companyType')}</Label>
                <Select value={companyType} onValueChange={(v) => { setCompanyType(v as CompanyType); setIsGuestAccount(false); setIsNewCompany(false); setCompanySearch(''); setExistingCompany(''); }}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('onboarding.selectCompanyType')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gc">{t('onboarding.gc')}</SelectItem>
                    <SelectItem value="sub">{t('onboarding.sub')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {companyType && !isNewCompany && !isGuestAccount && (
                <div className="space-y-2">
                  <Label>{t('onboarding.selectExistingCompany')}</Label>
                  <div className="relative">
                    <Input
                      placeholder="Type company name (min 3 characters)..."
                      value={companySearch}
                      onChange={(e) => {
                        setCompanySearch(e.target.value);
                        setExistingCompany('');
                      }}
                    />
                    {companySearch.trim().length >= 3 && !existingCompany && (() => {
                      const filtered = companies.filter(c =>
                        c.name.toLowerCase().includes(companySearch.trim().toLowerCase())
                      );
                      return (
                        <div className="absolute z-10 w-full mt-1 bg-background border border-input rounded-md shadow-md max-h-48 overflow-y-auto">
                          {filtered.length > 0 ? filtered.map((company) => (
                            <button
                              key={company.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                              onClick={() => {
                                setExistingCompany(company.id);
                                setCompanySearch(company.name);
                              }}
                            >
                              {company.name}
                            </button>
                          )) : (
                            <div className="px-3 py-2 text-sm text-muted-foreground">No companies found</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {companyType && (
                <div className="pt-4 space-y-3">
                  {existingCompany && !isNewCompany && !isGuestAccount && (
                    <Button 
                      onClick={handleJoinCompany} 
                      className="w-full"
                      disabled={isLoading}
                    >
                      {isLoading ? t('onboarding.joining') : t('onboarding.joinCompany')}
                    </Button>
                  )}
                  
                  <Button
                    variant={isNewCompany ? "default" : "outline"}
                    onClick={() => {
                      setIsNewCompany(true);
                      setIsGuestAccount(false);
                      setStep(2);
                    }}
                    className="w-full"
                  >
                    {t('onboarding.createNewCompany')}
                  </Button>

                  {/* Guest Account option - only for GC */}
                  {companyType === 'gc' && (
                    <Button
                      variant={isGuestAccount ? "default" : "outline"}
                      onClick={() => {
                        setIsGuestAccount(true);
                        setIsNewCompany(false);
                        setStep(2);
                      }}
                      className="w-full"
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      {t('onboarding.createGuestAccount')}
                    </Button>
                  )}
                </div>
              )}

              <Button
                variant="ghost"
                onClick={handleBackToLanding}
                className="w-full mt-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                {t('onboarding.back')}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 2 && isGuestAccount && (
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="text-center">
              <UserCheck className="w-12 h-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl">{t('onboarding.guestSetup')}</CardTitle>
              <CardDescription>
                {t('onboarding.guestDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Guest plan info */}
              {(() => {
                const guestPlan = plans.find(p => p.name === 'guest_gc');
                return guestPlan ? (
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
                    <p className="text-lg font-semibold text-foreground">Guest Account — Free</p>
                    <p className="text-sm text-muted-foreground mt-1">Up to {guestPlan.max_projects} projects included</p>
                  </div>
                ) : null;
              })()}

              <div className="bg-muted/50 p-4 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground">
                  <strong>{t('common.note')}</strong> {t('onboarding.guestNote')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="guestCompanyName">{t('onboarding.companyName')} *</Label>
                <Input
                  id="guestCompanyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ABC Construction"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="guestCompanyAddress">{t('onboarding.companyAddress')}</Label>
                <Input
                  id="guestCompanyAddress"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="123 Main St, City, State"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="guestProjectName">What is the name of this project? *</Label>
                <Input
                  id="guestProjectName"
                  value={guestProjectName}
                  onChange={(e) => setGuestProjectName(e.target.value)}
                  placeholder="e.g. Downtown Office Renovation"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="guestProjectAddress">Project Address *</Label>
                <Input
                  id="guestProjectAddress"
                  value={guestProjectAddress}
                  onChange={(e) => setGuestProjectAddress(e.target.value)}
                  placeholder="456 Project Ave, City, State"
                  required
                />
              </div>

              {inviteToken && (
                <div className="bg-primary/10 p-3 rounded-lg border border-primary/20">
                  <p className="text-sm text-foreground">
                    {t('onboarding.autoConnected')}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => { setStep(1); setIsGuestAccount(false); }} className="flex-1">
                  {t('onboarding.back')}
                </Button>
                <Button 
                  onClick={handleGuestRegistration} 
                  className="flex-1"
                  disabled={!companyName.trim() || !guestProjectName.trim() || !guestProjectAddress.trim() || isLoading}
                >
                  {isLoading ? t('onboarding.creating') : t('onboarding.createGuestAccountBtn')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && !isGuestAccount && (
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="text-center">
              <Building2 className="w-12 h-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl">{t('onboarding.createCompany')}</CardTitle>
              <CardDescription>
                {t('onboarding.setupNew', { type: companyType === 'gc' ? t('onboarding.gc') : t('onboarding.sub') })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">{t('onboarding.companyName')} *</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ABC Construction"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="companyAddress">{t('onboarding.companyAddress')}</Label>
                <Input
                  id="companyAddress"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="123 Main St, City, State"
                />
              </div>

              {companyType === 'sub' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="trade">{t('onboarding.trade')} *</Label>
                    <Select
                      value={selectedTrade}
                      onValueChange={(val) => {
                        setSelectedTrade(val);
                        if (val === 'Other') {
                          setOtherTradeDraft(customTrade);
                          setShowOtherTradeDialog(true);
                        } else {
                          setCustomTrade('');
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('onboarding.selectTrade')}>
                          {selectedTrade === 'Other' && customTrade
                            ? `Other: ${customTrade}`
                            : selectedTrade || undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TRADES.map((trade) => (
                          <SelectItem key={trade} value={trade}>
                            {trade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Dialog
                    open={showOtherTradeDialog}
                    onOpenChange={(open) => {
                      setShowOtherTradeDialog(open);
                      if (!open && !customTrade.trim()) {
                        setSelectedTrade('');
                      }
                    }}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('onboarding.specifyTrade')}</DialogTitle>
                        <DialogDescription>
                          {t('onboarding.specifyTradeDesc')}
                        </DialogDescription>
                      </DialogHeader>
                      <Input
                        autoFocus
                        value={otherTradeDraft}
                        onChange={(e) => setOtherTradeDraft(e.target.value)}
                        placeholder={t('onboarding.specifyTrade')}
                      />
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowOtherTradeDialog(false);
                            if (!customTrade.trim()) setSelectedTrade('');
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          disabled={!otherTradeDraft.trim()}
                          onClick={() => {
                            setCustomTrade(otherTradeDraft.trim());
                            setShowOtherTradeDialog(false);
                          }}
                        >
                          {t('common.save')}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
              )}

              <div className="bg-muted/50 p-4 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground">
                  <strong>{t('common.note')}</strong> {t('onboarding.accountHolderNote')}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => { setStep(1); setIsNewCompany(false); }} className="flex-1">
                  {t('onboarding.back')}
                </Button>
                <Button 
                  onClick={handleContinueToSubscription} 
                  className="flex-1"
                  disabled={!companyName.trim() || !companyAddress.trim() || (companyType === 'sub' && !selectedTrade) || (selectedTrade === 'Other' && !customTrade.trim())}
                >
                  {t('onboarding.continue')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="border-primary/20 shadow-lg max-w-3xl mx-auto">
            <CardHeader className="text-center">
              <CreditCard className="w-12 h-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl">{t('onboarding.choosePlan')}</CardTitle>
              <CardDescription>
                {t('onboarding.selectPlan')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Billing cycle toggle */}
              <div className="flex justify-center">
                <div className="inline-flex items-center rounded-full border border-border p-1 bg-muted/50">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      billingCycle === 'monthly'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('onboarding.monthly')}
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      billingCycle === 'annual'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('onboarding.annually')}
                  </button>
                </div>
              </div>

              {/* Plan cards grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plans.filter(p => p.name !== 'custom' && p.name !== 'guest_gc').map((plan) => {
                  const isSelected = selectedPlanId === plan.id;
                  const isFree = plan.name === 'free_trial';
                  const price = isFree ? 0 : billingCycle === 'annual' ? plan.annual_price_per_month : plan.monthly_price;
                  const hasFreePeriod = plan.free_period_months != null && plan.free_period_months > 0;
                  const freePeriodLabel = hasFreePeriod
                    ? plan.free_period_months === 12
                      ? '1 year free'
                      : `${plan.free_period_months} month${plan.free_period_months! > 1 ? 's' : ''} free`
                    : '';

                  return (
                    <div
                      key={plan.id}
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-primary shadow-lg scale-[1.02]'
                          : 'border-border hover:border-primary/40 hover:shadow-md'
                      }`}
                    >
                      <div className={`px-4 py-3 text-center ${
                        isSelected ? 'bg-primary' : 'bg-primary/80'
                      }`}>
                        <h3 className="font-bold text-primary-foreground text-sm uppercase tracking-wide">
                          {plan.display_name}
                        </h3>
                        {hasFreePeriod && (
                          <span className="text-xs text-primary-foreground font-medium">
                            {freePeriodLabel}
                          </span>
                        )}
                      </div>

                      <div className="p-5 text-center bg-card">
                        <div className="mb-2">
                          <span className="text-4xl font-bold text-foreground">${price}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isFree
                            ? `Free for ${freePeriodLabel || '3 months'}`
                            : `USD / per month${billingCycle === 'annual' ? '\n(billed annually)' : ''}`
                          }
                        </p>

                        <div className="mt-4 pt-4 border-t border-border space-y-2 text-left">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 text-primary shrink-0" />
                            <span>{plan.max_projects} {t('onboarding.projects')}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 text-primary shrink-0" />
                            <span>{plan.max_users} {t('onboarding.users')}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 text-primary shrink-0" />
                            <span>{t('onboarding.fullPlatformAccess')}</span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="mt-4">
                            <div className="inline-flex items-center gap-1 text-primary text-sm font-medium">
                              <CheckCircle className="h-4 w-4" />
                              {t('onboarding.selected')}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {plans.some(p => p.name === 'custom') && (
                <p className="text-xs text-center text-muted-foreground">
                {t('onboarding.customPlanNote')}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                  {t('onboarding.back')}
                </Button>
                <Button
                  onClick={handleContinueToPayment}
                  className="flex-1"
                  disabled={!selectedPlanId}
                >
                  {t('onboarding.continue')}
                </Button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                {t('onboarding.changePlanAnytime')}
              </p>
            </CardContent>
          </Card>
        )}

        {step === 4 && (() => {
          const selectedPlan = plans.find(p => p.id === selectedPlanId);
          const hasFreePeriod = selectedPlan?.free_period_months != null && selectedPlan.free_period_months > 0;
          const freePeriodLabel = hasFreePeriod
            ? selectedPlan!.free_period_months === 12
              ? '1 year'
              : `${selectedPlan!.free_period_months} month${selectedPlan!.free_period_months! > 1 ? 's' : ''}`
            : '';
          const expiryDate = hasFreePeriod
            ? new Date(Date.now() + (selectedPlan!.free_period_months! * 30 * 24 * 60 * 60 * 1000)).toLocaleDateString()
            : '';

          if (hasFreePeriod) {
            // Free trial confirmation - no credit card needed
            return (
              <Card className="border-primary/20 shadow-lg">
                <CardHeader className="text-center">
                  <CheckCircle className="w-12 h-12 mx-auto text-primary mb-2" />
                  <CardTitle className="text-2xl">{t('onboarding.freeTrial')}</CardTitle>
                  <CardDescription>
                    {t('onboarding.noCreditCard')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-primary/10 p-4 rounded-lg border border-primary/20 text-center">
                    <p className="text-lg font-semibold text-foreground mb-1">
                      {t('onboarding.trialLasts', { period: freePeriodLabel })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('onboarding.addPaymentBefore', { date: expiryDate })}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('onboarding.remindViaEmail')}
                    </p>
                  </div>

                  <div className="bg-muted/50 p-3 rounded-lg border border-border text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">{t('onboarding.selectedPlan')}</p>
                    <p><strong>{selectedPlan?.display_name}</strong> — {t('onboarding.freeFor')} {freePeriodLabel}</p>
                  </div>

                  {/* Discount Code - can still be applied for when trial ends */}
                  <div className="space-y-2">
                    <Label htmlFor="discountCode">{t('onboarding.discountCode')}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="discountCode"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value)}
                        placeholder="Enter discount code"
                        disabled={!!appliedDiscount}
                      />
                      {appliedDiscount ? (
                        <Button variant="outline" onClick={() => { setAppliedDiscount(null); setDiscountCode(''); }}>
                          Remove
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={!discountCode.trim() || discountLoading}
                          onClick={async () => {
                            setDiscountLoading(true);
                            try {
                              const { data, error } = await supabase
                                .from('discount_codes')
                                .select('*')
                                .eq('code', discountCode.trim())
                                .eq('is_active', true)
                                .maybeSingle();
                              if (error || !data) {
                                toast({ title: 'Invalid Code', description: 'This discount code is not valid.', variant: 'destructive' });
                                return;
                              }
                              if (data.max_uses && data.current_uses >= data.max_uses) {
                                toast({ title: 'Code Expired', description: 'This discount code has reached its usage limit.', variant: 'destructive' });
                                return;
                              }
                              setAppliedDiscount({ id: data.id, code: data.code, discount_percent: data.discount_percent, discount_amount: data.discount_amount });
                              toast({ title: 'Discount Applied!', description: `Code "${data.code}" will be applied after your free trial.` });
                            } catch {
                              toast({ title: 'Error', description: 'Failed to validate discount code.', variant: 'destructive' });
                            } finally {
                              setDiscountLoading(false);
                            }
                          }}
                        >
                          {discountLoading ? 'Checking...' : 'Apply'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={() => setStep(3)} className="flex-1">
                      {t('onboarding.back')}
                    </Button>
                    <Button
                      onClick={handleCompleteRegistration}
                      className="flex-1"
                      disabled={isLoading}
                    >
                      {isLoading ? t('onboarding.creating') : t('onboarding.startFreeTrial')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          }

          // Paid plan - show price summary and Stripe Checkout button
          const basePrice = billingCycle === 'annual' ? selectedPlan?.annual_price_per_month : selectedPlan?.monthly_price;
          let finalPrice = basePrice || 0;
          let discountLabel = '';
          if (appliedDiscount) {
            if (appliedDiscount.discount_percent) {
              finalPrice = finalPrice * (1 - appliedDiscount.discount_percent / 100);
              discountLabel = `${appliedDiscount.discount_percent}% off`;
            } else if (appliedDiscount.discount_amount) {
              finalPrice = Math.max(0, finalPrice - Number(appliedDiscount.discount_amount));
              discountLabel = `$${appliedDiscount.discount_amount} off`;
            }
          }

          return (
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="text-center">
                <CreditCard className="w-12 h-12 mx-auto text-primary mb-2" />
                <CardTitle className="text-2xl">{t('onboarding.completePayment')}</CardTitle>
                <CardDescription>
                  {t('onboarding.redirectToPayment')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 p-3 rounded-lg border border-border text-sm text-muted-foreground text-center">
                  <strong>{selectedPlan?.display_name}</strong> — ${finalPrice.toFixed(2)}/mo
                  {billingCycle === 'annual' && ' (billed annually)'}
                  {discountLabel && (
                    <span className="ml-2 text-primary font-medium">({discountLabel})</span>
                  )}
                </div>

                {/* Discount Code */}
                <div className="space-y-2">
                  <Label htmlFor="discountCode">{t('onboarding.discountCodeOptional')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="discountCode"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                      placeholder="Enter discount code"
                      disabled={!!appliedDiscount}
                    />
                    {appliedDiscount ? (
                      <Button variant="outline" onClick={() => { setAppliedDiscount(null); setDiscountCode(''); }}>
                        Remove
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={!discountCode.trim() || discountLoading}
                        onClick={async () => {
                          setDiscountLoading(true);
                          try {
                            const { data, error } = await supabase
                              .from('discount_codes')
                              .select('*')
                              .eq('code', discountCode.trim())
                              .eq('is_active', true)
                              .maybeSingle();
                            if (error || !data) {
                              toast({ title: 'Invalid Code', description: 'This discount code is not valid.', variant: 'destructive' });
                              return;
                            }
                            if (data.max_uses && data.current_uses >= data.max_uses) {
                              toast({ title: 'Code Expired', description: 'This discount code has reached its usage limit.', variant: 'destructive' });
                              return;
                            }
                            setAppliedDiscount({ id: data.id, code: data.code, discount_percent: data.discount_percent, discount_amount: data.discount_amount });
                            toast({ title: 'Discount Applied!', description: `Code "${data.code}" applied successfully.` });
                          } catch {
                            toast({ title: 'Error', description: 'Failed to validate discount code.', variant: 'destructive' });
                          } finally {
                            setDiscountLoading(false);
                          }
                        }}
                      >
                        {discountLoading ? 'Checking...' : 'Apply'}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(3)} className="flex-1">
                  {t('onboarding.back')}
                </Button>
                <Button
                  onClick={handleCompleteRegistration}
                  className="flex-1"
                  disabled={isLoading}
                >
                  {isLoading ? t('onboarding.processing') : t('onboarding.proceedToPayment')}
                </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>
    </div>
  );
};

export default Onboarding;
