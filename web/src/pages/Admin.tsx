import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Navigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Toaster } from "@/components/ui/toaster";

interface AdminCompany {
  id: string;
  name: string;
  companyType: string;
  members: number;
  projects: number;
}

interface Operator {
  userId: string;
  email: string;
  fullName: string;
}

interface DeletionRequest {
  id: string;
  companyId: string;
  companyName: string | null;
  reason: string | null;
  createdAt: string;
}

interface Template {
  id: string;
  eventType: string;
  channel: string;
  subject: string;
  bodyHtml: string;
  description: string | null;
  isActive: boolean;
  placeholderVariables: string[];
}

const SAMPLES: Record<string, string> = {
  gc_name: "ABC Contracting",
  sub_name: "Bao Plumbing",
  crew: "2 people",
  day: "Thu, Oct 9",
  project_name: "Tower A",
  date: "2026-10-09",
  user_name: "Sam Framer",
  company_name: "Bao Plumbing",
};

function preview(template: Template): string {
  let out = `<strong>${template.subject}</strong><br/>${template.bodyHtml}`;
  for (const v of template.placeholderVariables) {
    out = out.split(`{{${v}}}`).join(SAMPLES[v] ?? `[${v}]`);
  }
  out = out.replace(/\{\{[^}]+\}\}/g, (m) => `[${m.slice(2, -2)}]`);
  return out;
}

/**
 * Minimal platform-admin surface (no billing, no impersonation): company
 * overview, operator grants, the company-deletion queue, and notification
 * template editing. `isMOA` here means the local `isAdmin` flag.
 */
export default function Admin() {
  const { user, isMOA, initializing, loading } = useAuth();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [queue, setQueue] = useState<DeletionRequest[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [opEmail, setOpEmail] = useState("");
  const [editing, setEditing] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, o, q, t] = await Promise.all([
        api.get<{ companies: AdminCompany[] }>("/admin/companies"),
        api.get<{ operators: Operator[] }>("/admin/operators"),
        api.get<{ requests: DeletionRequest[] }>("/admin/deletion-requests"),
        api.get<{ templates: Template[] }>("/admin/templates"),
      ]);
      setCompanies(c.companies);
      setOperators(o.operators);
      setQueue(q.requests);
      setTemplates(t.templates);
    } catch (err) {
      toast({
        title: "Could not load admin data",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPageLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!initializing && !loading && isMOA) void load();
    if (!initializing && !loading && !isMOA) setPageLoading(false);
  }, [initializing, loading, isMOA, load]);

  if (!initializing && !loading && !isMOA) return <Navigate to="/dashboard" replace />;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      toast({ title: label });
    } catch (err) {
      toast({
        title: label,
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await run("Template saved", () =>
      api.patch(`/admin/templates/${editing.id}`, {
        subject: editing.subject,
        bodyHtml: editing.bodyHtml,
        channel: editing.channel,
        isActive: editing.isActive,
      }),
    );
    setEditing(null);
  }

  function insertToken(token: string) {
    setEditing((e) => (e ? { ...e, bodyHtml: `${e.bodyHtml}{{${token}}}` } : e));
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <h1 className="text-lg font-bold">Administration</h1>
          </div>
          <span className="text-sm text-muted-foreground">Signed in as {user?.email}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4">
        {pageLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Companies ({companies.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {companies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No companies yet.</p>
                ) : (
                  <ul className="divide-y">
                    {companies.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.companyType === "gc" ? "General contractor" : "Subcontractor"} · {c.members}{" "}
                            member{c.members === 1 ? "" : "s"} · {c.projects} project{c.projects === 1 ? "" : "s"}
                          </p>
                        </div>
                        <Badge variant="outline">{c.companyType}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Operators</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y">
                  {operators.map((o) => (
                    <li key={o.userId} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{o.fullName || o.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{o.email}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || o.userId === user?.id}
                        onClick={() =>
                          void run("Operator access revoked", () =>
                            api.post("/admin/operators", { userId: o.userId, isAdmin: false }),
                          )
                        }
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!opEmail.trim()) return;
                    void run("Operator access granted", () => api.post("/admin/operators", { email: opEmail.trim() })).then(
                      () => setOpEmail(""),
                    );
                  }}
                  className="flex flex-wrap items-end gap-2 border-t pt-4"
                >
                  <div className="min-w-40 flex-1 space-y-2">
                    <Label htmlFor="opEmail">Grant operator access by email</Label>
                    <Input
                      id="opEmail"
                      type="email"
                      value={opEmail}
                      onChange={(e) => setOpEmail(e.target.value)}
                      placeholder="person@company.com"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={busy}>
                    Grant
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Company deletion queue ({queue.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {queue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
                ) : (
                  <ul className="divide-y">
                    {queue.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{r.companyName ?? "Unknown company"}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.reason ? `“${r.reason}” · ` : ""}
                            {new Date(r.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                              void run("Company deleted", () =>
                                api.post(`/admin/deletion-requests/${r.id}/resolve`, { approve: true }),
                              )
                            }
                          >
                            Approve &amp; delete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run("Request rejected", () =>
                                api.post(`/admin/deletion-requests/${r.id}/resolve`, { approve: false }),
                              )
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notification templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="divide-y">
                  {templates.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span className="font-mono text-xs">{t.eventType}</span>
                          {!t.isActive && (
                            <Badge variant="outline" className="ml-2">
                              off
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{t.description ?? t.subject}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setEditing({ ...t })}>
                        Edit
                      </Button>
                    </li>
                  ))}
                </ul>

                {editing && (
                  <form onSubmit={saveTemplate} className="space-y-3 rounded-md border p-4">
                    <p className="font-mono text-sm font-medium">{editing.eventType}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="tplSubject">Subject</Label>
                        <Input
                          id="tplSubject"
                          value={editing.subject}
                          onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex-1 space-y-2">
                          <Label htmlFor="tplChannel">Channel</Label>
                          <select
                            id="tplChannel"
                            value={editing.channel}
                            onChange={(e) => setEditing({ ...editing, channel: e.target.value })}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="email">email</option>
                            <option value="sms">sms</option>
                            <option value="bell">bell</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editing.isActive}
                            onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                          />
                          Active
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tplBody">Body (HTML, {"{{tokens}}"} supported)</Label>
                      <Textarea
                        id="tplBody"
                        rows={5}
                        value={editing.bodyHtml}
                        onChange={(e) => setEditing({ ...editing, bodyHtml: e.target.value })}
                        className="font-mono text-xs"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {editing.placeholderVariables.map((v) => (
                          <Button key={v} type="button" size="sm" variant="outline" onClick={() => insertToken(v)}>
                            {`{{${v}}}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md border bg-muted/40 p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
                      <div className="text-sm" dangerouslySetInnerHTML={{ __html: preview(editing) }} />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy}>
                        Save template
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <Toaster />
    </div>
  );
}
