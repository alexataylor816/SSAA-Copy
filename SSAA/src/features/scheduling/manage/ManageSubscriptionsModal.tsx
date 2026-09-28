import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, Tag, Plus, Save, Trash2, Pencil, X, LayoutList, Users, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

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
  stripe_product_id: string | null;
  stripe_monthly_price_id: string | null;
  stripe_annual_price_id: string | null;
  last_synced_at: string | null;
}

interface CompanySubscription {
  id: string;
  company_id: string;
  plan_id: string;
  billing_cycle: string;
  status: string;
  started_at: string;
  expires_at: string | null;
  discount_code_id: string | null;
}

interface Company {
  id: string;
  name: string;
  company_type: string;
  subscription_status: string | null;
}

interface DiscountCode {
  id: string;
  code: string;
  description: string | null;
  discount_percent: number | null;
  discount_amount: number | null;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  current_uses: number;
  is_active: boolean;
}

interface ManageSubscriptionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

const emptyPlanForm = {
  name: '',
  display_name: '',
  monthly_price: '',
  annual_price_per_month: '',
  max_projects: '',
  max_users: '',
  sort_order: '',
  free_period_months: '',
};

const ManageSubscriptionsModal = ({ open, onOpenChange, onBack }: ManageSubscriptionsModalProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<CompanySubscription[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(false);

  // New discount code form
  const [newCode, setNewCode] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDiscountPercent, setNewDiscountPercent] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [newValidFrom, setNewValidFrom] = useState('');
  const [newValidUntil, setNewValidUntil] = useState('');
  const [showAddCode, setShowAddCode] = useState(false);

  // Edit discount code state
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [editCodeForm, setEditCodeForm] = useState({
    code: '',
    description: '',
    discount_percent: '',
    max_uses: '',
    valid_from: '',
    valid_until: '',
  });

  // Assign plan state
  const [assignCompanyId, setAssignCompanyId] = useState('');
  const [assignPlanId, setAssignPlanId] = useState('');
  const [assignBillingCycle, setAssignBillingCycle] = useState('monthly');

  // Plan CRUD state
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [showAddPlan, setShowAddPlan] = useState(false);

  // Guest plan state
  const [guestPlan, setGuestPlan] = useState<SubscriptionPlan | null>(null);
  const [guestMaxProjects, setGuestMaxProjects] = useState('5');
  const [guestMaxUsers, setGuestMaxUsers] = useState('5');
  const [guestFreePeriod, setGuestFreePeriod] = useState('unlimited');
  const [guestMonthlyCost, setGuestMonthlyCost] = useState('0');
  const [guestSaving, setGuestSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAll();
    }
  }, [open]);

  const fetchAll = async () => {
    const [plansRes, subsRes, companiesRes, codesRes] = await Promise.all([
      supabase.from('subscription_plans').select('*').order('sort_order'),
      supabase.from('company_subscriptions').select('*'),
      supabase.from('companies').select('id, name, company_type, subscription_status'),
      supabase.from('discount_codes').select('*').order('created_at', { ascending: false }),
    ]);

    if (plansRes.data) {
      setPlans(plansRes.data as unknown as SubscriptionPlan[]);
      const gp = (plansRes.data as unknown as SubscriptionPlan[]).find(p => p.name === 'guest_gc');
      if (gp) {
        setGuestPlan(gp);
        setGuestMaxProjects(String(gp.max_projects));
        setGuestMaxUsers(String((gp as any).max_users ?? 5));
        setGuestFreePeriod(gp.free_period_months == null ? 'unlimited' : String(gp.free_period_months));
        setGuestMonthlyCost(String(gp.monthly_price));
      }
    }
    if (subsRes.data) setSubscriptions(subsRes.data as unknown as CompanySubscription[]);
    if (companiesRes.data) setCompanies(companiesRes.data as unknown as Company[]);
    if (codesRes.data) setDiscountCodes(codesRes.data as unknown as DiscountCode[]);
  };

  const getPlanName = (planId: string) => {
    const plan = plans.find(p => p.id === planId);
    return plan?.display_name || 'Unknown';
  };

  const getCompanySubscription = (companyId: string) => {
    return subscriptions.find(s => s.company_id === companyId && s.status === 'active');
  };

  // --- Plan CRUD ---
  const startEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name,
      display_name: plan.display_name,
      monthly_price: String(plan.monthly_price),
      annual_price_per_month: String(plan.annual_price_per_month),
      max_projects: String(plan.max_projects),
      max_users: String(plan.max_users),
      sort_order: String(plan.sort_order),
      free_period_months: plan.free_period_months != null ? String(plan.free_period_months) : '',
    });
  };

  const cancelEditPlan = () => {
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
    setShowAddPlan(false);
  };

  const syncPlanToStripe = async (planId: string, silent = false) => {
    try {
      const { error } = await supabase.functions.invoke('upsert-stripe-plan', {
        body: { plan_id: planId },
      });
      if (error) throw error;
      if (!silent) toast({ title: 'Synced to Stripe' });
      return true;
    } catch (err: any) {
      toast({
        title: 'Stripe sync failed',
        description: err.message || 'Could not sync plan to Stripe',
        variant: 'destructive',
      });
      return false;
    }
  };

  const archivePlanInStripe = async (planId: string) => {
    try {
      const { error } = await supabase.functions.invoke('archive-stripe-plan', {
        body: { plan_id: planId },
      });
      if (error) throw error;
      return true;
    } catch (err: any) {
      toast({
        title: 'Stripe archive failed',
        description: err.message || 'Could not archive plan in Stripe',
        variant: 'destructive',
      });
      return false;
    }
  };

  const handlePushPriceToSubscribers = async (planId: string, displayName: string) => {
    if (!confirm(
      `Push the latest price to ALL active subscribers of "${displayName}"?\n\n` +
      `This breaks grandfathered pricing. Existing customers will be migrated to the new price on their next invoice.`
    )) return;
    try {
      const { error } = await supabase.functions.invoke('sync-plan-subscribers', {
        body: { plan_id: planId },
      });
      if (error) throw error;
      toast({ title: 'Subscribers migrated to new price' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleSavePlan = async () => {
    if (!planForm.name || !planForm.display_name) return;
    setLoading(true);

    const payload = {
      name: planForm.name,
      display_name: planForm.display_name,
      monthly_price: parseFloat(planForm.monthly_price) || 0,
      annual_price_per_month: parseFloat(planForm.annual_price_per_month) || 0,
      max_projects: parseInt(planForm.max_projects) || 0,
      max_users: parseInt(planForm.max_users) || 0,
      sort_order: parseInt(planForm.sort_order) || 0,
      free_period_months: planForm.free_period_months ? parseInt(planForm.free_period_months) : null,
    };

    let savedPlanId = editingPlanId;
    if (editingPlanId) {
      const { error } = await supabase
        .from('subscription_plans')
        .update(payload)
        .eq('id', editingPlanId);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setLoading(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('subscription_plans')
        .insert({ ...payload, is_active: true })
        .select('id')
        .single();
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setLoading(false);
        return;
      }
      savedPlanId = data.id;
    }

    // Auto-sync to Stripe (skip for free plans like guest_gc)
    if (savedPlanId && (payload.monthly_price > 0 || payload.annual_price_per_month > 0)) {
      await syncPlanToStripe(savedPlanId);
    } else {
      toast({ title: editingPlanId ? 'Plan updated' : 'Plan created' });
    }

    cancelEditPlan();
    fetchAll();
    setLoading(false);
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlan) => {
    const nextActive = !plan.is_active;
    const { error } = await supabase
      .from('subscription_plans')
      .update({ is_active: nextActive })
      .eq('id', plan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    if (nextActive) {
      await syncPlanToStripe(plan.id, true);
    } else if (plan.stripe_product_id) {
      await archivePlanInStripe(plan.id);
    }
    fetchAll();
  };

  const handleDeletePlan = async (plan: SubscriptionPlan) => {
    if (!confirm(
      `Delete plan "${plan.display_name}"?\n\n` +
      `The Stripe product will be archived (not deleted). Existing subscribers will keep billing at their current price until they cancel or are migrated.`
    )) return;

    if (plan.stripe_product_id) {
      await archivePlanInStripe(plan.id);
    }
    const { error } = await supabase
      .from('subscription_plans')
      .delete()
      .eq('id', plan.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Plan deleted' });
      fetchAll();
    }
  };

  // --- Existing handlers ---
  const handleAssignPlan = async () => {
    if (!assignCompanyId || !assignPlanId) return;
    setLoading(true);
    const existing = subscriptions.find(s => s.company_id === assignCompanyId && s.status === 'active');
    if (existing) {
      await supabase.from('company_subscriptions').update({ status: 'cancelled' }).eq('id', existing.id);
    }
    const { error } = await supabase.from('company_subscriptions').insert({
      company_id: assignCompanyId, plan_id: assignPlanId, billing_cycle: assignBillingCycle, status: 'active',
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      // Trigger Stripe sync
      try {
        await supabase.functions.invoke('update-stripe-subscription', {
          body: { company_id: assignCompanyId },
        });
      } catch (syncErr) {
        console.error('Stripe sync error:', syncErr);
      }
      toast({ title: 'Plan assigned successfully' });
      setAssignCompanyId(''); setAssignPlanId('');
      fetchAll();
    }
    setLoading(false);
  };

  const handleCancelSubscription = async (subId: string, companyId: string) => {
    const { error } = await supabase.from('company_subscriptions').update({ status: 'cancelled' }).eq('id', subId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      // Trigger Stripe sync
      try {
        await supabase.functions.invoke('update-stripe-subscription', {
          body: { company_id: companyId },
        });
      } catch (syncErr) {
        console.error('Stripe sync error:', syncErr);
      }
      toast({ title: 'Subscription cancelled' }); fetchAll();
    }
  };

  const handleCreateDiscountCode = async () => {
    if (!newCode) return;
    setLoading(true);
    const { error } = await supabase.from('discount_codes').insert({
      code: newCode.toUpperCase(), description: newDescription || null,
      discount_percent: newDiscountPercent ? parseFloat(newDiscountPercent) : null,
      max_uses: newMaxUses ? parseInt(newMaxUses) : null, is_active: true,
      valid_from: newValidFrom ? new Date(newValidFrom).toISOString() : null,
      valid_until: newValidUntil ? new Date(newValidUntil).toISOString() : null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Discount code created' });
      setNewCode(''); setNewDescription(''); setNewDiscountPercent(''); setNewMaxUses('');
      setNewValidFrom(''); setNewValidUntil('');
      setShowAddCode(false); fetchAll();
    }
    setLoading(false);
  };

  const startEditCode = (code: DiscountCode) => {
    setEditingCodeId(code.id);
    setEditCodeForm({
      code: code.code,
      description: code.description || '',
      discount_percent: code.discount_percent != null ? String(code.discount_percent) : '',
      max_uses: code.max_uses != null ? String(code.max_uses) : '',
      valid_from: code.valid_from ? code.valid_from.slice(0, 10) : '',
      valid_until: code.valid_until ? code.valid_until.slice(0, 10) : '',
    });
  };

  const handleSaveCodeEdit = async () => {
    if (!editingCodeId || !editCodeForm.code) return;
    setLoading(true);
    const { error } = await supabase.from('discount_codes').update({
      code: editCodeForm.code.toUpperCase(),
      description: editCodeForm.description || null,
      discount_percent: editCodeForm.discount_percent ? parseFloat(editCodeForm.discount_percent) : null,
      max_uses: editCodeForm.max_uses ? parseInt(editCodeForm.max_uses) : null,
      valid_from: editCodeForm.valid_from ? new Date(editCodeForm.valid_from).toISOString() : null,
      valid_until: editCodeForm.valid_until ? new Date(editCodeForm.valid_until).toISOString() : null,
    }).eq('id', editingCodeId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Discount code updated' });
      setEditingCodeId(null);
      fetchAll();
    }
    setLoading(false);
  };

  const handleToggleCode = async (code: DiscountCode) => {
    const { error } = await supabase.from('discount_codes').update({ is_active: !code.is_active }).eq('id', code.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); } else { fetchAll(); }
  };

  const handleDeleteCode = async (codeId: string) => {
    const { error } = await supabase.from('discount_codes').delete().eq('id', codeId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); } else { toast({ title: 'Discount code deleted' }); fetchAll(); }
  };

  const formatValidity = (from: string | null, until: string | null) => {
    if (!from && !until) return '—';
    const fmt = (s: string) => format(new Date(s), 'MMM d, yyyy');
    if (from && until) return `${fmt(from)} → ${fmt(until)}`;
    if (until) return `Until ${fmt(until)}`;
    return `From ${fmt(from!)}`;
  };

  const handleSaveGuestPlan = async () => {
    if (!guestPlan) return;
    setGuestSaving(true);
    try {
      const { error } = await supabase
        .from('subscription_plans')
        .update({
          max_projects: parseInt(guestMaxProjects) || 5,
          max_users: parseInt(guestMaxUsers) || 5,
          free_period_months: guestFreePeriod === 'unlimited' ? null : parseInt(guestFreePeriod),
          monthly_price: parseFloat(guestMonthlyCost) || 0,
          annual_price_per_month: parseFloat(guestMonthlyCost) || 0,
        })
        .eq('id', guestPlan.id);
      if (error) throw error;
      toast({ title: 'Guest plan updated successfully' });
      fetchAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setGuestSaving(false);
    }
  };

  // Plan form row component
  const PlanFormRow = () => (
    <div className="border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold">{editingPlanId ? 'Edit Plan' : 'Create New Plan'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Internal Name</Label>
          <Input value={planForm.name} onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. tier_1" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <Input value={planForm.display_name} onChange={e => setPlanForm(f => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Tier 1" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Monthly Price ($)</Label>
          <Input type="number" value={planForm.monthly_price} onChange={e => setPlanForm(f => ({ ...f, monthly_price: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Annual Price/mo ($)</Label>
          <Input type="number" value={planForm.annual_price_per_month} onChange={e => setPlanForm(f => ({ ...f, annual_price_per_month: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max Projects</Label>
          <Input type="number" value={planForm.max_projects} onChange={e => setPlanForm(f => ({ ...f, max_projects: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max Users</Label>
          <Input type="number" value={planForm.max_users} onChange={e => setPlanForm(f => ({ ...f, max_users: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sort Order</Label>
          <Input type="number" value={planForm.sort_order} onChange={e => setPlanForm(f => ({ ...f, sort_order: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Free Period (months)</Label>
          <Select value={planForm.free_period_months || 'none'} onValueChange={v => setPlanForm(f => ({ ...f, free_period_months: v === 'none' ? '' : v }))}>
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <SelectItem key={m} value={String(m)}>
                  {m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleSavePlan} disabled={loading || !planForm.name || !planForm.display_name}>
          <Save className="h-4 w-4 mr-2" />
          {editingPlanId ? 'Save Changes' : 'Create Plan'}
        </Button>
        <Button variant="outline" onClick={cancelEditPlan}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { onOpenChange(false); onBack(); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{t('subscriptions.title')}</DialogTitle>
          </div>
        </DialogHeader>

        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="plans" className="flex items-center gap-2">
              <LayoutList className="h-4 w-4" />
              Subscriptions
            </TabsTrigger>
            <TabsTrigger value="user-subscriptions" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              User Subscriptions
            </TabsTrigger>
            <TabsTrigger value="discounts" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Discount Codes
            </TabsTrigger>
            <TabsTrigger value="guest-accounts" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Guest Accounts
            </TabsTrigger>
          </TabsList>

          {/* Subscriptions (Plan CRUD) Tab */}
          <TabsContent value="plans">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4 p-2">
                {(showAddPlan || editingPlanId) ? (
                  <PlanFormRow />
                ) : (
                  <Button onClick={() => { setShowAddPlan(true); setPlanForm(emptyPlanForm); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Plan
                  </Button>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Monthly</TableHead>
                      <TableHead>Annual/mo</TableHead>
                      <TableHead>Projects</TableHead>
                      <TableHead>Users</TableHead>
                      <TableHead>Free Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No plans found</TableCell>
                      </TableRow>
                    ) : (
                      plans.map(plan => (
                        <TableRow key={plan.id}>
                          <TableCell className="font-medium">{plan.display_name}</TableCell>
                          <TableCell>${plan.monthly_price}</TableCell>
                          <TableCell>${plan.annual_price_per_month}</TableCell>
                          <TableCell>{plan.max_projects}</TableCell>
                          <TableCell>{plan.max_users}</TableCell>
                          <TableCell className="text-xs">
                            {plan.free_period_months
                              ? plan.free_period_months === 12
                                ? '1 year'
                                : `${plan.free_period_months} mo`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                                {plan.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {plan.last_synced_at
                                  ? `Synced ${format(new Date(plan.last_synced_at), 'MMM d')}`
                                  : 'Not synced'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 flex-wrap">
                              <Switch checked={plan.is_active} onCheckedChange={() => handleTogglePlanActive(plan)} />
                              <Button variant="ghost" size="icon" onClick={() => startEditPlan(plan)} title="Edit">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => syncPlanToStripe(plan.id)}
                                title="Resync to Stripe"
                                className="text-xs"
                              >
                                Resync
                              </Button>
                              {plan.stripe_product_id && (plan.monthly_price > 0 || plan.annual_price_per_month > 0) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handlePushPriceToSubscribers(plan.id, plan.display_name)}
                                  title="Push new price to existing subscribers (breaks grandfathering)"
                                  className="text-xs text-destructive"
                                >
                                  Push price
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" onClick={() => handleDeletePlan(plan)} title="Delete">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* User Subscriptions Tab */}
          <TabsContent value="user-subscriptions">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4 p-2">
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold">Assign Plan to Company</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Company</Label>
                      <Select value={assignCompanyId} onValueChange={setAssignCompanyId}>
                        <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                        <SelectContent>
                          {companies.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Plan</Label>
                      <Select value={assignPlanId} onValueChange={setAssignPlanId}>
                        <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                        <SelectContent>
                          {plans.filter(p => p.is_active).map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.display_name} - ${p.monthly_price}/mo
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Billing</Label>
                      <div className="flex gap-2">
                        <Select value={assignBillingCycle} onValueChange={setAssignBillingCycle}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="annual">Annual</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button onClick={handleAssignPlan} disabled={loading || !assignCompanyId || !assignPlanId} size="sm">
                          Assign
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.map(company => {
                      const sub = getCompanySubscription(company.id);
                      return (
                        <TableRow key={company.id}>
                          <TableCell className="font-medium">{company.name}</TableCell>
                          <TableCell>{sub ? getPlanName(sub.plan_id) : 'No plan'}</TableCell>
                          <TableCell>{sub?.billing_cycle || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={sub?.status === 'active' ? 'default' : 'secondary'}>
                              {sub?.status || company.subscription_status || 'trial'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {sub ? format(new Date(sub.started_at), 'MMM d, yyyy') : '—'}
                          </TableCell>
                          <TableCell>
                            {sub && sub.status === 'active' && (
                              <Button variant="destructive" size="sm" onClick={() => handleCancelSubscription(sub.id, company.id)}>
                                Cancel
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Discount Codes Tab */}
          <TabsContent value="discounts">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4 p-2">
                {showAddCode ? (
                  <div className="border rounded-lg p-4 space-y-3">
                    <h3 className="font-semibold">Create Discount Code</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Code</Label>
                        <Input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="e.g. SAVE20" className="uppercase" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Discount %</Label>
                        <Input type="number" value={newDiscountPercent} onChange={e => setNewDiscountPercent(e.target.value)} placeholder="e.g. 20" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Optional description" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max Uses</Label>
                        <Input type="number" value={newMaxUses} onChange={e => setNewMaxUses(e.target.value)} placeholder="Leave empty for unlimited" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valid From</Label>
                        <Input type="date" value={newValidFrom} onChange={e => setNewValidFrom(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valid Until</Label>
                        <Input type="date" value={newValidUntil} onChange={e => setNewValidUntil(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleCreateDiscountCode} disabled={loading || !newCode}>
                        <Save className="h-4 w-4 mr-2" />Create Code
                      </Button>
                      <Button variant="outline" onClick={() => setShowAddCode(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button onClick={() => setShowAddCode(true)}>
                    <Plus className="h-4 w-4 mr-2" />Add Discount Code
                  </Button>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Uses</TableHead>
                      <TableHead>Valid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discountCodes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No discount codes created yet</TableCell>
                      </TableRow>
                    ) : (
                      discountCodes.map(code => (
                        editingCodeId === code.id ? (
                          <TableRow key={code.id}>
                            <TableCell colSpan={7}>
                              <div className="grid grid-cols-2 gap-3 p-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Code</Label>
                                  <Input value={editCodeForm.code} onChange={e => setEditCodeForm(f => ({ ...f, code: e.target.value }))} className="uppercase" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Discount %</Label>
                                  <Input type="number" value={editCodeForm.discount_percent} onChange={e => setEditCodeForm(f => ({ ...f, discount_percent: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Description</Label>
                                  <Input value={editCodeForm.description} onChange={e => setEditCodeForm(f => ({ ...f, description: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Max Uses</Label>
                                  <Input type="number" value={editCodeForm.max_uses} onChange={e => setEditCodeForm(f => ({ ...f, max_uses: e.target.value }))} placeholder="Unlimited" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Valid From</Label>
                                  <Input type="date" value={editCodeForm.valid_from} onChange={e => setEditCodeForm(f => ({ ...f, valid_from: e.target.value }))} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Valid Until</Label>
                                  <Input type="date" value={editCodeForm.valid_until} onChange={e => setEditCodeForm(f => ({ ...f, valid_until: e.target.value }))} />
                                </div>
                                <div className="col-span-2 flex gap-2">
                                  <Button size="sm" onClick={handleSaveCodeEdit} disabled={loading || !editCodeForm.code}>
                                    <Save className="h-4 w-4 mr-2" />Save
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => setEditingCodeId(null)}>
                                    <X className="h-4 w-4 mr-2" />Cancel
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          <TableRow key={code.id}>
                            <TableCell className="font-mono font-bold">{code.code}</TableCell>
                            <TableCell>
                              {code.discount_percent ? `${code.discount_percent}%` : ''}
                              {code.discount_amount ? `$${code.discount_amount}` : ''}
                            </TableCell>
                            <TableCell className="text-xs">{code.description || '—'}</TableCell>
                            <TableCell>{code.current_uses}{code.max_uses ? `/${code.max_uses}` : ''}</TableCell>
                            <TableCell className="text-xs">{formatValidity(code.valid_from, code.valid_until)}</TableCell>
                            <TableCell>
                              <Badge variant={code.is_active ? 'default' : 'secondary'}>{code.is_active ? 'Active' : 'Inactive'}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Switch checked={code.is_active} onCheckedChange={() => handleToggleCode(code)} />
                                <Button variant="ghost" size="icon" onClick={() => startEditCode(code)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteCode(code.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      ))
                    )}
                  </TableBody>
                </Table>

              </div>
            </ScrollArea>
          </TabsContent>

          {/* Guest Accounts Tab */}
          <TabsContent value="guest-accounts">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-6 p-2">
                <div className="border rounded-lg p-6 space-y-4">
                  <h3 className="font-semibold text-lg">Guest Account Plan Settings</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure the default plan for Guest accounts. This plan is not visible in standard onboarding — it is automatically assigned to guest accounts.
                  </p>

                  {guestPlan ? (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Max Projects</Label>
                        <Input
                          type="number"
                          value={guestMaxProjects}
                          onChange={(e) => setGuestMaxProjects(e.target.value)}
                          min="1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Max Users</Label>
                        <Input
                          type="number"
                          value={guestMaxUsers}
                          onChange={(e) => setGuestMaxUsers(e.target.value)}
                          min="1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Free Period</Label>
                        <Select value={guestFreePeriod} onValueChange={setGuestFreePeriod}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unlimited">Unlimited</SelectItem>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                              <SelectItem key={m} value={String(m)}>
                                {m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Monthly Cost ($)</Label>
                        <Input
                          type="number"
                          value={guestMonthlyCost}
                          onChange={(e) => setGuestMonthlyCost(e.target.value)}
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Guest plan not found. It may need to be created.</p>
                  )}

                  {guestPlan && (
                    <Button onClick={handleSaveGuestPlan} disabled={guestSaving}>
                      <Save className="h-4 w-4 mr-2" />
                      {guestSaving ? 'Saving...' : 'Save Guest Plan Settings'}
                    </Button>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ManageSubscriptionsModal;
