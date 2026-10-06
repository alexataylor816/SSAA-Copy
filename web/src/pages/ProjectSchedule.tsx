import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { EVENT } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
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
import RejectRequestDialog from "@/components/RejectRequestDialog";
import ScheduleRequestPhotos from "@/components/ScheduleRequestPhotos";
import { getToken } from "@/lib/supabase";

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

/** Local calendar date; toISOString() would roll over to tomorrow in US evenings. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!projectId) return;
    // History mode looks a year back; the default window covers the
    // upcoming work only.
    const start = iso(new Date(Date.now() - (showHistory ? 365 : 7) * 86_400_000));
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
  }, [projectId, showHistory]);

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

  // The other company confirming/declining/cancelling should show up here live.
  const companyId = user?.companyId;
  useEffect(() => {
    if (!companyId || !projectId) return;
    const channel = supabase
      .channel(`company:${companyId}:project:${projectId}`)
      .on(EVENT.scheduleRequestCreated, () => void loadRequests())
      .on(EVENT.scheduleRequestUpdated, () => void loadRequests())
      .subscribe();
    return () => channel.unsubscribe();
  }, [companyId, projectId, loadRequests]);

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
        imageUrls: photoUrls.length > 0 ? photoUrls : undefined,
      });
      setOpen(false);
      setSelectedEmployees([]);
      setDescription("");
      setPhotoUrls([]);
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that request.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const token = getToken();
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Upload failed with ${res.status}.`);
      if (!payload.url) throw new Error("Upload did not return a URL.");
      setPhotoUrls((current) => (current.length >= 6 ? current : [...current, payload.url as string]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  async function setStatus(id: string, status: "confirmed" | "rejected" | "cancelled", statusReason?: string) {
    setBusy(true);
    try {
      await api.patch(`/schedule-requests/${id}`, { status, statusReason });
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that request.");
    } finally {
      setBusy(false);
    }
  }

  const [reasonDialog, setReasonDialog] = useState<{ id: string; mode: "reject" | "remove-cancel" } | null>(null);


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

                  <div className="space-y-2">
                    <Label htmlFor="photos">Photos (optional, up to 6)</Label>
                    <Input id="photos" type="file" accept="image/*" onChange={handlePhotoPicked} disabled={uploading} />
                    {uploading && <p className="text-xs text-muted-foreground">Uploading...</p>}
                    <ScheduleRequestPhotos imageUrls={photoUrls} />
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">{showHistory ? "Request history" : "Upcoming requests"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Show upcoming" : "Show history"}
            </Button>
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
                        {((request.employeeNames as string[] | undefined)?.length
                          ? (request.employeeNames as string[]).join(", ")
                          : `${(request.employeeIds as string[] | undefined)?.length ?? 0} employee(s)`) }
                        {request.description ? ` · ${String(request.description)}` : ""}
                      </p>
                      {request.requestingCompanyName || request.subCompanyName ? (
                        <p className="text-xs text-muted-foreground">
                          {String(request.requestingCompanyName ?? "")} → {String(request.subCompanyName ?? "")}
                        </p>
                      ) : null}
                      {request.statusReason ? (
                        <p className="text-xs text-muted-foreground italic">
                          {String(request.status)}: {String(request.statusReason)}
                        </p>
                      ) : null}
                      <ScheduleRequestPhotos imageUrls={(request.imageUrls as string[] | undefined) ?? []} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{STATUS_LABELS[String(request.status)] ?? String(request.status)}</Badge>
                      {hasPartialOrHigher && request.subCompanyId === companyId && request.status === "pending" && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => void setStatus(String(request.id), "confirmed")}>
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setReasonDialog({ id: String(request.id), mode: "reject" })}
                          >
                            Decline
                          </Button>
                        </>
                      )}
                      {hasPartialOrHigher &&
                        request.requestingCompanyId === companyId &&
                        (request.status === "pending" || request.status === "confirmed") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setReasonDialog({ id: String(request.id), mode: "remove-cancel" })}
                          >
                            Cancel
                          </Button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
      <RejectRequestDialog
        open={reasonDialog !== null}
        onOpenChange={(isOpen) => !isOpen && setReasonDialog(null)}
        mode={reasonDialog?.mode ?? "reject"}
        onConfirm={(reason) => {
          if (!reasonDialog) return;
          const status = reasonDialog.mode === "remove-cancel" ? "cancelled" : "rejected";
          setReasonDialog(null);
          void setStatus(reasonDialog.id, status, reason);
        }}
      />
    </div>
  );
}