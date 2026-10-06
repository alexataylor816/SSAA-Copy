import { useNavigate } from "react-router-dom";
import { Grid3x3, LogOut, MessageSquare, MoreVertical, Settings, ShieldCheck, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/useMessaging";
import NotificationBell from "@/components/dashboard/NotificationBell";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The GC/sub branch of Lovable's DashboardHeader. Operator (MOA) tabs and
 * impersonation are out of scope; the user menu items that have no backend
 * (operators, correspondence, subscriptions) are omitted rather than shown
 * as dead buttons.
 */

interface DashboardHeaderProps {
  companyName?: string | null;
  pendingJoinCount?: number;
}

const NotificationDot = () => (
  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-primary bg-destructive" />
);

export default function DashboardHeader({ companyName, pendingJoinCount = 0 }: DashboardHeaderProps) {
  const { user, isAccountHolder, isMOA, permissionLevel, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { totalUnread } = useConversations();

  const canManageCompany = isAccountHolder || isMOA || permissionLevel === "full";
  const showJoinDot = canManageCompany && pendingJoinCount > 0;

  return (
    <header className="shrink-0 overflow-hidden bg-primary text-primary-foreground shadow-md">
      <div className="px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="text-xl font-bold lg:text-2xl">SSAA</h1>
            {companyName && (
              <span className="hidden truncate text-sm text-primary-foreground/80 sm:inline">{companyName}</span>
            )}
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/matrix")}
              className="hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
            >
              <Grid3x3 className="mr-2 h-4 w-4" />
              Resource Matrix
            </Button>

            {canManageCompany && (
              <Button
                data-tour="manage-company"
                variant="ghost"
                size="sm"
                onClick={() => navigate("/settings/company")}
                className="relative hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
              >
                <Settings className="mr-2 h-4 w-4" />
                {t("header.manageCompanyAccount")}
                {showJoinDot && <NotificationDot />}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-primary-foreground hover:bg-primary-foreground/10 lg:hidden"
                >
                  <MoreVertical className="h-5 w-5" />
                  {showJoinDot && <NotificationDot />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={() => navigate("/matrix")}>
                  <Grid3x3 className="mr-2 h-4 w-4" />
                  Resource Matrix
                </DropdownMenuItem>
                {canManageCompany && (
                  <DropdownMenuItem onClick={() => navigate("/settings/company")}>
                    <Settings className="mr-2 h-4 w-4" />
                    {t("header.manageCompanyAccount")}
                    {showJoinDot && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate("/settings/company")}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <NotificationBell />

            <Button
              data-tour="messages-button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/messages")}
              className="relative text-primary-foreground hover:bg-primary-foreground/10"
            >
              <MessageSquare className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">{t("header.messages") || "Messages"}</span>
              {totalUnread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/settings/company")}
              className="hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
              aria-label="My profile"
            >
              <User className="mr-2 h-4 w-4" />
              Profile
            </Button>

            <span className="hidden max-w-[12rem] truncate text-sm text-primary-foreground/80 xl:inline">
              {user?.fullName || user?.email}
            </span>

            {isMOA && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/admin")}
                className="text-primary-foreground hover:bg-primary-foreground/10"
                aria-label="Administration"
              >
                <ShieldCheck className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Admin</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="text-primary-foreground hover:bg-primary-foreground/10"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
