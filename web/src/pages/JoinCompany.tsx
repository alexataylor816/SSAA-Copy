import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { clearNext, rememberNext } from "@/lib/share";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CompanySummary {
  id: string;
  name: string;
  companyType: "gc" | "sub";
  trade: string | null;
}

/**
 * Where a company's "join my team" invite link lands: /join/company/<id>.
 * New crew members make an account and send a join request; the owner
 * approves it and chooses their access level.
 */
export default function JoinCompany() {
  const { companyId = "" } = useParams();
  const { user, initializing, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const here = `/join/company/${encodeURIComponent(companyId)}`;

  const [company, setCompany] = useState<CompanySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (initializing || !user) return;
    let cancelled = false;
    api
      .get<{ company: CompanySummary }>(`/companies/${encodeURIComponent(companyId)}/summary`)
      .then((res) => !cancelled && setCompany(res.company))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open that invite."));
    return () => {
      cancelled = true;
    };
  }, [companyId, user, initializing]);

  async function requestToJoin() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${encodeURIComponent(companyId)}/join-requests`);
      clearNext();
      await refreshProfile();
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  const kind = company?.companyType === "gc" ? "General contractor" : company?.trade ? `${company.trade} subcontractor` : "Subcontractor";

  let body: React.ReactNode;
  if (initializing) {
    body = <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />;
  } else if (!user) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to join a company&apos;s team on SSAA. Create your account, or sign in if you
          already have one. You&apos;ll come right back here.
        </p>
        <Button className="w-full" size="lg" onClick={() => (rememberNext(here), navigate("/signup"))}>
          Create my account
        </Button>
        <Button className="w-full" size="lg" variant="outline" onClick={() => (rememberNext(here), navigate("/signin"))}>
          I already have an account
        </Button>
      </div>
    );
  } else if (!company) {
    body = error ? (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button className="w-full" variant="outline" onClick={() => (clearNext(), navigate("/dashboard"))}>
          Go to my dashboard
        </Button>
      </div>
    ) : (
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
    );
  } else {
    const companyCard = (
      <div className="rounded-xl border bg-muted/30 p-4 text-left">
        <p className="text-lg font-semibold leading-tight">{company.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-4 w-4 shrink-0" />
          {kind}
        </p>
      </div>
    );
    if (user.companyId === company.id) {
      body = (
        <div className="space-y-4">
          {companyCard}
          <p className="text-sm text-muted-foreground">You&apos;re already on this team.</p>
          <Button className="w-full" size="lg" onClick={() => (clearNext(), navigate("/dashboard"))}>
            Go to my dashboard
          </Button>
        </div>
      );
    } else if (user.companyId) {
      body = (
        <div className="space-y-4">
          {companyCard}
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Your account already belongs to another company. Each account is on one company&apos;s team; use a
            different account to join this one.
          </p>
          <Button className="w-full" variant="outline" onClick={() => (clearNext(), navigate("/dashboard"))}>
            Go to my dashboard
          </Button>
        </div>
      );
    } else if (sent) {
      body = (
        <div className="space-y-4">
          {companyCard}
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            Request sent
          </p>
          <p className="text-sm text-muted-foreground">
            {company.name}&apos;s owner will approve you and set what you can do. You&apos;ll get a notification.
          </p>
          <Button className="w-full" size="lg" onClick={() => navigate("/dashboard", { state: { pendingJoinRequest: true } })}>
            Continue
          </Button>
        </div>
      );
    } else {
      body = (
        <div className="space-y-4">
          {companyCard}
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void requestToJoin()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ask to join {company.name}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      );
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 text-center shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-bold">Join a team</CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </AuthLayout>
  );
}
