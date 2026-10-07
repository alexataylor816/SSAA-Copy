import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

interface Connection {
  id: string;
  companyAId: string;
  companyBId: string;
  mainCompanyId: string | null;
  status: "pending" | "accepted" | "declined";
  initiatedByCompanyId: string;
  proposedMainCompanyId: string | null;
  roleChangeRequest: {
    proposedMainCompanyId: string;
    requestedByCompanyId: string;
  } | null;
  otherCompanyId: string;
  otherCompanyName: string | null;
  direction: "outgoing" | "incoming" | "active";
}

interface Company {
  id: string;
  name: string;
  companyType: string;
}

interface Project {
  id: string;
  name: string;
  companyId: string;
}

interface Link {
  projectId: string;
  mainCompanyId: string;
  subCompanyId: string;
  shared: boolean;
}

/**
 * Standing company relationships (the ConnectedContractorsTab port, page-card
 * form). Separate from per-project connection codes: these are persistent
 * GC↔sub / sub↔sub links with request/respond, main/sub roles, per-project
 * sharing, and two-step role swaps.
 */
export default function ConnectedCompaniesCard({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [links, setLinks] = useState<Record<string, Link[]>>({});
  const [search, setSearch] = useState("");
  const [proposedRole, setProposedRole] = useState<"main" | "sub">("sub");
  const [linkProject, setLinkProject] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [conns, allCompanies, allProjects] = await Promise.all([
        api.get<{ connections: Connection[] }>("/contractor-connections"),
        api.get<{ companies: Company[] }>("/companies"),
        api.get<{ projects: Project[] }>("/projects"),
      ]);
      setConnections(conns.connections);
      setCompanies(allCompanies.companies.filter((c) => c.id !== companyId));
      setProjects(allProjects.projects);
      const linkEntries = await Promise.all(
        conns.connections
          .filter((c) => c.status === "accepted")
          .map(async (c) => {
            try {
              const res = await api.get<{ links: Link[] }>(`/contractor-connections/${c.id}/projects`);
              return [c.id, res.links] as const;
            } catch {
              return [c.id, []] as const;
            }
          }),
      );
      setLinks(Object.fromEntries(linkEntries));
    } catch (err) {
      toast({
        title: "Could not load connected companies",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, [companyId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const connectedIds = new Set(connections.map((c) => c.otherCompanyId));
  const candidates = companies
    .filter((c) => !connectedIds.has(c.id))
    .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 8);
  const ownProjects = projects.filter((p) => p.companyId === companyId);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Connected companies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No standing connections yet. Connect with companies you work with regularly — separate from
            per-project connection codes.
          </p>
        ) : (
          <ul className="divide-y">
            {connections.map((conn) => {
              const iAmMain = conn.mainCompanyId === companyId;
              const pendingSwap = conn.roleChangeRequest;
              const swapMine = pendingSwap?.requestedByCompanyId === companyId;
              return (
                <li key={conn.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{conn.otherCompanyName ?? "Unknown company"}</p>
                      <p className="text-sm text-muted-foreground">
                        {conn.status === "accepted"
                          ? iAmMain
                            ? "They work under you on shared projects"
                            : "You work under them on shared projects"
                          : conn.direction === "incoming"
                            ? "Wants to connect — you proposed as main"
                            : "Request sent — waiting on them"}
                        {pendingSwap && (
                          <>
                            {" · "}
                            {swapMine ? "you asked to flip roles" : "they asked to flip roles"}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={conn.status === "accepted" ? "secondary" : "outline"}>{conn.status}</Badge>
                      {conn.status === "pending" && conn.direction === "incoming" && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run("Connection accepted", () =>
                                api.post(`/contractor-connections/${conn.id}/respond`, { accept: true }),
                              )
                            }
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run("Connection declined", () =>
                                api.post(`/contractor-connections/${conn.id}/respond`, { accept: false }),
                              )
                            }
                          >
                            Decline
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run("Connection removed", () => api.delete(`/contractor-connections/${conn.id}`))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {conn.status === "accepted" && (
                    <div className="space-y-2 rounded-md border p-3">
                      {(links[conn.id] ?? []).length > 0 && (
                        <ul className="space-y-1">
                          {(links[conn.id] ?? []).map((link) => (
                            <li key={link.projectId} className="flex items-center justify-between gap-2 text-sm">
                              <span>
                                {projectNames.get(link.projectId) ?? "Project"}
                                {link.shared ? (
                                  <Badge variant="secondary" className="ml-2">
                                    shared
                                  </Badge>
                                ) : null}
                              </span>
                              {iAmMain && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void run("Project unlinked", () =>
                                      api.delete(`/contractor-connections/${conn.id}/projects/${link.projectId}`),
                                    )
                                  }
                                >
                                  Unlink
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {iAmMain && ownProjects.length > 0 && (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-40 flex-1 space-y-1">
                            <Label htmlFor={`link-${conn.id}`}>Share a project</Label>
                            <select
                              id={`link-${conn.id}`}
                              value={linkProject[conn.id] ?? ""}
                              onChange={(e) => setLinkProject((m) => ({ ...m, [conn.id]: e.target.value }))}
                              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              <option value="">Select a project</option>
                              {ownProjects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Button
                            size="sm"
                            disabled={busy || !linkProject[conn.id]}
                            onClick={() =>
                              void run("Project shared", () =>
                                api.post(`/contractor-connections/${conn.id}/projects`, {
                                  projectId: linkProject[conn.id],
                                  shared: true,
                                }),
                              )
                            }
                          >
                            Share
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(pendingSwap && !swapMine ? "Roles swapped" : "Role swap requested", () =>
                              api.post(`/contractor-connections/${conn.id}/role-swap`, {
                                proposedMainCompanyId: iAmMain ? conn.otherCompanyId : companyId,
                              }),
                            )
                          }
                        >
                          {pendingSwap && !swapMine ? "Confirm role swap" : iAmMain ? "Offer them the lead" : "Ask for the lead"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-2">
              <Label htmlFor="connectSearch">Connect with another company</Label>
              <Input
                id="connectSearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a company name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposedRole">Propose us as</Label>
              <select
                id="proposedRole"
                value={proposedRole}
                onChange={(e) => setProposedRole(e.target.value as "main" | "sub")}
                className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="sub">Sub</option>
                <option value="main">Main</option>
              </select>
            </div>
          </div>
          {search.trim() && (
            <ul className="divide-y rounded-md border">
              {candidates.length === 0 ? (
                <li className="p-3 text-sm text-muted-foreground">No matching companies.</li>
              ) : (
                candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.companyType === "gc" ? "General contractor" : "Subcontractor"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run("Connection requested", () =>
                          api.post("/contractor-connections", {
                            otherCompanyId: c.id,
                            proposedRole,
                          }),
                        ).then(() => setSearch(""))
                      }
                    >
                      Connect
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
