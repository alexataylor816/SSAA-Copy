import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Download } from "lucide-react";

interface RosterEmployee {
  id: string;
  name: string;
  /** Payroll/HR ID from the profile; the column stays blank without one. */
  employeeNumber?: string | null;
}

interface RequestRow {
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  projectId: string;
  requestingCompanyName?: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Subcontractor timesheet export (the TimesheetDownloadCard half of the
 * Lovable ProfilesModal). Confirmed schedule requests become CSV rows;
 * entirely client-side on top of existing list endpoints.
 */
export default function TimesheetDownloadCard({ employees }: { employees: RosterEmployee[] }) {
  const { toast } = useToast();
  const [weeks, setWeeks] = useState("1");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (employees.length === 0) {
      toast({ title: "No Employees", description: "There are no employees to generate timesheets for.", variant: "destructive" });
      return;
    }
    const now = new Date();
    let start: string;
    let end: string;
    let label: string;
    if (customStart && customEnd) {
      if (customStart > customEnd) {
        toast({ title: "Invalid range", description: "Start date must be before end date.", variant: "destructive" });
        return;
      }
      start = customStart;
      end = customEnd;
      label = `${customStart}_to_${customEnd}`;
    } else {
      const from = new Date(now);
      from.setDate(from.getDate() - Number(weeks) * 7);
      start = iso(from);
      end = iso(now);
      label = `${weeks}wk`;
    }

    setDownloading(true);
    try {
      const [requestsRes, projectsRes] = await Promise.all([
        api.get<{ requests: RequestRow[] }>(`/schedule-requests?start=${start}&end=${end}`),
        api.get<{ projects: ProjectRow[] }>("/projects"),
      ]);
      const projectNames = new Map(projectsRes.projects.map((p) => [p.id, p.name]));
      const rosterIds = new Set(employees.map((e) => e.id));
      const names = new Map(employees.map((e) => [e.id, e.name]));
      const hrIds = new Map(employees.map((e) => [e.id, e.employeeNumber ?? ""]));

      const rows = ["Employee ID,Employee Name,Date,Start Time,End Time,Hours,Job Name,General Contractor"];
      for (const req of requestsRes.requests) {
        if (req.status !== "confirmed" || !req.startTime || !req.endTime) continue;
        const [sh, sm] = req.startTime.split(":").map(Number);
        const [eh, em] = req.endTime.split(":").map(Number);
        const hours = ((eh * 60 + em - (sh * 60 + sm)) / 60).toFixed(2);
        for (const empId of req.employeeIds) {
          if (!rosterIds.has(empId)) continue;
          rows.push(
            [
              // The HR/payroll ID from the profile, not the internal row id.
              hrIds.get(empId) ?? "",
              names.get(empId) ?? "Unknown",
              req.date,
              fmt12(req.startTime),
              fmt12(req.endTime),
              hours,
              projectNames.get(req.projectId) ?? "Unknown",
              req.requestingCompanyName ?? "",
            ].map(csvCell).join(","),
          );
        }
      }

      if (rows.length === 1) {
        toast({ title: "No Data", description: "No timesheet records found for the selected period." });
        return;
      }

      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timesheets_${label}_${iso(now)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download Complete", description: `${rows.length - 1} timesheet records exported.` });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to download timesheets.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" />
          Download Timesheets
        </CardTitle>
        <CardDescription>Export confirmed schedule hours as CSV</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="ts-weeks">Period</Label>
            <select
              id="ts-weeks"
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="1">Last week</option>
              <option value="2">Last 2 weeks</option>
              <option value="4">Last 4 weeks</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ts-start">Custom start (optional)</Label>
            <Input id="ts-start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ts-end">Custom end (optional)</Label>
            <Input id="ts-end" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
          <Button onClick={() => void handleDownload()} disabled={downloading}>
            <Download className="mr-2 h-4 w-4" />
            {downloading ? "Preparing…" : "Download CSV"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
