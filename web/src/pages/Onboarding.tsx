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
import { peekNext } from "@/lib/share";
import { TRADES } from "@/lib/trades";
import { Building2, Users, Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { tradeLabel } from "@/i18n/labels";
import { tr } from "@/i18n/runtime";

type CompanyType = "gc" | "sub";

const SEARCH_MIN = 3;

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
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const inviteCompanyId = params.get("invite");
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // Came from a project invite link: that's a subcontractor setting up.
  const [companyType, setCompanyType] = useState<CompanyType | null>(() =>
    peekNext()?.startsWith("/join/project/") ? "sub" : null,
  );
  const [mode, setMode] = useState<"create" | "join" | null>(inviteCompanyId ? "join" : null);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [selectedTrade, setSelectedTrade] = useState("");
  const [customTrade, setCustomTrade] = useState("");
  const [showOtherTradeDialog, setShowOtherTradeDialog] = useState(false);
  const [otherTradeDraft, setOtherTradeDraft] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [invitedCompany, setInvitedCompany] = useState<Company | null>(null);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [joinTarget, setJoinTarget] = useState<string | null>(inviteCompanyId);
  const [joinSent, setJoinSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already set up (or signed in with a company attached): nothing to do here.
  useEffect(() => {
    if (user?.companyId) navigate(peekNext() ?? "/dashboard", { replace: true });
  }, [user, navigate]);

  // Joining is by name search only: the server answers a few matches for 3+
  // typed letters and never lists every company.
  const query = search.trim();
  const searchReady = query.length >= SEARCH_MIN;
  useEffect(() => {
    if (mode !== "join" || !searchReady) {
      setCompanies([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ companies: Company[] }>(`/companies?q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!cancelled) setCompanies(res.companies);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : tr("onboarding.couldNotSearch"));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query, searchReady]);

  // An invite link names the company by id; look up just that one.
  useEffect(() => {
    if (!inviteCompanyId) return;
    let cancelled = false;
    api
      .get<{ company: Company }>(`/companies/${encodeURIComponent(inviteCompanyId)}/summary`)
      .then((res) => {
        if (!cancelled) setInvitedCompany(res.company);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : tr("onboarding.couldNotFindInviter"));
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCompanyId]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!companyType) return setError(tr("onboarding.chooseType"));
    if (!companyName.trim()) return setError(tr("onboarding.companyNameRequired"));
    const trade = companyType === "sub" ? (selectedTrade === "Other" ? customTrade.trim() : selectedTrade) : "";
    if (companyType === "sub" && !trade) return setError(tr("onboarding.chooseTrade"));
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
      navigate(peekNext() ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("common.couldNotCreateCompany"));
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
      setError(err instanceof Error ? err.message : tr("onboarding.couldNotSendJoin"));
    } finally {
      setBusy(false);
    }
  }

  const joinCompany =
    companies.find((c) => c.id === joinTarget) ?? (invitedCompany?.id === joinTarget ? invitedCompany : null);

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">{t("onboarding.setUpYourCompany")}</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">
            {mode === "join" ? t("onboarding.findYourCompanyAndRequestTo") : t("onboarding.twoQuickStepsAndYouRe")}
          </p>
        </CardHeader>
        <CardContent>
          {joinSent ? (
            <div className="space-y-4 text-center">
              <CheckCircle className="mx-auto h-10 w-10 text-primary" />
              <p className="text-sm text-muted-foreground">
                
                {t("onboarding.yourRequestToJoin")}{joinCompany ? ` ${joinCompany.name}` : ""} {" "}{t("onboarding.hasBeenSentTheAccountHolder")}
              </p>
              <Button
                className="w-full"
                onClick={() => navigate("/dashboard", { state: { pendingJoinRequest: true } })}
              >
                
                {t("onboarding.goToDashboard")}
              </Button>
            </div>
          ) : mode === null ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("onboarding.whatBestDescribesYourCompany")}</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={companyType === "gc" ? "default" : "outline"}
                  className="h-auto flex-col gap-1 py-4"
                  onClick={() => setCompanyType("gc")}
                >
                  <Building2 className="h-5 w-5" />
                  
                  {t("common.generalContractor")}
                </Button>
                <Button
                  variant={companyType === "sub" ? "default" : "outline"}
                  className="h-auto flex-col gap-1 py-4"
                  onClick={() => setCompanyType("sub")}
                >
                  <Users className="h-5 w-5" />
                  
                  {t("common.subcontractor")}
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
                  if (!companyType) return setError(tr("onboarding.chooseType"));
                  setError(null);
                  setMode("create");
                }}
              >
                
                {t("common.continue")}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setMode("join")}>
                
                {t("onboarding.iMJoiningAnExistingCompany")}
              </Button>
            </div>
          ) : mode === "create" ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">{t("onboarding.companyName")}</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Smith Construction"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyAddress">{t("onboarding.addressOptional")}</Label>
                <Input
                  id="companyAddress"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              {companyType === "sub" && (
                <div className="space-y-2">
                  <Label htmlFor="trade">{t("onboarding.trade")}</Label>
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
                      <SelectValue placeholder={t("onboarding.selectYourTrade")}>
                        {selectedTrade === "Other" && customTrade ? t("onboarding.other", { customTrade: customTrade }) : tradeLabel(selectedTrade) || undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TRADES.map((trade) => (
                        <SelectItem key={trade} value={trade}>
                          {tradeLabel(trade)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                
                {t("onboarding.creatingAsA")}{" "}{companyType === "gc" ? t("onboarding.generalContractor") : "subcontractor"}.
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                
                {t("onboarding.createCompany")}
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
                
                {t("common.back")}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              {joinTarget && !joinSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    
                    {t("onboarding.youWereInvitedToJoin")}{joinCompany ? ` ${joinCompany.name}` : t("onboarding.aCompany")}{t("onboarding.sendAJoinRequestAndThe")}
                  </p>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button className="w-full" disabled={busy} onClick={() => void handleJoin(joinTarget)}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    
                    {t("onboarding.requestToJoin")}
                  </Button>
                  {!inviteCompanyId && (
                    <Button variant="ghost" className="w-full" onClick={() => setJoinTarget(null)}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      
                      {t("onboarding.chooseADifferentCompany")}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="companySearch">{t("onboarding.searchCompanies")}</Label>
                    <Input
                      id="companySearch"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("onboarding.typeYourCompanySName")}
                      autoComplete="off"
                    />
                  </div>
                  {!searchReady ? (
                    <p className="text-sm text-muted-foreground">
                      
                      {t("onboarding.typeAtLeast")}{" "}{SEARCH_MIN} {" "}{t("onboarding.lettersOfTheCompanySName")}
                    </p>
                  ) : searching && companies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("onboarding.searching")}</p>
                  ) : companies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      
                      {t("onboarding.noCompanyByThatNameCheck")}
                    </p>
                  ) : (
                    <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                      {companies.map((company) => (
                        <li key={company.id} className="flex items-center justify-between gap-2 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{company.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {company.companyType === "gc" ? t("common.generalContractor") : t("common.subcontractor")}
                            </p>
                          </div>
                          <Button size="sm" disabled={busy} onClick={() => void handleJoin(company.id)}>
                            
                            {t("onboarding.join")}
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
                    
                    {t("onboarding.createANewCompanyInstead")}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="mt-6 text-center">
            <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              
              {t("onboarding.skipForNow")}
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
            <DialogTitle>{t("onboarding.specifyYourTrade")}</DialogTitle>
            <DialogDescription>{t("onboarding.typeTheTradeThatBestDescribes")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={otherTradeDraft}
            onChange={(e) => setOtherTradeDraft(e.target.value)}
            placeholder={t("onboarding.specifyYourTrade")}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowOtherTradeDialog(false);
                if (!customTrade.trim()) setSelectedTrade("");
              }}
            >
              
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!otherTradeDraft.trim()}
              onClick={() => {
                setCustomTrade(otherTradeDraft.trim());
                setShowOtherTradeDialog(false);
              }}
            >
              
              {t("onboarding.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}
