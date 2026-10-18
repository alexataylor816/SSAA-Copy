import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, MessageSquare, Settings, ShieldCheck, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/useMessaging";
import NotificationBell from "@/components/dashboard/NotificationBell";
import ManageProfileDialog from "@/components/dashboard/ManageProfileDialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";

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
    <header className="shrink-0 overflow-hidden bg-primary pt-[env(safe-area-inset-top)] text-primary-foreground shadow-md">
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

            {/* Below lg only the bell stays up here; everything else is in MobileTabBar at the bottom. */}
            <NotificationBell />

            <Button
              data-tour="messages-button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/messages")}
              className="relative hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
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
              className="hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
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
                className="hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
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
              className="hidden text-primary-foreground hover:bg-primary-foreground/10 lg:flex"
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
