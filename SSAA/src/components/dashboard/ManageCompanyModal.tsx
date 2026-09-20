import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { useTooltipFlags } from '@/components/onboarding/TooltipFlagsProvider';
import ManageCompanyIntroDialog, { IntroItem } from '@/components/onboarding/ManageCompanyIntroDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Building2, CreditCard, Users, FolderOpen, Copy, Trash2, Link2, Unlink, Plus, ChevronDown, ChevronUp, Check, CheckCircle, Tag, ExternalLink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ProfilesModal from './ProfilesModal';
import ConnectedContractorsTab from './ConnectedContractorsTab';
import JoinExistingCompanyDialog from './JoinExistingCompanyDialog';
import { fetchAliasesForCompany, applyAliasesToProjects } from '@/lib/projectDisplay';
import { fetchCompanyUsage, isAtProjectLimit, detectLimitError, type CompanyUsage } from '@/lib/planLimits';
import { PlanLimitDialog } from './PlanLimitDialog';
import AnchoredFirstClickTip from '@/components/onboarding/AnchoredFirstClickTip';
import { TRADES } from '@/lib/trades';

interface ImpersonatedUser {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  company_id: string | null;
  company_name: string | null;
  company_type: 'gc' | 'sub' | null;
  permission_level?: 'account_holder' | 'full' | 'partial' | 'level_1' | 'basic' | 'standard' | null;
}

interface ManageCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impersonatedUser?: ImpersonatedUser | null;
  pendingJoinCount?: number;
  onJoinRequestsChanged?: () => void;
  onProjectsChanged?: () => void;
  visibleProjectIds?: string[];
}

interface Company {
  id: string;
  name: string;
  address: string | null;
  trade?: string | null;
  subscription_status: string | null;
  subscription_ends_at: string | null;
  company_type?: 'gc' | 'sub';
  is_guest?: boolean;
  stripe_customer_id?: string | null;
}

interface Project {
  id: string;
  name: string;
  address: string | null;
  connection_code: string | null;
  company_id: string;
}

// Billing Tab Component
interface BillingTabProps {
  company: Company | null;
  effectiveCompanyId: string | null | undefined;
  formatDate: (d: string | null) => string;
  isMOA: boolean;
  isAccountHolder: boolean;
  isGuestGC?: boolean;
  guestMaxProjects?: number | null;
  onCompanyDeleted?: () => void;
  impersonatedUserId?: string | null;
}

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

const BillingTab = ({ company, effectiveCompanyId, formatDate, isMOA, isAccountHolder, isGuestGC = false, guestMaxProjects = null, onCompanyDeleted, impersonatedUserId = null }: BillingTabProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [discountCode, setDiscountCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<{ id: string; code: string; discount_percent: number | null; discount_amount: number | null } | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [hasPendingDeletion, setHasPendingDeletion] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  // Check for pending deletion request
  useEffect(() => {
    const checkPendingDeletion = async () => {
      if (!effectiveCompanyId) return;
      const { data } = await supabase
        .from('company_deletion_requests')
        .select('id')
        .eq('company_id', effectiveCompanyId)
        .eq('status', 'pending')
        .maybeSingle();
      if (data) {
        setHasPendingDeletion(true);
        setPendingRequestId(data.id);
      }
    };
    checkPendingDeletion();
  }, [effectiveCompanyId]);

  const handleRequestCancellation = async () => {
    if (!effectiveCompanyId) return;
    setCancelLoading(true);
    try {
      // Check if already pending
      const { data: existing } = await supabase
        .from('company_deletion_requests')
        .select('id')
        .eq('company_id', effectiveCompanyId)
        .eq('status', 'pending')
        .maybeSingle();
      if (existing) {
        toast({ title: t('company.cancelRequestAlreadyPending'), description: t('company.cancelRequestAlreadyPendingDesc') });
        return;
      }
      const { data, error } = await supabase.rpc('request_company_deletion' as any, {
        p_company_id: effectiveCompanyId,
        p_target_user_id: impersonatedUserId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.request_id) setPendingRequestId(row.request_id);
      setHasPendingDeletion(true);
      toast({ title: t('company.deleteAccountSubmitted'), description: t('company.deleteAccountSubmittedDesc') });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleConfirmDeletion = async () => {
    if (!effectiveCompanyId) return;
    setCancelLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-company', {
        body: { company_id: effectiveCompanyId, request_id: pendingRequestId },
      });
      if (error) throw error;
      toast({ title: t('company.deletionSuccess'), description: t('company.deletionSuccessDesc') });
      onCompanyDeleted?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setCancelLoading(false);
    }
  };

  useEffect(() => {
    if (showChangePlan) {
      const fetchPlans = async () => {
        const { data } = await supabase
          .from('subscription_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order');
        if (data) setPlans(data);
      };
      fetchPlans();
    }
  }, [showChangePlan]);

  const handleApplyDiscount = async () => {
    if (!discountCode.trim()) return;
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
  };

  const handleUpdatePaymentMethod = async () => {
    if (!effectiveCompanyId) return;
    setCheckoutLoading(true);
    try {
      // Look up the company's current subscription + Stripe linkage to route
      // the user to either the billing portal (paid) or a tier picker (trial / no sub).
      const [{ data: sub }, { data: comp }] = await Promise.all([
        supabase
          .from('company_subscriptions')
          .select('plan_id, billing_cycle, status, stripe_subscription_id')
          .eq('company_id', effectiveCompanyId)
          .in('status', ['active', 'trial'])
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('companies')
          .select('stripe_customer_id')
          .eq('id', effectiveCompanyId)
          .maybeSingle(),
      ]);

      const hasPaidStripeSub =
        sub?.status === 'active' &&
        !!sub?.stripe_subscription_id &&
        !!comp?.stripe_customer_id;

      if (hasPaidStripeSub) {
        // Existing paying customer — send them to the Stripe billing portal.
        const { data, error } = await supabase.functions.invoke('create-customer-portal', {
          body: { company_id: effectiveCompanyId },
        });
        if (error) throw error;
        if (!data?.url) throw new Error('No portal URL returned');
        window.location.href = data.url;
        return;
      }

      // Has a plan_id (trial on a specific tier, or sub missing Stripe customer)
      // → go straight to Stripe Checkout for THAT exact tier.
      if (sub?.plan_id) {
        const cycle = sub.billing_cycle === 'annual' ? 'annual' : 'monthly';
        const origin = window.location.origin;
        const { data, error } = await supabase.functions.invoke('create-checkout-session', {
          body: {
            plan_id: sub.plan_id,
            billing_cycle: cycle,
            company_id: effectiveCompanyId,
            success_url: `${origin}/dashboard?checkout=success`,
            cancel_url: `${origin}/dashboard?checkout=cancelled`,
          },
        });
        if (error) throw error;
        if (!data?.url) throw new Error(data?.error || 'No checkout URL returned');
        window.location.href = data.url;
        return;
      }

      // No plan selected yet — force them to pick a tier first.
      if (sub?.billing_cycle === 'annual' || sub?.billing_cycle === 'monthly') {
        setBillingCycle(sub.billing_cycle);
      }
      setShowChangePlan(true);
      toast({
        title: 'Choose a plan',
        description: 'Pick a tier below, then click Update Payment Method again to continue to Stripe.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.message || 'Failed to open payment setup.',
        variant: 'destructive',
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const voidPendingDeletionIfAny = async () => {
    if (!hasPendingDeletion || !pendingRequestId) return;
    try {
      await supabase.from('company_deletion_requests').delete().eq('id', pendingRequestId);
      setHasPendingDeletion(false);
      setPendingRequestId(null);
      toast({ title: 'Deletion request voided', description: 'Your pending account deletion request was cancelled because you selected a new plan.' });
    } catch (err) {
      console.warn('Failed to void pending deletion request', err);
    }
  };

  const handleConfirmPlanChange = async () => {
    if (!selectedPlanId || !effectiveCompanyId) return;
    setCheckoutLoading(true);
    try {
      const selectedPlan = plans.find(p => p.id === selectedPlanId);
      const hasFreePeriod = selectedPlan?.free_period_months != null && selectedPlan.free_period_months > 0;

      if (hasFreePeriod) {
        // For free trial plans, update directly in DB
        const expiresAt = new Date(Date.now() + (selectedPlan!.free_period_months! * 30 * 24 * 60 * 60 * 1000)).toISOString();
        await supabase.from('company_subscriptions')
          .update({ status: 'cancelled' })
          .eq('company_id', effectiveCompanyId)
          .eq('status', 'active');

        await supabase.from('company_subscriptions').insert({
          company_id: effectiveCompanyId,
          plan_id: selectedPlanId,
          billing_cycle: billingCycle,
          status: 'trial',
          expires_at: expiresAt,
          discount_code_id: appliedDiscount?.id || null,
        });

        await supabase.from('companies').update({
          subscription_status: 'trial',
          subscription_ends_at: expiresAt,
        }).eq('id', effectiveCompanyId);

        toast({ title: 'Plan Changed', description: `Switched to ${selectedPlan!.display_name} with free trial.` });
        await voidPendingDeletionIfAny();
        setShowChangePlan(false);
      } else {
        // For paid plans, redirect to Stripe Checkout
        const { data, error } = await supabase.functions.invoke('create-checkout-session', {
          body: {
            plan_id: selectedPlanId,
            billing_cycle: billingCycle,
            discount_code_id: appliedDiscount?.id || null,
            company_id: effectiveCompanyId,
          },
        });
        if (error) throw error;
        if (data?.url) {
          window.open(data.url, '_blank');
          toast({ title: 'Stripe Checkout', description: 'Complete your plan change in the new tab.' });
          await voidPendingDeletionIfAny();
        }
        setShowChangePlan(false);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to change plan.', variant: 'destructive' });
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (isGuestGC) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Subscription
          </CardTitle>
          <CardDescription>Your account plan details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
            <p className="text-lg font-semibold text-foreground">
              Guest Account — Free, up to {guestMaxProjects ?? '—'} projects included
            </p>
          </div>
          <div className="pt-2 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Your account is currently on the free Guest plan. To upgrade to a full General Contractor account with unlimited projects and team management, choose a plan below.
            </p>
          </div>

          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setShowChangePlan(!showChangePlan)}>
              {showChangePlan ? 'Hide Plans' : 'Change Plan'}
            </Button>
          </div>

          {showChangePlan && (
            <div className="pt-4 border-t border-border space-y-4">
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
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      billingCycle === 'annual'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Annually
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                        isSelected ? 'border-primary shadow-md' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div className={`px-3 py-2 text-center ${isSelected ? 'bg-primary' : 'bg-primary/80'}`}>
                        <h3 className="font-bold text-primary-foreground text-xs uppercase tracking-wide">{plan.display_name}</h3>
                        {hasFreePeriod && <span className="text-xs text-primary-foreground/80">{freePeriodLabel}</span>}
                      </div>
                      <div className="p-3 text-center bg-card">
                        <span className="text-2xl font-bold text-foreground">${price}</span>
                        <p className="text-xs text-muted-foreground">
                          {isFree ? `Free for ${freePeriodLabel || '3 months'}` : 'USD / per month'}
                        </p>
                        <div className="mt-2 pt-2 border-t border-border space-y-1 text-left">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-primary shrink-0" />
                            <span>{plan.max_projects} projects</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-primary shrink-0" />
                            <span>{plan.max_users} users</span>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="mt-2">
                            <span className="inline-flex items-center gap-1 text-primary text-xs font-medium">
                              <CheckCircle className="h-3 w-3" /> Selected
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedPlanId && (
                <Button className="w-full" onClick={handleConfirmPlanChange} disabled={checkoutLoading}>
                  {checkoutLoading ? 'Processing...' : 'Confirm Plan Change'}
                </Button>
              )}

              <div className="pt-4 border-t border-border">
                {hasPendingDeletion ? (
                  <div className="space-y-3">
                    <p className="text-sm text-destructive font-medium text-center">
                      {t('company.cancelRequestAlreadyPending')}
                    </p>
                    <p className="text-xs text-muted-foreground text-center">
                      Selecting a new plan above within the 72-hour window will void this deletion request and keep your account active.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full border-primary text-primary hover:bg-primary/10"
                      disabled={cancelLoading}
                      onClick={async () => {
                        if (!pendingRequestId) return;
                        setCancelLoading(true);
                        try {
                          const { error } = await supabase
                            .from('company_deletion_requests')
                            .delete()
                            .eq('id', pendingRequestId);
                          if (error) throw error;
                          setHasPendingDeletion(false);
                          setPendingRequestId(null);
                          toast({ title: t('company.renewSuccess'), description: t('company.renewSuccessDesc') });
                        } catch (err: any) {
                          toast({ title: 'Error', description: err.message, variant: 'destructive' });
                        } finally {
                          setCancelLoading(false);
                        }
                      }}
                    >
                      {cancelLoading ? t('onboarding.processing') : t('company.renewAccount')}
                    </Button>
                  </div>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full" disabled={cancelLoading}>
                        {cancelLoading ? t('onboarding.processing') : t('company.deleteAccount')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('company.deleteAccountConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('company.deleteAccountConfirmDesc')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleRequestCancellation}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('company.deleteAccountConfirmSubmit')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Current Subscription
        </CardTitle>
        <CardDescription>
          Manage your subscription and billing details
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">Status</Label>
            <p className="font-medium capitalize">{company?.subscription_status || 'Trial'}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Ends At</Label>
            <p className="font-medium">{formatDate(company?.subscription_ends_at || null)}</p>
          </div>
        </div>
        
        <div className="pt-4 border-t border-border">
          <Label className="text-muted-foreground">Payment Method</Label>
          <p className="text-sm text-muted-foreground mt-1">
            {company?.subscription_status === 'active' ? 'Managed through Stripe' : 'No payment method on file'}
          </p>
        </div>

        {/* Discount Code Section */}
        <div className="pt-4 border-t border-border space-y-2">
          <Label className="flex items-center gap-1">
            <Tag className="h-4 w-4" />
            Discount Code
          </Label>
          <div className="flex gap-2">
            <Input
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
              <Button variant="outline" disabled={!discountCode.trim() || discountLoading} onClick={handleApplyDiscount}>
                {discountLoading ? 'Checking...' : 'Apply'}
              </Button>
            )}
          </div>
          {appliedDiscount && (
            <p className="text-sm text-primary font-medium">
              ✓ Code "{appliedDiscount.code}" applied
              {appliedDiscount.discount_percent ? ` — ${appliedDiscount.discount_percent}% off` : ''}
              {appliedDiscount.discount_amount ? ` — $${appliedDiscount.discount_amount} off` : ''}
            </p>
          )}
        </div>
        
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleUpdatePaymentMethod} disabled={checkoutLoading}>
            {checkoutLoading ? 'Opening...' : 'Update Payment Method'}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setShowChangePlan(!showChangePlan)}>
            {showChangePlan ? 'Hide Plans' : 'Change Plan'}
          </Button>
        </div>

        {/* Plan Selection */}
        {showChangePlan && (
          <div className="pt-4 border-t border-border space-y-4">
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
                  Monthly
                </button>
                <button
                  onClick={() => setBillingCycle('annual')}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    billingCycle === 'annual'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Annually
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary shadow-md'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className={`px-3 py-2 text-center ${isSelected ? 'bg-primary' : 'bg-primary/80'}`}>
                      <h3 className="font-bold text-primary-foreground text-xs uppercase tracking-wide">
                        {plan.display_name}
                      </h3>
                      {hasFreePeriod && (
                        <span className="text-xs text-primary-foreground/80">{freePeriodLabel}</span>
                      )}
                    </div>
                    <div className="p-3 text-center bg-card">
                      <span className="text-2xl font-bold text-foreground">${price}</span>
                      <p className="text-xs text-muted-foreground">
                        {isFree ? `Free for ${freePeriodLabel || '3 months'}` : 'USD / per month'}
                      </p>
                      <div className="mt-2 pt-2 border-t border-border space-y-1 text-left">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check className="h-3 w-3 text-primary shrink-0" />
                          <span>{plan.max_projects} projects</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Check className="h-3 w-3 text-primary shrink-0" />
                          <span>{plan.max_users} users</span>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="mt-2">
                          <span className="inline-flex items-center gap-1 text-primary text-xs font-medium">
                            <CheckCircle className="h-3 w-3" /> Selected
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedPlanId && (
              <Button className="w-full" onClick={handleConfirmPlanChange} disabled={checkoutLoading}>
                {checkoutLoading ? 'Processing...' : 'Confirm Plan Change'}
              </Button>
            )}
          </div>
        )}

        {/* Delete / Renew Account in Change Plan section */}
        {showChangePlan && (isMOA || isAccountHolder || !!impersonatedUserId) && (
          <div className="pt-4 border-t border-border">
            {hasPendingDeletion ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium text-center">
                  {t('company.cancelRequestAlreadyPending')}
                </p>
                <Button
                  variant="outline"
                  className="w-full border-primary text-primary hover:bg-primary/10"
                  disabled={cancelLoading}
                  onClick={async () => {
                    if (!pendingRequestId) return;
                    setCancelLoading(true);
                    try {
                      const { error } = await supabase
                        .from('company_deletion_requests')
                        .delete()
                        .eq('id', pendingRequestId);
                      if (error) throw error;
                      setHasPendingDeletion(false);
                      setPendingRequestId(null);
                      toast({ title: t('company.renewSuccess'), description: t('company.renewSuccessDesc') });
                    } catch (err: any) {
                      toast({ title: 'Error', description: err.message, variant: 'destructive' });
                    } finally {
                      setCancelLoading(false);
                    }
                  }}
                >
                  {cancelLoading ? t('onboarding.processing') : t('company.renewAccount')}
                </Button>
              </div>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full" disabled={cancelLoading}>
                    {cancelLoading ? t('onboarding.processing') : t('company.deleteAccount')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('company.deleteAccountConfirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('company.deleteAccountConfirmDesc')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleRequestCancellation}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t('company.deleteAccountConfirmSubmit')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ManageCompanyModal = ({ open, onOpenChange, impersonatedUser, pendingJoinCount = 0, onJoinRequestsChanged, onProjectsChanged, visibleProjectIds }: ManageCompanyModalProps) => {
  const { profile, isMOA: authIsMOA, isAccountHolder, permissionLevel, rolesLoading, userRole } = useAuth();
  const { t } = useLanguage();
  const isMobileView = useIsMobile();
  const mobileTabClass = isMobileView ? 'flex-shrink-0 whitespace-nowrap px-3 text-sm' : '';
  const effectiveCompanyId = impersonatedUser?.company_id || profile?.company_id;
  const visibleProjectIdSet = visibleProjectIds ? new Set(visibleProjectIds) : null;
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyTrade, setCompanyTrade] = useState('');
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [pendingJoinRequest, setPendingJoinRequest] = useState<{ id: string; company_name: string } | null>(null);
  
  // Projects tab state
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [canManageProjects, setCanManageProjects] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAddress, setNewProjectAddress] = useState('');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [connectionCode, setConnectionCode] = useState('');
  const [connectedSubs, setConnectedSubs] = useState<{ id: string; name: string; share_schedule: boolean }[]>([]);
  const [showConnectedSubs, setShowConnectedSubs] = useState(false);
  const [loadingConnectedSubs, setLoadingConnectedSubs] = useState(false);
  const [usage, setUsage] = useState<CompanyUsage | null>(null);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Load usage whenever modal opens or company changes
  useEffect(() => {
    if (open && effectiveCompanyId) {
      fetchCompanyUsage(effectiveCompanyId).then(setUsage);
    }
  }, [open, effectiveCompanyId, projects.length]);

  const openBillingPortal = async () => {
    if (!effectiveCompanyId) return;
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-customer-portal', {
        body: { company_id: effectiveCompanyId },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No portal URL returned');
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: 'Unable to open billing portal', description: e?.message || 'Please subscribe first.', variant: 'destructive' });
    } finally {
      setPortalLoading(false);
    }
  };

  useEffect(() => {
    const fetchCompany = async () => {
      if (!effectiveCompanyId) return;
      
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', effectiveCompanyId)
        .single();
      
      if (error) {
        console.error('Error fetching company:', error);
        return;
      }
      
      setCompany(data);
      setCompanyName(data.name);
      setCompanyAddress(data.address || '');
      setCompanyTrade((data as any).trade || '');
    };

    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*');

      if (error) {
        console.error('Error fetching projects:', error);
        return;
      }
      const aliases = await fetchAliasesForCompany(effectiveCompanyId);
      let rows = applyAliasesToProjects((data || []) as Project[], aliases, effectiveCompanyId);
      if (visibleProjectIdSet) {
        rows = rows.filter(p => visibleProjectIdSet.has(p.id));
      }
      setProjects(rows);
    };

    const checkPermission = async () => {
      const { data, error } = await supabase.rpc('can_manage_projects');
      if (!error && data !== null) {
        setCanManageProjects(data);
      }
    };

    if (open) {
      fetchCompany();
      fetchProjects();
      checkPermission();
    }
  }, [open, effectiveCompanyId]);

  // Update selected project details when selection changes
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== 'create') {
      const project = projects.find(p => p.id === selectedProjectId);
      if (project) {
        setSelectedProject(project);
        setProjectName(project.name);
        setProjectAddress(project.address || '');
        setShowCreateProject(false);
      }
    } else if (selectedProjectId === 'create') {
      setSelectedProject(null);
      setShowCreateProject(true);
    } else {
      setSelectedProject(null);
      setShowCreateProject(false);
    }
  }, [selectedProjectId, projects]);

  const handleSaveCompany = async () => {
    if (!company) return;
    
    setIsLoading(true);
    try {
      const payload: Record<string, any> = {
        name: companyName,
        address: companyAddress,
      };
      if (authIsMOA && company.company_type === 'sub') {
        payload.trade = companyTrade || null;
      }
      const { error } = await supabase
        .from('companies')
        .update(payload)
        .eq('id', company.id);
      
      if (error) throw error;
      
      toast({
        title: "Company Updated",
        description: "Company information has been updated successfully.",
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

  const handleSaveProject = async () => {
    if (!selectedProject || !effectiveCompanyId) return;

    setIsLoading(true);
    try {
      // Per-company alias: every edit creates/updates the caller's alias row.
      // The canonical projects row is never mutated from this form, so a
      // rename or address change only affects the company doing the edit.
      const { error } = await supabase
        .from('project_aliases')
        .upsert(
          {
            project_id: selectedProject.id,
            company_id: effectiveCompanyId,
            name: projectName,
            address: projectAddress || null,
          },
          { onConflict: 'project_id,company_id' },
        );

      if (error) throw error;

      setProjects(prev => prev.map(p =>
        p.id === selectedProject.id
          ? { ...p, name: projectName, address: projectAddress }
          : p
      ));
      onProjectsChanged?.();

      toast({
        title: "Project Updated",
        description: "Project information has been updated for your account. Other connected companies will continue to see the name they set.",
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

  const handleCreateProject = async () => {
    if (!newProjectName || !effectiveCompanyId || !canManageProjects) return;

    // Pre-check plan limit
    const fresh = await fetchCompanyUsage(effectiveCompanyId);
    setUsage(fresh);
    if (isAtProjectLimit(fresh)) {
      setLimitDialogOpen(true);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: newProjectName,
          address: newProjectAddress,
          company_id: effectiveCompanyId,
        })
        .select()
        .single();

      if (error) {
        if (detectLimitError(error) === 'project') {
          setLimitDialogOpen(true);
          return;
        }
        throw error;
      }

      setProjects(prev => [...prev, data]);
      setNewProjectName('');
      setNewProjectAddress('');
      setSelectedProjectId(data.id);
      setShowCreateProject(false);
      onProjectsChanged?.();

      toast({
        title: "Project Created",
        description: `Project "${data.name}" created successfully. Connection code: ${data.connection_code}`,
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

  const handleDeleteProject = async () => {
    if (!selectedProject || !canManageProjects) return;

    setIsLoading(true);
    try {
      // Clean up any per-company aliases before removing the canonical row.
      await supabase
        .from('project_aliases')
        .delete()
        .eq('project_id', selectedProject.id);

      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', selectedProject.id);

      if (error) throw error;

      setProjects(prev => prev.filter(p => p.id !== selectedProject.id));
      setSelectedProjectId('');
      setSelectedProject(null);
      onProjectsChanged?.();

      toast({
        title: "Project Deleted",
        description: "Project has been deleted successfully.",
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

  const handleDisconnectProject = async () => {
    if (!selectedProject || !effectiveCompanyId || !canManageProjects) return;
    
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('project_connections')
        .delete()
        .eq('project_id', selectedProject.id)
        .eq('sub_company_id', effectiveCompanyId);
      
      if (error) throw error;
      
      // Refetch projects
      const { data } = await supabase.from('projects').select('*');
      const rows = (data || []) as Project[];
      setProjects(visibleProjectIdSet ? rows.filter(p => visibleProjectIdSet.has(p.id)) : rows);
      setSelectedProjectId('');
      setSelectedProject(null);
      onProjectsChanged?.();
      
      
      toast({
        title: "Disconnected",
        description: "You have been disconnected from the project.",
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

  const handleDisconnectSubcontractor = async (subCompanyId: string) => {
    if (!selectedProject || !canManageProjects) return;
    
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('project_connections')
        .delete()
        .eq('project_id', selectedProject.id)
        .eq('sub_company_id', subCompanyId);
      
      if (error) throw error;
      
      // Update local state to remove the disconnected sub
      setConnectedSubs(prev => prev.filter(sub => sub.id !== subCompanyId));
      
      toast({
        title: "Subcontractor Disconnected",
        description: "The subcontractor has been disconnected from this project.",
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

  const handleConnectProject = async () => {
    if (!connectionCode || !effectiveCompanyId) return;
    
    setIsLoading(true);
    try {
      // Use the new function that bypasses RLS for connection code lookup
      const { data: project, error: projectError } = await supabase
        .rpc('get_project_by_connection_code', { p_code: connectionCode })
        .maybeSingle();
      
      if (projectError || !project) {
        toast({
          title: "Error",
          description: "Invalid connection code",
          variant: "destructive",
        });
        return;
      }
      
      const { error } = await supabase
        .from('project_connections')
        .insert({ project_id: project.id, sub_company_id: effectiveCompanyId });
      
      if (error) {
        if (error.code === '23505') {
          toast({
            title: "Already connected",
            description: "You are already connected to this project",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }
      
      // Refetch projects
      const { data } = await supabase.from('projects').select('*');
      const rows2 = (data || []) as Project[];
      setProjects(visibleProjectIdSet ? rows2.filter(p => visibleProjectIdSet.has(p.id)) : rows2);
      setConnectionCode('');
      
      toast({
        title: "Connected!",
        description: `You are now connected to "${project.name}"`,
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

  const handleCopyCode = () => {
    if (selectedProject?.connection_code) {
      navigator.clipboard.writeText(selectedProject.connection_code);
      toast({
        title: "Copied!",
        description: "Connection code copied to clipboard.",
      });
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const isGC = company?.company_type === 'gc';
  const isGuestGC = company?.is_guest === true;
  const isSub = company?.company_type === 'sub';
  const isMOA = authIsMOA;
  const isOwner = selectedProject?.company_id === effectiveCompanyId;
  const isImpersonating = !!impersonatedUser?.user_id;
  const canSeeBillingAndCompanyInfo = isMOA || isAccountHolder || isImpersonating;
  // 'full' admins can open this modal (Team + Projects only). partial and below cannot.
  const canOpenModal = isGuestGC || canSeeBillingAndCompanyInfo || permissionLevel === 'full';
  const canSeeConnectedContractors = isSub && (isMOA || isAccountHolder || permissionLevel === 'full' || isImpersonating);

  // Onboarding intro (fires once per user on first open of Manage My Company Account)
  const { loaded: flagsLoaded, hasSeen, markSeen } = useTooltipFlags();
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    if (open && flagsLoaded && !hasSeen('manage_company_intro') && canOpenModal) {
      setIntroOpen(true);
    }
  }, [open, flagsLoaded, canOpenModal]);
  const introItems: IntroItem[] = (() => {
    const items: IntroItem[] = [];
    if (canSeeBillingAndCompanyInfo || isGuestGC) {
      items.push({ label: 'Company Info', copy: 'Update your core business details, including your company name and primary address.' });
      items.push({ label: 'Billing', copy: isGuestGC
        ? 'You are currently utilizing a Guest Account. Keep an eye on your usage limits here. Guests are limited to the projects and employees included in the guest plan.'
        : 'Manage your active subscription plan, view your plan limits (projects and employees), and update your payment method or add discount codes.' });
    }
    // Team tab — always visible in this modal
    if (isAccountHolder || permissionLevel === 'full' || isMOA) {
      items.push({ label: 'Team', copy: 'Add new employee profiles, assign exact permission levels (from Basic to Admin), bulk-assign personnel to projects, or download timesheets. Create individual profiles or save time by bulk-importing your team using an Excel/CSV file or by uploading an image (OCR).' });
    } else if (permissionLevel === 'partial') {
      items.push({ label: 'Team', copy: 'View your team roster and manage project assignments.' });
    }
    items.push({ label: 'Projects', copy: 'Create brand new projects from scratch, or enter a connection code provided by another contractor to seamlessly link your schedules.' });
    if (canSeeConnectedContractors) {
      items.push({ label: 'Connected Contractors', copy: 'Link your subcontractor company with other subcontractors you regularly work with (like a flooring vendor and their install crew). Search SSAA to connect, or invite a company that isn\'t on SSAA yet. Once connected, the Main Contractor can assign the Subcontractor to specific projects and share their availability onto the project schedule.' });
    }
    return items;
  })();
  // Treat auth as still hydrating when a company-backed user's role row hasn't
  // resolved yet (post-signup race). Don't auto-close in that window — the
  // realtime user_roles subscription in AuthContext will reconcile shortly.
  const authHydrating = rolesLoading || (!!profile?.company_id && !userRole && !isMOA);

  // Bounce users who shouldn't see this modal at all (partial / level_1 / basic).
  useEffect(() => {
    if (open && !canOpenModal && !authHydrating) {
      onOpenChange(false);
    }
  }, [open, canOpenModal, authHydrating]);

  // Auto-open Manage Team overlay for users who land on Team tab by default
  useEffect(() => {
    if (open && !isGuestGC && !canSeeBillingAndCompanyInfo) {
      setProfilesModalOpen(true);
    }
  }, [open, isGuestGC, canSeeBillingAndCompanyInfo]);

  // Fetch live guest plan settings so the displayed project limit stays in
  // sync with whatever operators set in Manage Subscriptions.
  const [guestMaxProjects, setGuestMaxProjects] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !isGuestGC) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('max_projects')
        .eq('name', 'guest_gc')
        .maybeSingle();
      if (!cancelled) setGuestMaxProjects(data?.max_projects ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, isGuestGC]);

  // For guest users: poll for their pending "join existing company" request
  const refreshPendingJoinRequest = async () => {
    if (!isGuestGC || !profile?.user_id) {
      setPendingJoinRequest(null);
      return;
    }
    const { data } = await supabase
      .from('company_join_requests')
      .select('id, company_id')
      .eq('user_id', profile.user_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      setPendingJoinRequest(null);
      return;
    }
    const { data: c } = await supabase
      .from('companies')
      .select('name')
      .eq('id', data.company_id)
      .maybeSingle();
    setPendingJoinRequest({ id: data.id, company_name: c?.name || '' });
  };
  useEffect(() => {
    if (!open) return;
    refreshPendingJoinRequest();
  }, [open, isGuestGC, profile?.user_id]);

  const handleCancelJoinRequest = async () => {
    if (!pendingJoinRequest) return;
    const { error } = await supabase
      .from('company_join_requests')
      .delete()
      .eq('id', pendingJoinRequest.id);
    if (error) {
      toast({ title: 'Failed to cancel', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Request cancelled' });
    setPendingJoinRequest(null);
  };

  // Fetch connected subcontractors when a project is selected (only for GC or MOA)
  useEffect(() => {
    const fetchConnectedSubs = async () => {
      if (!selectedProject || (!isGC && !isMOA && !isImpersonating)) {
        setConnectedSubs([]);
        return;
      }

      setLoadingConnectedSubs(true);
      try {
        const { data, error } = await supabase
          .from('project_connections')
          .select('sub_company_id, share_schedule')
          .eq('project_id', selectedProject.id);

        if (error) {
          console.error('Error fetching connected subs:', error);
          return;
        }

        if (data && data.length > 0) {
          const subCompanyIds = data
            .map(d => d.sub_company_id)
            .filter(id => id !== effectiveCompanyId);
          
          if (subCompanyIds.length === 0) {
            setConnectedSubs([]);
            return;
          }
          
          const { data: companies, error: companyError } = await supabase
            .from('companies')
            .select('id, name')
            .in('id', subCompanyIds);

          if (companyError) {
            console.error('Error fetching company names:', companyError);
            return;
          }

          const shareMap = new Map(data.map(d => [d.sub_company_id, d.share_schedule !== false]));
          setConnectedSubs((companies || []).map(c => ({ ...c, share_schedule: shareMap.get(c.id) ?? true })));
        } else {
          setConnectedSubs([]);
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoadingConnectedSubs(false);
      }
    };

    fetchConnectedSubs();
  }, [selectedProject, isGC, isMOA, isImpersonating]);

  return (
    <>
      <ManageCompanyIntroDialog
        open={introOpen}
        items={introItems}
        onClose={() => { setIntroOpen(false); void markSeen('manage_company_intro'); }}
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl lg:max-w-5xl w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {isGuestGC ? 'Manage My Account' : t('company.manageMyCompanyAccount')}
            </DialogTitle>
            <DialogDescription>
              {t('company.manageSettings')}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs
            defaultValue={isGuestGC ? "company" : canSeeBillingAndCompanyInfo ? "company" : "team"}
            onValueChange={(v) => { if (v === 'team') setProfilesModalOpen(true); }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <div
              className={isMobileView ? 'flex-shrink-0 w-full overflow-x-auto scrollbar-hide' : 'flex-shrink-0'}
              style={isMobileView ? { WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' } : undefined}
            >
            <TabsList className={`${
              isMobileView
                ? 'inline-flex w-max min-w-full justify-start gap-1 h-auto p-1'
                : `grid w-full ${(() => {
                    const n = (canSeeBillingAndCompanyInfo || isGuestGC ? 4 : 2) + (canSeeConnectedContractors ? 1 : 0);
                    return n === 5 ? 'grid-cols-5' : n === 4 ? 'grid-cols-4' : n === 3 ? 'grid-cols-3' : 'grid-cols-2';
                  })()}`
            }`}>
              {(canSeeBillingAndCompanyInfo || isGuestGC) && <TabsTrigger value="company" className={mobileTabClass}>{t('company.companyInfo')}</TabsTrigger>}
              {(canSeeBillingAndCompanyInfo || isGuestGC) && <TabsTrigger value="billing" className={mobileTabClass}>{t('company.billing')}</TabsTrigger>}
              <TabsTrigger value="team" className={`relative ${mobileTabClass}`}>
                {t('company.team')}
                {pendingJoinCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-destructive border-2 border-background" />
                )}
              </TabsTrigger>
              <TabsTrigger value="projects" className={mobileTabClass}>{t('company.projectsTab')}</TabsTrigger>
              {canSeeConnectedContractors && (
                <AnchoredFirstClickTip
                  tipKey="connected_contractors_tab"
                  copy="Manage connections to other subcontractors you regularly work with. Search SSAA to connect, invite companies not yet on SSAA, then assign accepted connections to specific projects and choose whether their availability shares onto the project schedule."
                >
                  <TabsTrigger value="connected" className={mobileTabClass}>Connected Contractors</TabsTrigger>
                </AnchoredFirstClickTip>
              )}
            </TabsList>
            </div>
            
            <div className="flex-1 min-h-0 overflow-auto mt-2">
              <div className="pr-4">
                {(canSeeBillingAndCompanyInfo || isGuestGC) && (
                <TabsContent value="company" className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Enter company name"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="companyAddress">Address</Label>
                    <Input
                      id="companyAddress"
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      placeholder="Enter company address"
                    />
                  </div>

                  {isMOA && isSub && (
                    <div className="space-y-2">
                      <Label htmlFor="companyTrade">Trade</Label>
                      <Select value={companyTrade} onValueChange={setCompanyTrade}>
                        <SelectTrigger id="companyTrade">
                          <SelectValue placeholder="Select trade" />
                        </SelectTrigger>
                        <SelectContent>
                          {TRADES.map((tr) => (
                            <SelectItem key={tr} value={tr}>{tr}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}


                  
                  <Button onClick={handleSaveCompany} disabled={isLoading}>
                    {isLoading ? 'Saving...' : 'Save Changes'}
                  </Button>

                  {isGuestGC && (
                    <Card className="mt-6">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Building2 className="h-4 w-4" />
                          Join an Existing Company
                        </CardTitle>
                        <CardDescription>
                          Already have a company account on SSAA? Send a request to join it. The
                          main account holder of that company will need to approve.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {pendingJoinRequest ? (
                          <div className="space-y-3">
                            <div className="text-sm">
                              Request pending approval from{' '}
                              <span className="font-medium">
                                {pendingJoinRequest.company_name || 'the selected company'}
                              </span>
                              .
                            </div>
                            <Button variant="outline" onClick={handleCancelJoinRequest}>
                              Cancel Pending Request
                            </Button>
                          </div>
                        ) : (
                          <AnchoredFirstClickTip
                            tipKey="guest_upgrade"
                            copy="Need more? Upgrade to a full GC account for unlimited access, or submit a request to join an existing company's master account to collaborate."
                          >
                            <Button onClick={() => setJoinDialogOpen(true)}>
                              Join an Existing Company
                            </Button>
                          </AnchoredFirstClickTip>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                )}
                
                {(canSeeBillingAndCompanyInfo || isGuestGC) && (
                <TabsContent value="billing" className="space-y-4 py-4">
                  <BillingTab
                    company={company}
                    effectiveCompanyId={effectiveCompanyId}
                    formatDate={formatDate}
                    isMOA={isMOA}
                    isAccountHolder={isAccountHolder || false}
                    isGuestGC={isGuestGC}
                    guestMaxProjects={guestMaxProjects}
                    onCompanyDeleted={() => onOpenChange(false)}
                    impersonatedUserId={impersonatedUser?.user_id || null}
                  />
                  {(isMOA || isAccountHolder) && company?.stripe_customer_id && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Stripe Billing Portal</CardTitle>
                        <CardDescription>
                          Update your payment method, view invoices, or cancel — managed securely on Stripe.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button onClick={openBillingPortal} disabled={portalLoading} variant="outline">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {portalLoading ? 'Opening…' : 'Manage billing in Stripe'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                  {usage && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Plan usage</CardTitle>
                        <CardDescription>{usage.plan_display_name}</CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <div>Projects: <strong>{usage.project_count}</strong> / {usage.max_projects}</div>
                        <div>Employees: <strong>{usage.employee_count}</strong> / {usage.max_users}</div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                )}
                
                <TabsContent value="team" className="space-y-4 py-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        Manage Team
                      </CardTitle>
                      <CardDescription>
                        Opening team management...
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button onClick={() => setProfilesModalOpen(true)} className="w-full">
                        Open Manage Team
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="projects" className="space-y-4 py-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FolderOpen className="h-5 w-5" />
                        Project Management
                      </CardTitle>
                      <CardDescription>
                        Manage your projects, connections, and settings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Project Selector */}
                      <div className="space-y-2">
                        <Label>Select Project</Label>
                        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a project..." />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Selected Project Details */}
                      {selectedProject && (
                        <div className="space-y-4 p-4 border rounded-lg">
                          {isOwner && (
                            <>
                              <div className="space-y-2">
                                <Label>Project Name</Label>
                                <Input
                                  value={projectName}
                                  onChange={(e) => setProjectName(e.target.value)}
                                  placeholder="Enter project name"
                                  disabled={!canManageProjects}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Project Address</Label>
                                <Input
                                  value={projectAddress}
                                  onChange={(e) => setProjectAddress(e.target.value)}
                                  placeholder="Enter project address"
                                  disabled={!canManageProjects}
                                />
                              </div>
                              <Button 
                                onClick={handleSaveProject} 
                                disabled={isLoading || !canManageProjects}
                              >
                                Save Changes
                              </Button>
                            </>
                          )}

                          {/* Connected Contractors Section (GC and MOA only) */}
                          {(isGC || isMOA) && (
                            <div className="pt-4 border-t">
                              <Collapsible open={showConnectedSubs} onOpenChange={setShowConnectedSubs}>
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" className="w-full justify-between items-start gap-2 p-0 h-auto min-h-0 whitespace-normal text-left hover:bg-transparent">
                                    <span className="flex-1 min-w-0 text-sm font-medium text-left whitespace-normal break-words leading-snug">What contractors are connected to this project?</span>
                                    {showConnectedSubs ? (
                                      <ChevronUp className="h-4 w-4 shrink-0 mt-0.5" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 shrink-0 mt-0.5" />
                                    )}
                                  </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2">
                                  {loadingConnectedSubs ? (
                                    <p className="text-sm text-muted-foreground">Loading...</p>
                                  ) : connectedSubs.length > 0 ? (
                                    <div className="max-h-[200px] overflow-auto border rounded-md">
                                      <div className="space-y-1 p-2">
                                        {connectedSubs.map((sub) => (
                                          <div 
                                            key={sub.id} 
                                            className="py-2 px-2 rounded bg-muted/50 space-y-2"
                                          >
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                                <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                                <span className="text-sm min-w-0 break-words">{sub.name}</span>
                                              </div>
                                              {canManageProjects && (
                                                <AlertDialog>
                                                  <AlertDialogTrigger asChild>
                                                    <Button 
                                                      variant="ghost" 
                                                      size="sm"
                                                      className="h-7 px-2 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    >
                                                      <Unlink className="h-3 w-3 mr-1" />
                                                      Disconnect
                                                    </Button>
                                                  </AlertDialogTrigger>
                                                  <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                      <AlertDialogTitle>Disconnect Subcontractor?</AlertDialogTitle>
                                                      <AlertDialogDescription>
                                                        This will disconnect "{sub.name}" from "{selectedProject?.name}". 
                                                        They will no longer receive schedule requests for this project.
                                                      </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                      <AlertDialogAction 
                                                        onClick={() => handleDisconnectSubcontractor(sub.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                      >
                                                        Disconnect
                                                      </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                  </AlertDialogContent>
                                                </AlertDialog>
                                              )}
                                            </div>
                                            {canManageProjects && (
                                              <div className="flex items-center justify-between pl-6">
                                                <Label htmlFor={`share-${sub.id}`} className="text-xs text-muted-foreground cursor-pointer">
                                                  Share Schedule
                                                </Label>
                                                <Switch
                                                  id={`share-${sub.id}`}
                                                  checked={sub.share_schedule}
                                                  onCheckedChange={async (checked) => {
                                                    const updateData: any = { share_schedule: checked };
                                                    if (!checked) {
                                                      updateData.schedule_shared_until = new Date().toISOString();
                                                    } else {
                                                      updateData.schedule_shared_until = null;
                                                    }
                                                    await supabase
                                                      .from('project_connections')
                                                      .update(updateData)
                                                      .eq('project_id', selectedProject!.id)
                                                      .eq('sub_company_id', sub.id);
                                                    setConnectedSubs(prev => prev.map(s => s.id === sub.id ? { ...s, share_schedule: checked } : s));
                                                  }}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">
                                      No subcontractors connected to this project yet.
                                    </p>
                                  )}
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                          )}

                          {/* Connection Code (GC only) */}
                          {isOwner && selectedProject.connection_code && (
                            <div className="space-y-2 pt-4 border-t">
                              <Label>Connection Code</Label>
                              <div className="flex gap-2">
                                <Input 
                                  value={selectedProject.connection_code} 
                                  readOnly 
                                  className="font-mono"
                                />
                                <Button variant="outline" size="icon" onClick={handleCopyCode}>
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Share this code with subcontractors to connect them to this project
                              </p>
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex gap-2 pt-4 border-t">
                            {!isOwner && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    disabled={!canManageProjects}
                                    className="flex-1"
                                  >
                                    <Unlink className="h-4 w-4 mr-2" />
                                    Disconnect
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Disconnect from Project?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      You will no longer receive schedule requests for "{selectedProject.name}".
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDisconnectProject}>
                                      Disconnect
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}

                            {isOwner && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="destructive" 
                                    disabled={!canManageProjects}
                                    className="flex-1"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Project
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This action cannot be undone. This will permanently delete "{selectedProject.name}" 
                                      and all associated data including tasks and schedule requests.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction 
                                      onClick={handleDeleteProject}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>

                          {!canManageProjects && (
                            <p className="text-sm text-muted-foreground text-center">
                              You don't have permission to manage projects
                            </p>
                          )}
                        </div>
                      )}

                      {/* Connect to Project Section */}
                      <div className="space-y-2 pt-4 border-t">
                        <Label>Connect to Project</Label>
                        <div className="flex gap-2">
                          <Input
                            value={connectionCode}
                            onChange={(e) => setConnectionCode(e.target.value)}
                            placeholder="Enter connection code"
                          />
                          <Button onClick={handleConnectProject} disabled={!connectionCode || isLoading}>
                            <Link2 className="h-4 w-4 mr-2" />
                            Connect
                          </Button>
                        </div>
                      </div>

                      {/* Create Project Section */}
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                        <h4 className="font-medium">Create New Project</h4>
                        <div className="space-y-2">
                          <Label>Project Name</Label>
                          <Input
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Enter project name"
                            disabled={!canManageProjects}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Project Address</Label>
                          <Input
                            value={newProjectAddress}
                            onChange={(e) => setNewProjectAddress(e.target.value)}
                            placeholder="Enter project address"
                            disabled={!canManageProjects}
                          />
                        </div>
                        <Button 
                          onClick={handleCreateProject} 
                          disabled={isLoading || !newProjectName || !canManageProjects}
                          className="w-full"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create Project
                        </Button>
                        {!canManageProjects && (
                          <p className="text-sm text-muted-foreground text-center">
                            You don't have permission to create projects
                          </p>
                        )}
                      </div>

                    </CardContent>
                  </Card>
                </TabsContent>
                {canSeeConnectedContractors && effectiveCompanyId && (
                  <TabsContent value="connected" className="space-y-4 py-4">
                    <ConnectedContractorsTab
                      effectiveCompanyId={effectiveCompanyId}
                      canManageConnections={isMOA || isAccountHolder || permissionLevel === 'full' || isImpersonating}
                    />
                  </TabsContent>
                )}
              </div>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <ProfilesModal
        open={profilesModalOpen}
        onOpenChange={setProfilesModalOpen}
        overrideCompanyId={impersonatedUser?.company_id || undefined}
        onBack={() => { setProfilesModalOpen(false); }}
        onJoinRequestsChanged={onJoinRequestsChanged}
      />

      <JoinExistingCompanyDialog
        open={joinDialogOpen}
        onOpenChange={setJoinDialogOpen}
        guestCompanyId={effectiveCompanyId || null}
        onSubmitted={refreshPendingJoinRequest}
      />

      <PlanLimitDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        kind="project"
        planName={usage?.plan_display_name}
        current={usage?.project_count}
        max={usage?.max_projects}
      />
    </>
  );
};

export default ManageCompanyModal;