import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import MessagesView from '@/components/messages/MessagesView';

export default function Messages() {
  const navigate = useNavigate();
  const { user, profile, loading, isMOA } = useAuth();
  const { impersonatedUser, impersonatedCompany } = useImpersonation();
  const [projects, setProjects] = useState<{ id: string; name: string; company_id: string | null }[]>([]);
  const [effectiveCompanyType, setEffectiveCompanyType] = useState<'gc' | 'sub' | null>(null);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const impersonating = !!(impersonatedUser || impersonatedCompany);
  const effectiveUserId = impersonatedUser?.user_id ?? user?.id ?? null;
  const effectiveCompanyId =
    impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id || null;
  const suppliedCompanyType =
    impersonatedUser?.company_type ?? impersonatedCompany?.company_type ?? null;

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  useEffect(() => {
    let cancelled = false;

    if (loading) {
      setIdentityResolved(false);
      return;
    }

    if (suppliedCompanyType) {
      setEffectiveCompanyType(suppliedCompanyType);
      setIdentityError(null);
      setIdentityResolved(true);
      return;
    }

    if (!effectiveCompanyId) {
      setEffectiveCompanyType(null);
      setIdentityError(isMOA ? null : 'Your company could not be identified. Please refresh and try again.');
      setIdentityResolved(true);
      return;
    }

    setIdentityResolved(false);
    setIdentityError(null);
    supabase
      .from('companies')
      .select('company_type')
      .eq('id', effectiveCompanyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.company_type) {
          console.error('Unable to resolve messaging company type:', error);
          setEffectiveCompanyType(null);
          setIdentityError('Your company type could not be loaded. Please refresh and try again.');
        } else {
          setEffectiveCompanyType(data.company_type);
          setIdentityError(null);
        }
        setIdentityResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId, isMOA, loading, suppliedCompanyType]);

  useEffect(() => {
    if (!identityResolved || identityError) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: all } = await supabase.from('projects').select('id, name, company_id');
      const rows = ((all as any[]) || []) as { id: string; name: string; company_id: string | null }[];

      if (!effectiveCompanyId) {
        if (!cancelled) setProjects(rows);
        return;
      }

      // Scope to what this company can actually see: owned + connected (+ guest links)
      const [{ data: pcs }, { data: guest }] = await Promise.all([
        supabase.from('project_connections').select('project_id').eq('sub_company_id', effectiveCompanyId),
        supabase
          .from('guest_project_connections')
          .select('guest_company_id, sub_company_id')
          .or(`guest_company_id.eq.${effectiveCompanyId},sub_company_id.eq.${effectiveCompanyId}`),
      ]);

      const allowedProjectIds = new Set<string>(((pcs as any[]) || []).map((r) => r.project_id));

      const partnerCompanyIds = new Set<string>();
      ((guest as any[]) || []).forEach((g) => {
        if (g.guest_company_id === effectiveCompanyId) partnerCompanyIds.add(g.sub_company_id);
        if (g.sub_company_id === effectiveCompanyId) partnerCompanyIds.add(g.guest_company_id);
      });

      const visible = rows.filter(
        (p) =>
          p.company_id === effectiveCompanyId ||
          allowedProjectIds.has(p.id) ||
          (p.company_id ? partnerCompanyIds.has(p.company_id) : false),
      );
      if (!cancelled) setProjects(visible);
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId, identityResolved, identityError]);

  return (
    <MessagesView
      onBack={() => navigate('/dashboard')}
      projects={projects}
      effectiveUserId={effectiveUserId}
      effectiveCompanyId={effectiveCompanyId}
      impersonating={impersonating}
      impersonatedPermissionLevel={impersonatedUser?.permission_level ?? null}
      effectiveCompanyType={effectiveCompanyType}
      identityResolved={identityResolved}
      identityError={identityError}
    />
  );
}
