import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

/**
 * Who works which project (Luke's "Manage Team Profiles" assignments). The Weekly view outlines a
 * crew member in red when they're dropped on a project they aren't assigned to, and schedule notices
 * for a project go to the office staff assigned to it (everyone with scheduling access if nobody is).
 */

interface ProjectRow {
  id: string;
  name: string;
  /** GC name for a joined project, address for an own one. */
  detail: string | null;
}

interface Person {
  id: string;
  name: string;
}

interface Assignment {
  employeeIds: string[];
  userIds: string[];
}

interface Props {
  projects: ProjectRow[];
  employees: Person[];
  /** Office staff who can be told about schedule changes (members with scheduling access). */
  staff: Person[];
  canEdit: boolean;
}

export default function ProjectAssignmentsCard({ projects, employees, staff, canEdit }: Props) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saved, setSaved] = useState<Record<string, Assignment>>({});
  const [draft, setDraft] = useState<Record<string, Assignment>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const entries = await Promise.all(
      projects.map(async (p) => {
        try {
          const res = await api.get<Assignment & { projectId: string }>(`/projects/${p.id}/assignments`);
          return [p.id, { employeeIds: res.employeeIds, userIds: res.userIds }] as const;
        } catch {
          return [p.id, { employeeIds: [], userIds: [] }] as const;
        }
      }),
    );
    const map = Object.fromEntries(entries);
    setSaved(map);
    setDraft(map);
  }, [projects]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (projectId: string, field: keyof Assignment, id: string, on: boolean) =>
    setDraft((d) => {
      const current = d[projectId] ?? { employeeIds: [], userIds: [] };
      const list = on ? [...current[field], id] : current[field].filter((x) => x !== id);
      return { ...d, [projectId]: { ...current, [field]: list } };
    });

  const dirty = (projectId: string) => {
    const a = saved[projectId];
    const b = draft[projectId];
    if (!a || !b) return false;
    const same = (x: string[], y: string[]) => x.length === y.length && x.every((id) => y.includes(id));
    return !same(a.employeeIds, b.employeeIds) || !same(a.userIds, b.userIds);
  };

  const save = async (projectId: string) => {
    setSavingId(projectId);
    try {
      const res = await api.put<Assignment>(`/projects/${projectId}/assignments`, draft[projectId]);
      setSaved((s) => ({ ...s, [projectId]: res }));
      setDraft((d) => ({ ...d, [projectId]: res }));
      toast({ title: t("projectAssignmentsCard.assignmentsSaved") });
    } catch (err) {
      toast({ title: t("common.couldnTSave"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (projects.length === 0) return null;

  const checklist = (projectId: string, field: keyof Assignment, people: Person[], empty: string) =>
    people.length === 0 ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {people.map((person) => (
          <label key={person.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              disabled={!canEdit}
              checked={draft[projectId]?.[field].includes(person.id) ?? false}
              onCheckedChange={(checked) => toggle(projectId, field, person.id, checked === true)}
            />
            {person.name}
          </label>
        ))}
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("projectAssignmentsCard.projectAssignments")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          
          {t("projectAssignmentsCard.whoWorksEachJobPlacingSomeone")}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {projects.map((project) => {
            const open = openId === project.id;
            const crewCount = saved[project.id]?.employeeIds.length ?? 0;
            return (
              <li key={project.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : project.id)}
                >
                  {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.name}</span>
                    {project.detail && <span className="block truncate text-sm text-muted-foreground">{project.detail}</span>}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {tr("projectAssignmentsCard.crewCount", { count: crewCount, total: employees.length })}
                  </Badge>
                </button>
                {open && (
                  <div className="space-y-4 border-t bg-muted/20 px-3 py-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("projectAssignmentsCard.crewOnThisJob")}</p>
                      {checklist(project.id, "employeeIds", employees, tr("projectAssignmentsCard.noEmployeesYet"))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("projectAssignmentsCard.whoGetsScheduleNotices")}</p>
                      <p className="text-xs text-muted-foreground">{t("projectAssignmentsCard.leaveEmptyToNotifyEveryoneWith")}</p>
                      {checklist(project.id, "userIds", staff, tr("projectAssignmentsCard.nobodyWithAccess"))}
                    </div>
                    {canEdit && (
                      <Button size="sm" disabled={!dirty(project.id) || savingId === project.id} onClick={() => void save(project.id)}>
                        {savingId === project.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        
                        {t("projectAssignmentsCard.saveAssignments")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
