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
      title: "Main Company Account Holder",
      description:
        "Full access including billing, subscriptions, and all company settings. Can manage team profiles and projects. Can only be transferred by the current account holder.",
    },
    full: {
      title: "Level 2 Admin",
      description:
        "Can manage team profiles, projects, schedules, and requests. Cannot access billing or company info.",
    },
    partial: {
      title: "Level 1 Admin (Partial)",
      description:
        "Can manage schedules, view team, manage projects. Cannot change billing or company info. Cannot view Master Schedule.",
    },
  },
  sub: {
    account_holder: {
      title: "Main Company Account Holder",
      description:
        "Full access including billing, subscriptions, and all company settings. Can manage team profiles and projects. Can only be transferred by the current account holder.",
    },
    full: {
      title: "Level 4 Admin",
      description:
        "Can manage team profiles, projects, schedules, and requests. Cannot access billing or company info.",
    },
    partial: {
      title: "Level 3 Admin (Partial)",
      description:
        "Can manage schedules, view team, manage projects. Cannot change billing or company info. Cannot view Master Schedule.",
    },
    level_1: {
      title: "Level 2 (Foreman Permissions)",
      description:
        "Can view all employees' availability on the projects they are assigned to (read-only). Can view schedules and assigned tasks. Cannot edit availability.",
    },
    basic: {
      title: "Level 1 (Basic Permissions)",
      description:
        "Can only view their own availability. View schedules and assigned tasks. Cannot edit or change any availability.",
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
      setError(err instanceof Error ? err.message : "Could not load team members.");
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
      setError(err instanceof Error ? err.message : "Could not update that member.");
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
      setError(err instanceof Error ? err.message : "Could not transfer holdership.");
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
      setError(err instanceof Error ? err.message : "Could not remove that member.");
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
              Manage Team Profiles
            </DialogTitle>
            <DialogDescription>
              What each level can do, and who on your team holds which level.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 pb-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Permission Levels</CardTitle>
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
                  <CardTitle className="text-base">Team Members</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
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
                                    You
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
                                  {member.isCompanyCreator ? "Creator" : (explain[member.permissionLevel]?.title ?? member.permissionLevel)}
                                </Badge>
                              )}
                              {canManage && !isSelf && !member.isCompanyCreator && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    title="Transfer account holdership to this member"
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
                                    title="Remove this member"
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
            <AlertDialogTitle>Transfer Main Company Account Holder Status?</AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget
                ? `Give Main Company Account Holder status to ${transferTarget.fullName || transferTarget.email}? You will step down to ${demoteTo.replace("_", " ")} in the same move — unlike the original app, holdership here moves rather than duplicates.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <span className="text-sm text-muted-foreground">You become:</span>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmTransfer()} disabled={busy}>
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(isOpen) => !isOpen && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.fullName || removeTarget?.email} from the team?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their login keeps working but will belong to no company, and their roster entries become unlinked.
              Their availability history is preserved. This cannot be undone except by re-inviting them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmRemove()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
