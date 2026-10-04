import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CalendarDays, Plus } from "lucide-react";

interface ConnectedCompany {
  id: string;
  name: string;
  companyType: string;
}

interface Employee {
  id: string;
  name: string;
  companyId: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ProjectSchedule() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, hasPartialOrHigher } = useAuth();

  const [companies, setCompanies] = useState<ConnectedCompany[]>([]);
  const [subCompanyId, setSubCompanyId] = useState<string>("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [date, setDate] = useState(iso(new Date()));
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("12:00");
  const [description, setDescription] = useState("");
  const [requests, setRequests] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!projectId) return;
    const start = iso(new Date(Date.now() - 7 * 86_400_000));
    const end = iso(new Date(Date.now() + 30 * 86_400_000));
    try {
      const res = await api.get<{ requests: Record<string, unknown>[] }>(
        `/schedule-requests?start=${start}&end=${end}`,
      );
      // The dashboard lists requests across every project; keep just this one.
      setRequests(res.requests.filter((r) => r.projectId === projectId));
    } catch {
      setRequests([]);
    }
  }, [projectId]);

  const loadCompanies = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<{ companies: ConnectedCompany[] }>(`/projects/${projectId}/connections`);
      setCompanies(res.companies);
    } catch {
      setCompanies([]);
    }
  }, [projectId]);

  const loadEmployees = useCallback(async () => {
    if (!projectId || !subCompanyId) {
      setEmployees([]);
      return;
    }
    try {
      const res = await api.get<{ employees: Employee[] }>(
        `/companies/${subCompanyId}/connected-employees`,
      );
      setEmployees(res.employees);
    } catch {
      setEmployees([]);
    }
  }, [projectId, subCompanyId]);

  useEffect(() => {
    void loadRequests();
    void loadCompanies();
  }, [loadRequests, loadCompanies]);

  useEffect(() => {
    void loadEmployees();
    setSelectedEmployees([]);
  }, [loadEmployees]);

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) return;
    if (!subCompanyId) return setError("Choose a company to schedule.");
    if (selectedEmployees.length === 0) return setError("Pick at least one employee.");

    setBusy(true);
    setError(null);
    try {
      await api.post("/schedule-requests", {
        projectId,
        subCompanyId,
        employeeIds: selectedEmployees,
        date,
        startTime,
        endTime,
        description: description.trim() || undefined,
      });
      setOpen(false);
      setSelectedEmployees([]);
      setDescription("");
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that request.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "confirmed" | "rejected" | "cancelled") {
    setBusy(true);
    try {
      await api.patch(`/schedule-requests/${id}`, { status });
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that request.");
    } finally {
      setBusy(false);
    }
  }

  const canRespond = useMemo(
    () => requests.some((r) => r.subCompanyId === user?.companyId && r.status === "pending"),
    [requests, user],
  );

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
            <h1 className="text-lg font-bold">Project schedule</h1>
          </div>
          {hasPartialOrHigher && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Request crew
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request crew</DialogTitle>
                  <DialogDescription>
                    Pick the sub company, then the people you need. They will see this request immediately.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={submitRequest} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="subCompanyId">Company</Label>
                    <select
                      id="subCompanyId"
                      value={subCompanyId}
                      onChange={(e) => setSubCompanyId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select a connected company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label>Employees</Label>
                    {employees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {subCompanyId ? "This company has no employees available." : "Choose a company first."}
                      </p>
                    ) : (
                      <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">
                        {employees.map((employee) => (
                          <label key={employee.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={selectedEmployees.includes(employee.id)}
                              onCheckedChange={() => toggleEmployee(employee.id)}
                            />
                            {employee.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-3 space-y-2 sm:col-span-1">
                      <Label htmlFor="date">Date</Label>
                      <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="startTime">Start</Label>
                      <Input
                        id="startTime"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="endTime">End</Label>
                      <Input id="endTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Notes</Label>
                    <Input
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Anything the crew should know"
                    />
                  </div>

                  <DialogFooter>
                    <Button type="submit" disabled={busy}>
                      Send request
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upcoming requests</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
            ) : (
              <ul className="divide-y">
                {requests.map((request) => (
                  <li key={String(request.id)} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        {String(request.date)} {String(request.startTime ?? "")} - {String(request.endTime ?? "")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {(request.employeeIds as string[] | undefined)?.length ?? 0} employee(s)
                        {request.description ? ` · ${String(request.description)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{STATUS_LABELS[String(request.status)] ?? String(request.status)}</Badge>
                      {canRespond && request.status === "pending" && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => void setStatus(String(request.id), "confirmed")}>
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void setStatus(String(request.id), "rejected")}
                          >
                            Decline
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}