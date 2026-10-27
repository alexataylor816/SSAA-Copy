import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import {
  Ban,
  Building2,
  ChevronRight,
  CreditCard,
  Eye,
  HardHat,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  Search,
  Shield,
  UserCog,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { startViewAs, type ViewAsTarget } from "@/lib/viewAs";
import {
  OPERATOR_LEVEL_LABEL,
  levelLabel,
  type AdminCompany,
  type AdminUser,
  type DeletionRequest,
  type OperatorMe,
  type Overview,
} from "@/lib/operatorApi";
import { useAuth } from "@/contexts/AuthContext";
import OverviewTab from "@/components/operator/OverviewTab";
import CorrespondenceDialog from "@/components/operator/CorrespondenceDialog";
import { AuditLogDialog, CancellationsDialog, OperatorsDialog } from "@/components/operator/ManageDialogs";
import { CompanySheet, UserSheet } from "@/components/operator/DetailSheets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Toaster } from "@/components/ui/toaster";

/**
 * The SSAA Operator Dashboard (Luke's MOA view). Lovable's header tabs (Manage SSAA, Users,
 * Subcontractor, General Contractor) plus an Overview. Every person and company opens a page with their
 * details, what was sent to them and the support actions; "view as" opens the normal app as that person.
 *
 * Not ported: Guest GCs (guest companies don't exist here) and Subscriptions (billing isn't built yet).
 */

type Tab = "overview" | "ssaa" | "users" | "sub" | "gc";
type Panel = "correspondence" | "operators" | "cancellations" | "audit" | null;
type UserFilter = "all" | "operators" | "suspended" | "none";

const matches = (q: string, ...fields: (string | null | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

export default function Admin() {
  const { user, isMOA, initializing, loading, signOut } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "ssaa", "users", "sub", "gc"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const setTab = (next: string) => setParams({ tab: next }, { replace: true });

  const [me, setMe] = useState<OperatorMe | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [queue, setQueue] = useState<DeletionRequest[]>([]);
  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [opening, setOpening] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [openCompany, setOpenCompany] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, o, c, u, q] = await Promise.all([
        api.get<OperatorMe>("/admin/me"),
        api.get<Overview>("/admin/overview"),
        api.get<{ companies: AdminCompany[] }>("/admin/companies"),
        api.get<{ users: AdminUser[] }>("/admin/users"),
        api.get<{ requests: DeletionRequest[] }>("/admin/deletion-requests"),
      ]);
      setMe(m);
      setOverview(o);
      setCompanies(c.companies);
      setUsers(u.users);
      setQueue(q.requests);
    } catch (err) {
      toast({ title: "Could not load operator data", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPageLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!initializing && !loading && isMOA) void load();
    if (!initializing && !loading && !isMOA) setPageLoading(false);
  }, [initializing, loading, isMOA, load]);

  useEffect(() => setSearch(""), [tab]);

  const visibleUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          matches(search, u.fullName, u.email, u.companyName) &&
          (userFilter === "all" ||
            (userFilter === "operators" && u.isOperator) ||
            (userFilter === "suspended" && u.suspended) ||
            (userFilter === "none" && !u.companyId && !u.isOperator)),
      ),
    [users, search, userFilter],
  );
  const visibleCompanies = useMemo(
    () => companies.filter((c) => c.companyType === tab && matches(search, c.name, c.primaryHolder?.fullName, c.primaryHolder?.email)),
    [companies, tab, search],
  );
  const closeUser = useCallback(() => setOpenUser(null), []);
  const closeCompany = useCallback(() => setOpenCompany(null), []);

  if (!initializing && !loading && !isMOA) return <Navigate to="/dashboard" replace />;

  const canChange = me?.canChange ?? false;

  async function viewAs(target: ViewAsTarget) {
    setOpening(target.userId);
    try {
      await startViewAs(target);
    } catch (err) {
      setOpening(null);
      toast({ title: "Couldn't open that account", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  const tabs: { value: Tab; label: string; short: string; icon: typeof Users; dot?: boolean }[] = [
    { value: "overview", label: "Overview", short: "Overview", icon: LayoutDashboard },
    { value: "ssaa", label: "Manage SSAA", short: "Manage", icon: Shield, dot: queue.length > 0 },
    { value: "users", label: "Users", short: "Users", icon: Users },
    { value: "sub", label: "Subcontractor", short: "Subs", icon: HardHat },
    { value: "gc", label: "General Contractor", short: "GCs", icon: Building2 },
  ];

  const searchBox = (placeholder: string) => (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );

  const manageCards: { key: Exclude<Panel, null>; title: string; description: string; icon: typeof Mail; badge?: number }[] = [
    { key: "correspondence", title: "Correspondence", description: "Manage email templates and notifications, and see everything sent", icon: Mail },
    { key: "operators", title: "Operators", description: "Manage operator accounts and permissions", icon: UserCog },
    { key: "cancellations", title: "Cancellation Requests", description: "Review and approve company account deletions", icon: Ban, badge: queue.length },
    { key: "audit", title: "Audit Log", description: "Every change an operator has made", icon: History },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Tabs value={tab} onValueChange={setTab}>
        <header className="bg-primary text-primary-foreground shadow-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold lg:text-2xl">SSAA Operator Dashboard</h1>
              {me && <p className="truncate text-xs text-primary-foreground/80">{OPERATOR_LEVEL_LABEL[me.level]}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <span className="hidden text-sm text-primary-foreground/80 md:inline">{user?.email}</span>
              {user?.companyId && (
                <Button variant="ghost" size="sm" asChild className="text-primary-foreground hover:bg-primary-foreground/10">
                  <Link to="/dashboard" aria-label="My dashboard">
                    <LayoutDashboard className="h-5 w-5 sm:mr-2 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">My dashboard</span>
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Sign out" className="text-primary-foreground hover:bg-primary-foreground/10" onClick={() => void signOut()}>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
          {/* Phone: short labels in a 3-column grid so every tab is visible without sideways scrolling. */}
          <div className="mx-auto max-w-6xl px-4 pb-3 lg:px-6">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-primary-foreground/10 p-1 sm:inline-flex sm:w-auto">
              {tabs.map(({ value, label, short, icon: Icon, dot }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="relative gap-1.5 whitespace-nowrap px-2 py-2 text-primary-foreground/80 data-[state=active]:bg-primary-foreground data-[state=active]:text-primary sm:gap-2 sm:px-4 sm:py-1.5"
                >
                  <Icon className="h-4 w-4" />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                  {dot && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive" aria-label="Needs attention" />}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </header>

        <main className="mx-auto max-w-6xl p-4 lg:px-6">
          {pageLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <TabsContent value="overview" className="mt-0">
                {overview && (
                  <OverviewTab
                    data={overview}
                    onOpenUser={setOpenUser}
                    onOpenCancellations={() => setPanel("cancellations")}
                    onOpenLog={() => setPanel("correspondence")}
                    onShowSuspended={() => {
                      setUserFilter("suspended");
                      setTab("users");
                    }}
                  />
                )}
              </TabsContent>

              {/* ---------- Manage SSAA (Lovable's ManageSSAAModal, as a page) ---------- */}
              <TabsContent value="ssaa" className="mt-0 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Manage SSAA</h2>
                  <p className="text-sm text-muted-foreground">Platform administration tools</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {manageCards.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => setPanel(card.key)}
                      className="relative flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/10"
                    >
                      {!!card.badge && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
                          {card.badge}
                        </span>
                      )}
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <card.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{card.title}</span>
                        <span className="block text-sm text-muted-foreground">{card.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                  <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-left">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/20 text-muted-foreground">
                      <CreditCard className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-muted-foreground">Subscriptions</span>
                      <span className="block text-sm text-muted-foreground">Plans and billing arrive with Stripe (not set up yet)</span>
                    </span>
                  </div>
                </div>
                {!canChange && <p className="text-sm text-muted-foreground">Your operator access is view only: you can look at everything here but not change it.</p>}
              </TabsContent>

              {/* ---------- Users ---------- */}
              <TabsContent value="users" className="mt-0 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">All users ({users.length})</h2>
                  <p className="text-sm text-muted-foreground">Open someone for their details and support actions, or view the app exactly as they see it.</p>
                </div>
                {searchBox("Search users by name, email or company…")}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
                  {(
                    [
                      ["all", "Everyone"],
                      ["operators", "Operators"],
                      ["suspended", "Suspended"],
                      ["none", "No company"],
                    ] as [UserFilter, string][]
                  ).map(([value, label]) => (
                    <Button key={value} size="sm" variant={userFilter === value ? "default" : "outline"} className="h-8 rounded-full" onClick={() => setUserFilter(value)}>
                      {label}
                    </Button>
                  ))}
                </div>
                <ul className="divide-y rounded-md border bg-card">
                  {visibleUsers.length === 0 && <li className="p-4 text-sm text-muted-foreground">No users found.</li>}
                  {visibleUsers.map((u) => (
                    <li key={u.userId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      {/* Name and email get full lines; role and company share the third. */}
                      <button type="button" onClick={() => setOpenUser(u.userId)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-medium">
                          {u.fullName || u.email}
                          {u.suspended && <span className="ml-1.5 text-xs font-normal text-destructive">Suspended</span>}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                        <div className="mt-1 flex min-w-0 items-center gap-2">
                          {u.isOperator && u.operatorLevel ? (
                            <Badge className="shrink-0">{u.operatorLevel === "owner" ? "Owner" : u.operatorLevel === "view_only" ? "Operator (view)" : "Operator"}</Badge>
                          ) : null}
                          {u.permissionLevel && (
                            <Badge variant="outline" className="shrink-0">
                              {levelLabel(u.permissionLevel)}
                            </Badge>
                          )}
                          <span className="truncate text-xs text-muted-foreground">
                            {u.companyName ?? (u.isOperator ? "" : "No company")}
                            {u.companyType && ` (${u.companyType.toUpperCase()})`}
                          </span>
                        </div>
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={u.isOperator || u.suspended || opening !== null}
                        onClick={() => void viewAs({ userId: u.userId, name: u.fullName || u.email, email: u.email, companyName: u.companyName })}
                      >
                        {opening === u.userId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                        View as
                      </Button>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              {/* ---------- Subcontractor / General Contractor ---------- */}
              {(["sub", "gc"] as const).map((type) => (
                <TabsContent key={type} value={type} className="mt-0 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">
                      {type === "gc" ? "General contractors" : "Subcontractors"} ({companies.filter((c) => c.companyType === type).length})
                    </h2>
                    <p className="text-sm text-muted-foreground">Open a company for its people, projects and requests, or see the app as its account holder.</p>
                  </div>
                  {searchBox("Search companies…")}
                  <ul className="divide-y rounded-md border bg-card">
                    {visibleCompanies.length === 0 && <li className="p-4 text-sm text-muted-foreground">No companies found.</li>}
                    {visibleCompanies.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <button type="button" onClick={() => setOpenCompany(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{c.name}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {c.members} member{c.members === 1 ? "" : "s"} · {c.projects} project{c.projects === 1 ? "" : "s"}
                              {c.primaryHolder && ` · ${c.primaryHolder.fullName || c.primaryHolder.email}`}
                            </span>
                          </span>
                        </button>
                        <Button
                          size="sm"
                          className="shrink-0"
                          disabled={!c.primaryHolder || opening !== null}
                          onClick={() =>
                            c.primaryHolder &&
                            void viewAs({
                              userId: c.primaryHolder.userId,
                              name: c.primaryHolder.fullName || c.primaryHolder.email,
                              email: c.primaryHolder.email,
                              companyName: c.name,
                            })
                          }
                        >
                          {opening === c.primaryHolder?.userId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          {c.primaryHolder ? "Open" : "No account holder"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              ))}
            </>
          )}
        </main>
      </Tabs>

      <CorrespondenceDialog
        open={panel === "correspondence"}
        onOpenChange={(o) => !o && setPanel(null)}
        onBack={() => {
          setPanel(null);
          setTab("ssaa");
        }}
        canChange={canChange}
        emailTransport={me?.email ?? "none"}
      />
      <OperatorsDialog open={panel === "operators"} onOpenChange={(o) => !o && setPanel(null)} onBack={() => setPanel(null)} meId={user?.id} />
      <CancellationsDialog
        open={panel === "cancellations"}
        onOpenChange={(o) => !o && setPanel(null)}
        onBack={() => setPanel(null)}
        canChange={canChange}
        onChanged={() => void load()}
      />
      <AuditLogDialog open={panel === "audit"} onOpenChange={(o) => !o && setPanel(null)} onBack={() => setPanel(null)} />

      <UserSheet
        userId={openUser}
        onClose={closeUser}
        canChange={canChange}
        onViewAs={(t) => void viewAs(t)}
        onOpenCompany={(id) => {
          setOpenUser(null);
          setOpenCompany(id);
        }}
        onChanged={() => void load()}
      />
      <CompanySheet
        companyId={openCompany}
        onClose={closeCompany}
        canChange={canChange}
        onViewAs={(t) => void viewAs(t)}
        onOpenUser={(id) => {
          setOpenCompany(null);
          setOpenUser(id);
        }}
        onChanged={() => void load()}
      />
      <Toaster />
    </div>
  );
}
