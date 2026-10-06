import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AuthLayout from "@/components/AuthLayout";
import { TRADES } from "@/lib/trades";
import { Building2, Users, Loader2, ArrowLeft, CheckCircle } from "lucide-react";

type CompanyType = "gc" | "sub";

interface Company {
  id: string;
  name: string;
  companyType: CompanyType;
}

/**
 * Slim port of the Lovable `Onboarding` flow, limited to what the backend
 * actually supports. Deliberately NOT ported: subscription plans (Stripe is
 * descoped), discount codes, and the guest-GC flow — those have no backend
 * counterpart, so a 1:1 copy would be buttons that 404.
 *
 * Steps: 1) GC or Sub → 2) create a company or join an existing one →
 * dashboard. `?invite=<companyId>` preselects the join path for that company.
 * Subs pick a trade (with free-text Other) during creation.
 */
export default function Onboarding() {
  const [params] = useSearchParams();
  const inviteCompanyId = params.get("invite");
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [companyType, setCompanyType] = useState<CompanyType | null>(null);
  const [mode, setMode] = useState<"create" | "join" | null>(inviteCompanyId ? "join" : null);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [selectedTrade, setSelectedTrade] = useState("");
  const [customTrade, setCustomTrade] = useState("");
  const [showOtherTradeDialog, setShowOtherTradeDialog] = useState(false);
  const [otherTradeDraft, setOtherTradeDraft] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [joinTarget, setJoinTarget] = useState<string | null>(inviteCompanyId);
  const [joinSent, setJoinSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already set up (or signed in with a company attached): nothing to do here.
  useEffect(() => {
    if (user?.companyId) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (mode !== "join" || companies.length > 0) return;
    let cancelled = false;
    setBusy(true);
    api
      .get<{ companies: Company[] }>("/companies")
      .then((res) => {
        if (!cancelled) setCompanies(res.companies);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load companies.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, companies.length]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!companyType) return setError("Choose whether you're a general contractor or a subcontractor.");
    if (!companyName.trim()) return setError("Company name is required.");
    const trade = companyType === "sub" ? (selectedTrade === "Other" ? customTrade.trim() : selectedTrade) : "";
    if (companyType === "sub" && !trade) return setError("Choose your trade.");
    setError(null);
    setBusy(true);
    try {
      await api.post("/companies", {
        name: companyName.trim(),
        companyType,
        address: companyAddress.trim() || undefined,
        trade: trade || undefined,
      });
      await refreshProfile();
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that company.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(companyId: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/companies/${companyId}/join-requests`);
      setJoinTarget(companyId);
      setJoinSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that join request.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = companies.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const joinCompany = companies.find((c) => c.id === joinTarget) ?? null;

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">Set up your company</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">
            {mode === "join" ? "Find your company and request to join" : "Two quick steps and you're scheduling"}
          </p>
        </CardHeader>
        <CardContent>
          {joinSent ? (
            <div className="space-y-4 text-center">
              <CheckCircle className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground">
                Your request to join{joinCompany ? ` ${joinCompany.name}` : ""} has been sent. The account holder
                needs to approve it before you can start scheduling.
              </p>
              <Button
                className="w-full"
                onClick={() => navigate("/dashboard", { state: { pendingJoinRequest: true } })}
              >
                Go to dashboard
              </Button>
            </div>
          ) : mode === null ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">What best describes your company?</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={companyType === "gc" ? "default" : "outline"}
                  className="h-auto flex-col gap-1 py-4"
                  onClick={() => setCompanyType("gc")}
                >
                  <Building2 className="h-5 w-5" />
                  General contractor
                </Button>
                <Button
                  variant={companyType === "sub" ? "default" : "outline"}
                  className="h-auto flex-col gap-1 py-4"
                  onClick={() => setCompanyType("sub")}
                >
                  <Users className="h-5 w-5" />
                  Subcontractor
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                className="w-full"
                disabled={!companyType}
                onClick={() => {
                  if (!companyType) return setError("Choose whether you're a general contractor or a subcontractor.");
                  setError(null);
                  setMode("create");
                }}
              >
                Continue
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setMode("join")}>
                I&apos;m joining an existing company instead
              </Button>
            </div>
          ) : mode === "create" ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">Company name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Smith Construction"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyAddress">Address (optional)</Label>
                <Input
                  id="companyAddress"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              {companyType === "sub" && (
                <div className="space-y-2">
                  <Label htmlFor="trade">Trade</Label>
                  <Select
                    value={selectedTrade}
                    onValueChange={(val) => {
                      setSelectedTrade(val);
                      if (val === "Other") {
                        setOtherTradeDraft(customTrade);
                        setShowOtherTradeDialog(true);
                      } else {
                        setCustomTrade("");
                      }
                    }}
                  >
                    <SelectTrigger id="trade">
                      <SelectValue placeholder="Select your trade">
                        {selectedTrade === "Other" && customTrade ? `Other: ${customTrade}` : selectedTrade || undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TRADES.map((trade) => (
                        <SelectItem key={trade} value={trade}>
                          {trade}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Creating as a {companyType === "gc" ? "general contractor" : "subcontractor"}.
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create company
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setMode(inviteCompanyId ? "join" : null);
                  setError(null);
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              {joinTarget && !joinSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    You were invited to join{joinCompany ? ` ${joinCompany.name}` : " a company"}. Send a join
                    request and the account holder will approve it.
                  </p>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button className="w-full" disabled={busy} onClick={() => void handleJoin(joinTarget)}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Request to join
                  </Button>
                  {!inviteCompanyId && (
                    <Button variant="ghost" className="w-full" onClick={() => setJoinTarget(null)}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Choose a different company
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="companySearch">Search companies</Label>
                    <Input
                      id="companySearch"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Start typing a company name"
                    />
                  </div>
                  {busy && companies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading companies...</p>
                  ) : filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No companies match that search.</p>
                  ) : (
                    <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                      {filtered.map((company) => (
                        <li key={company.id} className="flex items-center justify-between gap-2 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{company.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {company.companyType === "gc" ? "General contractor" : "Subcontractor"}
                            </p>
                          </div>
                          <Button size="sm" disabled={busy} onClick={() => void handleJoin(company.id)}>
                            Join
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button variant="ghost" className="w-full" onClick={() => setMode("create")}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Create a new company instead
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="mt-6 text-center">
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Skip for now
            </Link>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={showOtherTradeDialog}
        onOpenChange={(isOpen) => {
          setShowOtherTradeDialog(isOpen);
          if (!isOpen && !customTrade.trim()) setSelectedTrade("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Specify your trade</DialogTitle>
            <DialogDescription>Type the trade that best describes your work.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={otherTradeDraft}
            onChange={(e) => setOtherTradeDraft(e.target.value)}
            placeholder="Specify your trade"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowOtherTradeDialog(false);
                if (!customTrade.trim()) setSelectedTrade("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!otherTradeDraft.trim()}
              onClick={() => {
                setCustomTrade(otherTradeDraft.trim());
                setShowOtherTradeDialog(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}
