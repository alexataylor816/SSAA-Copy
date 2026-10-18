import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Building2, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { clearNext, rememberNext } from "@/lib/share";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Preview {
  project: { id: string; name: string; address: string | null };
  gcCompanyName: string;
  yourCompanyName: string | null;
  status: "own" | "connected" | "available";
  canConnect: boolean;
  reason: string | null;
}

/**
 * Where a project invite link (or a typed code) lands: /join/project/<connection code>.
 * Walks the person through whatever is missing (sign in, account, company)
 * and comes back here, then connects their subcontractor company in one tap.
 */
export default function JoinProject() {
  const { code = "" } = useParams();
  const { user, initializing } = useAuth();
  const navigate = useNavigate();
  const here = `/join/project/${encodeURIComponent(code)}`;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  const hasCompany = Boolean(user?.companyId);

  useEffect(() => {
    if (initializing || !user) return;
    let cancelled = false;
    api
      .get<Preview>(`/projects/preview?code=${encodeURIComponent(code)}`)
      .then((res) => !cancelled && setPreview(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open that project."));
    return () => {
      cancelled = true;
    };
  }, [code, user, initializing]);

  function goSetUp(path: string) {
    rememberNext(here);
    navigate(path);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/projects/connect", { code });
      clearNext();
      setJoined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to that project.");
    } finally {
      setBusy(false);
    }
  }

  // Leaving the join flow: forget the remembered link so later sign-ins go to the dashboard.
  const leave = (path: string) => {
    clearNext();
    navigate(path);
  };
  const openProject = () => leave(preview ? `/dashboard?project=${preview.project.id}` : "/dashboard");

  let body: React.ReactNode;
  if (initializing) {
    body = <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />;
  } else if (!user) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A general contractor invited your company to one of their projects. Sign in or create an account to
          connect. You&apos;ll come right back here.
        </p>
        <Button className="w-full" size="lg" onClick={() => goSetUp("/signin")}>
          Sign in
        </Button>
        <Button className="w-full" size="lg" variant="outline" onClick={() => goSetUp("/signup")}>
          Create an account
        </Button>
      </div>
    );
  } else if (error && !preview) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button className="w-full" variant="outline" onClick={() => leave("/dashboard")}>
          Go to my dashboard
        </Button>
      </div>
    );
  } else if (!preview) {
    body = <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />;
  } else {
    const projectCard = (
      <div className="rounded-xl border bg-muted/30 p-4 text-left">
        <p className="text-lg font-semibold leading-tight">{preview.project.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 shrink-0" />
          {preview.gcCompanyName}
        </p>
        {preview.project.address && (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            {preview.project.address}
          </p>
        )}
      </div>
    );

    if (joined || preview.status === "connected") {
      body = (
        <div className="space-y-4">
          {projectCard}
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            {joined ? "Connected" : "Already connected"}. {preview.gcCompanyName} can now schedule your crew.
          </p>
          <Button className="w-full" size="lg" onClick={openProject}>
            Open the project
          </Button>
        </div>
      );
    } else if (preview.status === "own") {
      body = (
        <div className="space-y-4">
          {projectCard}
          <p className="text-sm text-muted-foreground">This is your company&apos;s project. Share this code with your subcontractors.</p>
          <Button className="w-full" size="lg" onClick={openProject}>
            Open the project
          </Button>
        </div>
      );
    } else if (!hasCompany) {
      body = (
        <div className="space-y-4">
          {projectCard}
          <p className="text-sm text-muted-foreground">Set up your subcontractor company first. You&apos;ll come right back here.</p>
          <Button className="w-full" size="lg" onClick={() => goSetUp("/onboarding")}>
            Set up my company
          </Button>
        </div>
      );
    } else {
      body = (
        <div className="space-y-4">
          {projectCard}
          {preview.canConnect ? (
            <Button className="w-full" size="lg" disabled={busy} onClick={() => void connect()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect {preview.yourCompanyName ?? "my company"}
            </Button>
          ) : (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{preview.reason}</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Link to="/dashboard" onClick={clearNext} className="block text-sm text-muted-foreground hover:text-primary">
            Not now
          </Link>
        </div>
      );
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 text-center shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-bold">Join a project</CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </AuthLayout>
  );
}
