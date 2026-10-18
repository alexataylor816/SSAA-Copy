import { forwardRef, useState } from "react";
import type { ButtonHTMLAttributes, ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, CalendarDays, CalendarRange, ChevronRight, LogOut, MessageSquare, Settings, ShieldCheck, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/useMessaging";
import { useLanguage } from "@/contexts/LanguageContext";
import ManageProfileDialog from "@/components/dashboard/ManageProfileDialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  dot?: boolean;
}

/** One look for every tab: white icon on the brand blue, the active one in a lighter pill. */
const Tab = forwardRef<HTMLButtonElement, TabProps>(({ active, label, icon: Icon, badge = 0, dot, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-current={active ? "page" : undefined}
    className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
      active ? "font-semibold text-primary-foreground" : "font-medium text-primary-foreground/70 active:text-primary-foreground"
    }`}
    {...rest}
  >
    <span
      className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
        active ? "bg-primary-foreground/20" : ""
      }`}
    >
      <Icon className="h-[22px] w-[22px]" />
      {badge > 0 && (
        <span className="absolute -top-1 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-primary">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {dot && <span className="absolute right-3 top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-primary" />}
    </span>
    {label}
  </button>
));
Tab.displayName = "Tab";

const LEVEL_LABEL: Record<string, string> = {
  account_holder: "Account holder",
  full: "Full access",
  partial: "Partial access",
  level_1: "Foreman",
  basic: "Crew member",
};

function SheetRow({
  icon: Icon,
  label,
  onClick,
  danger,
  dot,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] font-medium transition-colors active:bg-muted ${
        danger ? "text-destructive" : "text-foreground"
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full ${
          danger ? "bg-destructive/10" : "bg-primary/10 text-primary"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1">{label}</span>
      {dot && <span className="h-2.5 w-2.5 rounded-full bg-destructive" />}
      {!danger && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

/**
 * Phone navigation: a bar pinned to the bottom of the screen in place of the
 * header's buttons (which stay at the top right from lg up). Profile, company
 * settings, admin and sign out share the Settings tab, which opens a bottom sheet.
 *
 * Pages render it as the last child of their flex column; it leaves a spacer
 * of its own height there so no content ends up hidden behind it.
 */
export default function MobileTabBar({ pendingJoinCount = 0 }: { pendingJoinCount?: number }) {
  const { user, isAccountHolder, isMOA, permissionLevel, signOut } = useAuth();
  const { t } = useLanguage();
  const { totalUnread } = useConversations();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canManageCompany = isAccountHolder || isMOA || permissionLevel === "full";
  const showJoinDot = canManageCompany && pendingJoinCount > 0;
  const initials = (user?.fullName || user?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const go = (action: () => void) => {
    setSettingsOpen(false);
    action();
  };

  return (
    <>
      <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 lg:hidden" />
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 bg-primary pb-[env(safe-area-inset-bottom)] text-primary-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)] lg:hidden"
      >
        <div className="mx-auto flex max-w-lg px-1">
          <Tab active={path.startsWith("/dashboard")} label="Calendar" icon={CalendarDays} onClick={() => navigate("/dashboard")} />
          <Tab active={path.startsWith("/matrix")} label="Weekly" icon={CalendarRange} onClick={() => navigate("/matrix")} />
          <Tab
            active={path.startsWith("/messages")}
            label="Messages"
            icon={MessageSquare}
            badge={totalUnread}
            aria-label={totalUnread > 0 ? `Messages, ${totalUnread} unread` : "Messages"}
            onClick={() => navigate("/messages")}
          />
          <Tab
            active={settingsOpen || path.startsWith("/settings") || path.startsWith("/admin")}
            label="Settings"
            icon={Settings}
            dot={showJoinDot}
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </nav>
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 lg:hidden"
        >
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="mb-3 flex items-center gap-3 px-3">
            {user?.profilePictureUrl ? (
              <img src={user.profilePictureUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
                {initials}
              </span>
            )}
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{user?.fullName || "Your account"}</SheetTitle>
              <SheetDescription className="truncate text-sm">
                {user?.email}
                {permissionLevel && ` · ${LEVEL_LABEL[permissionLevel] ?? permissionLevel}`}
              </SheetDescription>
            </div>
          </div>
          <div className="space-y-0.5">
            <SheetRow icon={User} label={t("header.manageMyProfile")} onClick={() => go(() => setProfileOpen(true))} />
            {canManageCompany && (
              <SheetRow
                icon={Building2}
                label={t("header.manageCompanyAccount")}
                dot={showJoinDot}
                onClick={() => go(() => navigate("/settings/company"))}
              />
            )}
            {isMOA && <SheetRow icon={ShieldCheck} label="Admin" onClick={() => go(() => navigate("/admin"))} />}
            <div className="my-2 border-t" />
            <SheetRow icon={LogOut} label="Sign out" danger onClick={() => go(() => void signOut())} />
          </div>
        </SheetContent>
      </Sheet>
      <ManageProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
