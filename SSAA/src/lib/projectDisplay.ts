import { supabase } from '@/integrations/supabase/client';

export interface ProjectAlias {
  project_id: string;
  company_id: string;
  name: string | null;
  address: string | null;
}

export interface DisplayableProject {
  id: string;
  name: string;
  address?: string | null;
}

/**
 * Returns the per-company display name/address for a project.
 * Falls back to the canonical projects.name/address when no alias exists
 * for the given company.
 */
export function getProjectDisplay<T extends DisplayableProject>(
  project: T,
  aliases: ProjectAlias[],
  companyId: string | null | undefined,
): { name: string; address: string | null } {
  if (!companyId) {
    return { name: project.name, address: project.address ?? null };
  }
  const a = aliases.find(
    (x) => x.project_id === project.id && x.company_id === companyId,
  );
  return {
    name: a?.name?.trim() ? (a.name as string).trim() : project.name,
    address: a?.address?.trim()
      ? (a.address as string).trim()
      : project.address ?? null,
  };
}

/**
 * Overlay the caller-company's aliases onto a list of project rows,
 * mutating only `name`/`address`. Keeps every other field intact.
 *
 * This is the workhorse: callers fetch `projects` + `project_aliases`
 * (filtered to their effective company_id) and pass both in. Every
 * downstream component then sees the alias-aware values without
 * needing any additional code.
 */
export function applyAliasesToProjects<T extends DisplayableProject>(
  projects: T[],
  aliases: ProjectAlias[],
  companyId: string | null | undefined,
): T[] {
  if (!companyId || aliases.length === 0) return projects;
  const map = new Map<string, ProjectAlias>();
  for (const a of aliases) {
    if (a.company_id === companyId) map.set(a.project_id, a);
  }
  if (map.size === 0) return projects;
  return projects.map((p) => {
    const a = map.get(p.id);
    if (!a) return p;
    const name = a.name?.trim() ? a.name.trim() : p.name;
    const address = a.address?.trim() ? a.address.trim() : p.address ?? null;
    if (name === p.name && address === (p.address ?? null)) return p;
    return { ...p, name, address } as T;
  });
}

/**
 * Fetch all aliases owned by `companyId`.
 */
export async function fetchAliasesForCompany(
  companyId: string | null | undefined,
): Promise<ProjectAlias[]> {
  if (!companyId) return [];
  const { data, error } = await supabase
    .from('project_aliases')
    .select('project_id, company_id, name, address')
    .eq('company_id', companyId);
  if (error) {
    console.error('Failed to load project aliases:', error);
    return [];
  }
  return (data as ProjectAlias[]) || [];
}
