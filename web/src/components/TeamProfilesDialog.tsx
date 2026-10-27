import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, Trash2, Users } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

type CompanyType = "gc" | "sub";
type PermissionLevel = "basic" | "standard" | "level_1" | "partial" | "full" | "account_holder";

interface TeamMember {
  userId: string;
  email: string;
  fullName: string | null;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
}

/**
 * Permission level explainer copy, taken from the Lovable ProfilesModal's
 * GC/SUB_PERMISSION_DESCRIPTIONS (billing/subscription wording kept because
 * it describes what the level *means*, not what this build bills for).
 */
const DESCRIPTIONS: Record<CompanyType, Record<string, { title: string; description: string }>> = {
  gc: {
    account_holder: {
      get title() { return tr("teamProfilesDialog.mainCompanyAccountHolder"); },
      get description() { return tr("teamProfilesDialog.fullAccessIncludingBillingSubscriptionsA"); },
    },
    full: {
      get title() { return tr("teamProfilesDialog.level2Admin"); },
      get description() { return tr("teamProfilesDialog.canManageTeamProfilesProjectsSchedules"); },
    },
    partial: {
      get title() { return tr("teamProfilesDialog.level1AdminPartial"); },
      get description() { return tr("teamProfilesDialog.canManageSchedulesViewTeamManage"); },
    },
  },
  sub: {
    account_holder: {
      get title() { return tr("teamProfilesDialog.mainCompanyAccountHolder"); },
      get description() { return tr("teamProfilesDialog.fullAccessIncludingBillingSubscriptionsA"); },
    },
    full: {
      get title() { return tr("teamProfilesDialog.level4Admin"); },
      get description() { return tr("teamProfilesDialog.canManageTeamProfilesProjectsSchedules"); },
    },
    partial: {
      get title() { return tr("teamProfilesDialog.level3AdminPartial"); },
      get description() { return tr("teamProfilesDialog.canManageSchedulesViewTeamManage"); },
    },
    level_1: {
      get title() { return tr("teamProfilesDialog.level2ForemanPermissions"); },
      get description() { return tr("teamProfilesDialog.canViewAllEmployeesAvailabilityOn"); },
    },
    basic: {
      get title() { return tr("teamProfilesDialog.level1BasicPermissions"); },
      get description() { return tr("teamProfilesDialog.canOnlyViewTheirOwnAvailability"); },
    },
  },
};

function visibleLevels(companyType: CompanyType): PermissionLevel[] {
  return companyType === "gc"
    ? ["account_holder", "full", "partial"]
    : ["account_holder", "full", "partial", "level_1", "basic"];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyType: CompanyType;
  currentUserId: string;
  /** Whether the viewer may change levels / transfer / remove. */
  canManage: boolean;
  onChanged: () => void;
}

/**
 * "Manage Team Profiles" — the member-permission half of the Lovable
 * ProfilesModal. Employee roster CRUD already lives in CompanySettings, so
 * this dialog covers what had no UI at all: what each level means, changing
 * levels, transferring the holder status, and removing members.
 */
export default function TeamProfilesDialog({
  open,
  onOpenChange,
  companyId,
  companyType,
  currentUserId,
  canManage,
  onChanged,
}: Props) {
  const { t } = useLanguage();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<TeamMember | null>(null);
  const [demoteTo, setDemoteTo] = useState<PermissionLevel>("full");
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ members: TeamMember[] }>(`/companies/${companyId}/members`);
      setMembers(res.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("teamProfilesDialog.couldNotLoadMembers"));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function changeLevel(userId: string, permissionLevel: string) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/companies/${companyId}/members/${userId}`, { permissionLevel });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("teamProfilesDialog.couldNotUpdateMember"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTransfer() {
    if (!transferTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/transfer-holder`, {
        targetUserId: transferTarget.userId,
        demoteTo,
      });
      setTransferTarget(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("teamProfilesDialog.couldNotTransfer"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/companies/${companyId}/members/${removeTarget.userId}`);
      setRemoveTarget(null);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("teamProfilesDialog.couldNotRemoveMember"));
    } finally {
      setBusy(false);
    }
  }

  const explain = DESCRIPTIONS[companyType];
  const demoteOptions = visibleLevels(companyType).filter((l) => l !== "account_holder");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              
              {t("teamProfilesDialog.manageTeamProfiles")}
            </DialogTitle>
            <DialogDescription>
              
              {t("teamProfilesDialog.whatEachLevelCanDoAnd")}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 pb-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("teamProfilesDialog.permissionLevels")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visibleLevels(companyType).map((level) => (
                    <div key={level} className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium text-sm">{explain[level].title}</p>
                      <p className="text-xs text-muted-foreground">{explain[level].description}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("teamProfilesDialog.teamMembers")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : (
                    <ul className="divide-y">
                      {members.map((member) => {
                        const isSelf = member.userId === currentUserId;
                        return (
                          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {member.fullName || member.email}
                                {isSelf && (
                                  <Badge variant="secondary" className="ml-2">
                                    
                                    {t("teamProfilesDialog.you")}
                                  </Badge>
                                )}
                              </p>
                              <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {canManage && !isSelf ? (
                                <Select
                                  value={member.permissionLevel}
                                  disabled={busy}
                                  onValueChange={(value) => void changeLevel(member.userId, value)}
                                >
                                  <SelectTrigger className="w-40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {visibleLevels(companyType).map((level) => (
                                      <SelectItem key={level} value={level}>
                                        {explain[level].title}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge variant="outline">
                                  {member.isCompanyCreator ? t("teamProfilesDialog.creator") : (explain[member.permissionLevel]?.title ?? member.permissionLevel)}
                                </Badge>
                              )}
                              {canManage && !isSelf && !member.isCompanyCreator && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    title={t("teamProfilesDialog.transferAccountHoldershipToThisMember")}
                                    onClick={() => {
                                      setTransferTarget(member);
                                      setDemoteTo("full");
                                    }}
                                  >
                                    <Shield className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    title={t("teamProfilesDialog.removeThisMember")}
                                    onClick={() => setRemoveTarget(member)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={transferTarget !== null} onOpenChange={(isOpen) => !isOpen && setTransferTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("teamProfilesDialog.transferMainCompanyAccountHolderStatus")}</AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget
                ? t("teamProfilesDialog.giveMainCompanyAccountHolderStatus", { email: transferTarget.fullName || transferTarget.email, replace_: demoteTo.replace("_", " ") })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <span className="text-sm text-muted-foreground">{t("teamProfilesDialog.youBecome")}</span>
            <Select value={demoteTo} onValueChange={(v) => setDemoteTo(v as PermissionLevel)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {demoteOptions.map((level) => (
                  <SelectItem key={level} value={level}>
                    {explain[level].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmTransfer()} disabled={busy}>
              
              {t("teamProfilesDialog.transfer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(isOpen) => !isOpen && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              
              {t("common.remove")}{" "}{removeTarget?.fullName || removeTarget?.email} {" "}{t("teamProfilesDialog.fromTheTeam")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              
              {t("teamProfilesDialog.theirLoginKeepsWorkingButWill")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRemove()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              
              {t("common.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
