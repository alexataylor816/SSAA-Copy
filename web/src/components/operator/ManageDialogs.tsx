import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { OPERATOR_LEVEL_LABEL, when, type AuditEntry, type DeletionRequest, type Operator, type OperatorLevel } from "@/lib/operatorApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

/** Manage SSAA's smaller screens (Lovable: ManageOperatorsModal, ManageCancellationRequestsModal), plus the audit log. */

function Shell({
  open,
  onOpenChange,
  onBack,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("manageDialogs.backToManageSsaa")} onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-left">{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

const LEVEL_BADGE: Record<OperatorLevel, string> = {
  owner: "border-primary bg-primary text-primary-foreground",
  main_operator: "border-primary/40 bg-primary/10 text-primary",
  view_only: "border-border bg-muted/20 text-muted-foreground",
};

export function OperatorsDialog({
  open,
  onOpenChange,
  onBack,
  meId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  meId: string | undefined;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<OperatorLevel>("main_operator");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<{ operators: Operator[]; canManage: boolean }>("/admin/operators");
    setOperators(res.operators);
    setCanManage(res.canManage);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await api.post("/admin/operators", body);
      await load();
      toast({ title: message });
      return true;
    } catch (err) {
      toast({ title: t("manageDialogs.couldnTChangeOperatorAccess"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      onBack={onBack}
      title={t("manageDialogs.operators")}
      description={canManage ? t("manageDialogs.whoCanUseTheOperatorDashboard") : t("manageDialogs.onlyTheOwnerCanAddChange")}
    >
      <ul className="divide-y rounded-md border">
        {operators.map((o) => (
          <li key={o.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {o.fullName || o.email}
                {o.userId === meId && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("manageDialogs.you")}</span>}
              </p>
              <p className="truncate text-sm text-muted-foreground">{o.email}</p>
            </div>
            {canManage && o.userId !== meId ? (
              <div className="flex items-center gap-2">
                <select
                  value={o.level}
                  disabled={busy}
                  onChange={(e) => void save({ userId: o.userId, level: e.target.value }, tr("manageDialogs.operatorLevelChanged"))}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label={t("manageDialogs.levelFor", { email: o.fullName || o.email })}
                >
                  {(Object.keys(OPERATOR_LEVEL_LABEL) as OperatorLevel[]).map((l) => (
                    <option key={l} value={l}>
                      {OPERATOR_LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t("manageDialogs.removeOperatorAccessFrom", { email: o.fullName || o.email }))) void save({ userId: o.userId, isAdmin: false }, tr("manageDialogs.operatorAccessRemoved"));
                  }}
                >
                  
                  {t("common.remove")}
                </Button>
              </div>
            ) : (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE[o.level]}`}>{OPERATOR_LEVEL_LABEL[o.level]}</span>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form
          className="mt-4 space-y-3 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void save({ email: email.trim(), level }, tr("manageDialogs.operatorAdded")).then((ok) => ok && setEmail(""));
          }}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" /> {" "}{t("manageDialogs.addAnOperator")}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="op-email">{t("manageDialogs.emailTheyNeedAnSsaaAccount")}</Label>
              <Input id="op-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-level">{t("manageDialogs.operatorLevel")}</Label>
              <select id="op-level" value={level} onChange={(e) => setLevel(e.target.value as OperatorLevel)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="main_operator">{OPERATOR_LEVEL_LABEL.main_operator}</option>
                <option value="view_only">{OPERATOR_LEVEL_LABEL.view_only}</option>
                <option value="owner">{OPERATOR_LEVEL_LABEL.owner}</option>
              </select>
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            
            {t("manageDialogs.addOperator")}
          </Button>
        </form>
      )}
    </Shell>
  );
}

export function CancellationsDialog({
  open,
  onOpenChange,
  onBack,
  canChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  canChange: boolean;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [queue, setQueue] = useState<DeletionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setQueue((await api.get<{ requests: DeletionRequest[] }>("/admin/deletion-requests")).requests);
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function resolve(r: DeletionRequest, approve: boolean) {
    if (approve && !window.confirm(t("manageDialogs.deleteAndAllItsProjectsAnd", { company: r.companyName ?? t("manageDialogs.thisCompany") }))) return;
    setBusy(r.id);
    try {
      await api.post(`/admin/deletion-requests/${r.id}/resolve`, { approve });
      await load();
      onChanged();
      toast({ title: approve ? t("manageDialogs.companyDeleted") : t("manageDialogs.requestRejected") });
    } catch (err) {
      toast({ title: t("manageDialogs.couldnTResolveTheRequest"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell open={open} onOpenChange={onOpenChange} onBack={onBack} title={t("manageDialogs.cancellationRequests")} description={t("manageDialogs.reviewAndApproveCompanyAccountDeletions")}>
      {queue.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("manageDialogs.nothingWaitingForReview")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {queue.map((r) => (
            <li key={r.id} className="space-y-2 px-3 py-3">
              <div>
                <p className="font-medium">{r.companyName ?? t("manageDialogs.unknownCompany")}</p>
                <p className="text-sm text-muted-foreground">
                  {r.reason ? `“${r.reason}” · ` : ""}
                  
                  {t("manageDialogs.requested")}{" "}{when(r.createdAt)}
                </p>
              </div>
              {canChange && (
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void resolve(r, true)}>
                    {busy === r.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    
                    {t("manageDialogs.approveDelete")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void resolve(r, false)}>
                    
                    {t("manageDialogs.reject")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export function AuditList({ entries, empty = tr("manageDialogs.noActivity") }: { entries: AuditEntry[]; empty?: string }) {
  const { t } = useLanguage();
  if (entries.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {entries.map((a) => (
        <li key={a.id} className="px-3 py-2.5 text-sm">
          <p>{a.summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {a.operatorName || a.operatorEmail || t("manageDialogs.anOperator")} · {when(a.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function AuditLogDialog({ open, onOpenChange, onBack }: { open: boolean; onOpenChange: (open: boolean) => void; onBack?: () => void }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setEntries(null);
    void api.get<{ entries: AuditEntry[] }>("/admin/audit-log").then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [open]);
  return (
    <Shell open={open} onOpenChange={onOpenChange} onBack={onBack} title={t("manageDialogs.auditLog")} description={t("manageDialogs.everyChangeAnOperatorMadeNewest")}>
      {entries === null ? (
        <p className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {" "}{t("common.loading2")}
        </p>
      ) : (
        <AuditList entries={entries} />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">
          
          {t("manageDialogs.note")}
        </Badge>
        
        {t("manageDialogs.operatorsCanReadThisLogBut")}
      </p>
    </Shell>
  );
}
