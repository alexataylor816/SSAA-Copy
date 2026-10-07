import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calendar as CalendarIcon, Check, LogOut, MessageSquare, MoreVertical, Settings, ShieldCheck, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/useMessaging";
import NotificationBell from "@/components/dashboard/NotificationBell";
import ManageProfileDialog from "@/components/dashboard/ManageProfileDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The GC/sub branch of Lovable's DashboardHeader. Operator (MOA) tabs and
 * impersonation are out of scope; the user menu items that have no backend
 * (operators, correspondence, subscriptions) are omitted rather than shown
 * as dead buttons.
 */

interface DashboardHeaderProps {
  pendingJoinCount?: number;
}

const NotificationDot = () => (
  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-primary bg-destructive" />
);

export default function DashboardHeader({ pendingJoinCount = 0 }: DashboardHeaderProps) {
  const { isAccountHolder, isMOA, permissionLevel, signOut } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const { totalUnread } = useConversations();

  const canManageCompany = isAccountHolder || isMOA || permissionLevel === "full";
  const showJoinDot = canManageCompany && pendingJoinCount > 0;

  const path = location.pathname;
  const viewToggle = (
    <div className="flex items-center gap-1 rounded-lg bg-primary-foreground/15 p-0.5" role="group" aria-label="Calendar view">
      {[
        { label: "Monthly", to: "/dashboard" },
        { label: "Weekly", to: "/matrix" },
      ].map((option) => {
        const active = path.startsWith(option.to);
        return (
          <button
            key={option.to}
            type="button"
            aria-pressed={active}
            onClick={() => !active && navigate(option.to)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active ? "bg-background text-foreground shadow-sm" : "text-primary-foreground/85 hover:text-primary-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <header className="shrink-0 overflow-hidden bg-primary text-primary-foreground shadow-md">
      <div className="px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => navigate("/dashboard")} className="text-xl font-bold lg:text-2xl">
            SSAA
          </button>

          <div className="flex items-center gap-1 lg:gap-3">
            <div className="hidden lg:block">{viewToggle}</div>

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

            {/* Small screens: the view toggle and company settings move into this menu, as in Lovable. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-primary-foreground hover:bg-primary-foreground/10 lg:hidden"
                  aria-label="More"
                >
                  <MoreVertical className="h-5 w-5" />
                  {showJoinDot && <NotificationDot />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Calendar view</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Monthly {path.startsWith("/dashboard") && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/matrix")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Weekly {path.startsWith("/matrix") && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                {canManageCompany && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/settings/company")}>
                      <Settings className="mr-2 h-4 w-4" />
                      {t("header.manageCompanyAccount")}
                      {showJoinDot && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                    </DropdownMenuItem>
                  </>
                )}
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
              onClick={() => setProfileOpen(true)}
              className="text-primary-foreground hover:bg-primary-foreground/10"
              aria-label={t("header.manageMyProfile")}
            >
              <User className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">{t("header.manageMyProfile")}</span>
            </Button>

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
      <ManageProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
}
