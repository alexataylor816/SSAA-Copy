import { supabase } from '@/integrations/supabase/client';

export interface CompanyUsage {
  project_count: number;
  employee_count: number;
  max_projects: number;
  max_users: number;
  plan_display_name: string;
}

export async function fetchCompanyUsage(companyId: string): Promise<CompanyUsage | null> {
  if (!companyId) return null;
  const { data, error } = await supabase.rpc('get_company_usage', { p_company_id: companyId });
  if (error) {
    console.warn('[planLimits] get_company_usage failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as CompanyUsage | null;
}

export function isAtProjectLimit(u: CompanyUsage | null): boolean {
  if (!u) return false;
  return u.project_count >= u.max_projects;
}

export function isAtEmployeeLimit(u: CompanyUsage | null): boolean {
  if (!u) return false;
  return u.employee_count >= u.max_users;
}

export function remainingEmployees(u: CompanyUsage | null): number {
  if (!u) return Number.POSITIVE_INFINITY;
  return Math.max(0, u.max_users - u.employee_count);
}

/** Detect server-side trigger rejection messages. */
export function detectLimitError(err: any): 'project' | 'employee' | null {
  const msg = String(err?.message || err || '');
  if (msg.includes('PROJECT_LIMIT_REACHED')) return 'project';
  if (msg.includes('EMPLOYEE_LIMIT_REACHED')) return 'employee';
  return null;
}
