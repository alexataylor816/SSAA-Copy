import { useCallback, useEffect, useState } from "react";
import { Building2, ChevronRight, Eye, KeyRound, Loader2, Mail, Bell, MessageSquare, ShieldOff, ShieldCheck, Crown } from "lucide-react";
import { api } from "@/lib/api";
import {
  OPERATOR_LEVEL_LABEL,
  STATUS_STYLE,
  eventLabel,
  levelLabel,
  when,
  type CompanyDetail,
  type CorrespondenceEntry,
  type UserDetail,
} from "@/lib/operatorApi";
import type { ViewAsTarget } from "@/lib/viewAs";
import { AuditList } from "@/components/operator/ManageDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

/** The operator's page for one person or one company, with the support actions (OPERATOR_DASHBOARD_PLAN.md §3). */

const CHANNEL_ICON = { email: Mail, push: Bell, chat: MessageSquare } as const;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function CorrespondenceList({ entries }: { entries: CorrespondenceEntry[] }) {
  const { t } = useLanguage();
  if (entries.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{t("detailSheets.nothingSentYet")}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {entries.map((e) => {
        const Icon = CHANNEL_ICON[e.channel];
        return (
          <li key={e.id} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={e.channel} />
            <div className="min-w-0 flex-1">
              <p className="truncate">{e.subject || eventLabel(e.eventType)}</p>
              <p className="text-xs text-muted-foreground">
                {eventLabel(e.eventType)} · {when(e.createdAt)}
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[e.status]}`} title={e.errorMessage ?? undefined}>
              {e.status === "sent" ? t("detailSheets.sent") : e.status === "failed" ? t("detailSheets.failed") : t("detailSheets.notSent")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const Loading = () => {
  const { t } = useLanguage();
  return (
  <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" /> {" "}{t("common.loading2")}
  </p>
);
};

export function UserSheet({
  userId,
  onClose,
  canChange,
  onViewAs,
  onOpenCompany,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  canChange: boolean;
  onViewAs: (target: ViewAsTarget) => void;
  onOpenCompany: (companyId: string) => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [data, setData] = useState<UserDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setData(await api.get<UserDetail>(`/admin/users/${userId}`));
    } catch (err) {
      toast({ title: t("detailSheets.couldnTLoadThatAccount"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      onClose();
    }
  }, [userId, toast, onClose, t]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      await fn();
      await load();
      onChanged();
      toast({ title: message });
    } catch (err) {
      toast({ title: t("detailSheets.thatDidnTWork"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const u = data?.user;
  const isHolder = data?.permissionLevel === "account_holder" || data?.isCreator;

  return (
    <>
      <Sheet open={userId !== null} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {!data || !u ? (
            <>
              <SheetHeader className="sr-only">
                <SheetTitle>{t("detailSheets.account")}</SheetTitle>
                <SheetDescription>{t("detailSheets.loading")}</SheetDescription>
              </SheetHeader>
              <Loading />
            </>
          ) : (
            <div className="space-y-6">
              <SheetHeader className="space-y-1 pr-6 text-left">
                <SheetTitle className="text-xl">{u.fullName || u.email}</SheetTitle>
                <SheetDescription className="break-all">{u.email}</SheetDescription>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {u.isOperator && u.operatorLevel && <Badge>{OPERATOR_LEVEL_LABEL[u.operatorLevel]}</Badge>}
                  {data.permissionLevel && <Badge variant="outline">{levelLabel(data.permissionLevel)}</Badge>}
                  {u.suspended && <Badge variant="destructive">{t("detailSheets.suspended")}</Badge>}
                </div>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  disabled={u.isOperator || u.suspended}
                  onClick={() => onViewAs({ userId: u.userId, name: u.fullName || u.email, email: u.email, companyName: data.company?.name ?? null })}
                >
                  <Eye className="mr-2 h-4 w-4" /> {" "}{t("detailSheets.viewAs")}
                </Button>
                <Button variant="outline" disabled={!canChange || busy !== null} onClick={() => void act("reset", async () => {
                  const res = await api.post<{ emailed: boolean; code?: string }>(`/admin/users/${u.userId}/password-reset`);
                  if (!res.emailed && res.code) setCode(res.code);
                }, tr("detailSheets.resetCodeCreated"))}>
                  {busy === "reset" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  
                  {t("detailSheets.resetPassword")}
                </Button>
                {!u.isOperator && (
                  <Button
                    variant={u.suspended ? "default" : "outline"}
                    className={u.suspended ? "" : "text-destructive hover:text-destructive"}
                    disabled={!canChange || busy !== null}
                    onClick={() => {
                      if (!u.suspended && !window.confirm(t("detailSheets.suspendTheyReSignedOutAnd", { email: u.fullName || u.email }))) return;
                      void act("suspend", () => api.post(`/admin/users/${u.userId}/suspend`, { suspended: !u.suspended }), u.suspended ? tr("detailSheets.accountRestored") : tr("detailSheets.accountSuspended"));
                    }}
                  >
                    {u.suspended ? <ShieldCheck className="mr-2 h-4 w-4" /> : <ShieldOff className="mr-2 h-4 w-4" />}
                    {u.suspended ? t("detailSheets.restoreAccount") : t("detailSheets.suspend")}
                  </Button>
                )}
              </div>
              {u.isOperator && <p className="text-xs text-muted-foreground">{t("detailSheets.operatorsCanTBeViewedAs")}</p>}

              <Section title={t("detailSheets.account")}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border p-3 text-sm">
                  <dt className="text-muted-foreground">{t("detailSheets.joined")}</dt>
                  <dd>{when(u.createdAt)}</dd>
                  <dt className="text-muted-foreground">{t("detailSheets.signsInWith")}</dt>
                  <dd>{u.signInMethod === "google" ? "Google" : t("detailSheets.emailAndPassword")}</dd>
                  <dt className="text-muted-foreground">{t("detailSheets.phone")}</dt>
                  <dd>{u.phone || "—"}</dd>
                  {u.suspendedAt && (
                    <>
                      <dt className="text-muted-foreground">{t("detailSheets.suspended")}</dt>
                      <dd>{when(u.suspendedAt)}</dd>
                    </>
                  )}
                </dl>
              </Section>

              <Section title={t("common.company")}>
                {data.company ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <button type="button" onClick={() => onOpenCompany(data.company!.id)} className="flex w-full items-center gap-3 text-left">
                      <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{data.company.name}</span>
                        <span className="text-xs text-muted-foreground">{data.company.companyType === "gc" ? t("common.generalContractor") : t("common.subcontractor")}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <div className="flex items-center justify-between gap-3 border-t pt-3">
                      <label htmlFor="user-level" className="text-sm text-muted-foreground">
                        
                        {t("detailSheets.permissionLevel")}
                      </label>
                      {isHolder ? (
                        <Badge variant="outline">
                          <Crown className="mr-1 h-3 w-3" /> {" "}{t("detailSheets.accountHolder")}
                        </Badge>
                      ) : (
                        <select
                          id="user-level"
                          value={data.permissionLevel ?? ""}
                          disabled={!canChange || busy !== null}
                          onChange={(e) => void act("level", () => api.patch(`/admin/users/${u.userId}/level`, { permissionLevel: e.target.value }), tr("detailSheets.levelChanged"))}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {data.levels
                            .filter((l) => l !== "account_holder")
                            .map((l) => (
                              <option key={l} value={l}>
                                {levelLabel(l)}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                    {isHolder && <p className="text-xs text-muted-foreground">{t("detailSheets.toChangeTheAccountHolderOpen")}</p>}
                  </div>
                ) : (
                  <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("detailSheets.notInACompanyYet")}</p>
                )}
              </Section>

              <Section title={t("detailSheets.messagesSentToThem")}>
                <CorrespondenceList entries={data.correspondence} />
              </Section>

              <Section title={t("detailSheets.operatorActivity")}>
                <AuditList entries={data.audit} empty={tr("detailSheets.noChangesAccount")} />
              </Section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={code !== null} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("detailSheets.giveThemThisCode")}</DialogTitle>
            <DialogDescription>
              
              {t("detailSheets.emailIsnTReachingThemFrom")}
            </DialogDescription>
          </DialogHeader>
          <p className="select-all rounded-md border bg-muted/10 py-4 text-center font-mono text-3xl tracking-[0.3em]">{code}</p>
          <DialogFooter>
            <Button onClick={() => setCode(null)}>{t("detailSheets.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const REQUEST_STYLE: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  cancelled: "border-border bg-muted/20 text-muted-foreground",
};

export function CompanySheet({
  companyId,
  onClose,
  canChange,
  onViewAs,
  onOpenUser,
  onChanged,
}: {
  companyId: string | null;
  onClose: () => void;
  canChange: boolean;
  onViewAs: (target: ViewAsTarget) => void;
  onOpenUser: (userId: string) => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [data, setData] = useState<CompanyDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      setData(await api.get<CompanyDetail>(`/admin/companies/${companyId}`));
    } catch (err) {
      toast({ title: t("detailSheets.couldnTLoadThatCompany"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      onClose();
    }
  }, [companyId, toast, onClose, t]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  async function makeHolder(userId: string, name: string) {
    if (!data || !window.confirm(t("detailSheets.makeTheAccountHolderOfThe", { name: data.company.name }))) return;
    setBusy(userId);
    try {
      await api.post(`/admin/companies/${data.company.id}/account-holder`, { userId });
      await load();
      onChanged();
      toast({ title: t("detailSheets.isNowTheAccountHolder", { name: name }) });
    } catch (err) {
      toast({ title: t("detailSheets.thatDidnTWork"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const holder = data?.members.find((m) => m.permissionLevel === "account_holder" || m.isCreator);

  return (
    <Sheet open={companyId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {!data ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("common.company")}</SheetTitle>
              <SheetDescription>{t("detailSheets.loading")}</SheetDescription>
            </SheetHeader>
            <Loading />
          </>
        ) : (
          <div className="space-y-6">
            <SheetHeader className="space-y-1 pr-6 text-left">
              <SheetTitle className="text-xl">{data.company.name}</SheetTitle>
              <SheetDescription>
                {data.company.companyType === "gc" ? t("common.generalContractor") : t("common.subcontractor")}
                {data.company.address ? ` · ${data.company.address}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [t("detailSheets.members"), data.members.length],
                [t("detailSheets.projects"), data.projects.length],
                [t("detailSheets.crew"), data.employees],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-2">
                  <div className="text-xl font-semibold">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            <Button
              className="w-full"
              disabled={!holder || holder.suspended}
              onClick={() => holder && onViewAs({ userId: holder.userId, name: holder.fullName || holder.email, email: holder.email, companyName: data.company.name })}
            >
              <Eye className="mr-2 h-4 w-4" />
              {holder ? t("detailSheets.openAs", { email: holder.fullName || holder.email }) : t("detailSheets.noAccountHolder")}
            </Button>

            <Section title={t("detailSheets.people")}>
              <ul className="divide-y rounded-md border">
                {data.members.map((m) => {
                  const isHolder = m.permissionLevel === "account_holder" || m.isCreator;
                  return (
                    <li key={m.userId} className="flex items-center gap-2 px-3 py-2.5">
                      <button type="button" onClick={() => onOpenUser(m.userId)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium">
                          {m.fullName || m.email}
                          {m.suspended && <span className="ml-1 text-xs font-normal text-destructive">{t("detailSheets.suspended2")}</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {levelLabel(m.permissionLevel)} · {m.email}
                        </span>
                      </button>
                      {isHolder ? (
                        <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label={t("detailSheets.accountHolder2")} />
                      ) : (
                        canChange && (
                          <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" disabled={busy !== null} onClick={() => void makeHolder(m.userId, m.fullName || m.email)}>
                            {busy === m.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("detailSheets.makeAccountHolder")}
                          </Button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section title={data.company.companyType === "gc" ? t("common.projects") : t("detailSheets.connectedProjects")}>
              {data.projects.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("detailSheets.noneYet")}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.projects.map((p) => (
                    <li key={p.id} className="px-3 py-2 text-sm">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[p.ownerName, p.address].filter(Boolean).join(" · ") || t("detailSheets.noAddress")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("detailSheets.recentScheduleRequests")}>
              {data.requests.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("detailSheets.noneYet")}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.requests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{r.project}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.date} · {r.other}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${REQUEST_STYLE[r.status] ?? ""}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("detailSheets.messagesSent")}>
              <CorrespondenceList entries={data.correspondence} />
            </Section>

            <Section title={t("detailSheets.operatorActivity")}>
              <AuditList entries={data.audit} empty={tr("detailSheets.noChangesCompany")} />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

