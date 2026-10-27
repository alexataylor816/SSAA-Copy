import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Sparkles, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/supabase";
import { matrixApi } from "@/lib/matrixApi";
import { createTask } from "@/lib/tasks";
import { fmtTime } from "@/lib/timeWindows";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The GC's AI Schedule Recommender and Upload Schedule (docs/AI_SCHEDULE_RECOMMENDER.md).
 * Generate → review every suggestion (headcount, people, which days) → Send. Nothing is sent without review.
 */

interface Person {
  id: string;
  name: string;
  jobTitle: string | null;
  assigned: boolean;
}
interface Suggestion {
  key: string;
  taskName: string;
  trade: string;
  tradeReason: string;
  crewReason: string;
  projectId: string;
  subCompanyId: string;
  subName: string;
  date: string;
  startTime: string;
  endTime: string;
  suggestedCount: number;
  employees: Person[];
  alternates: Person[];
}
interface Question {
  taskName: string;
  options: string[];
  suggested: string | null;
  why: string;
}
interface Recommendation {
  window: { start: string; end: string };
  suggestions: Suggestion[];
  questions: Question[];
  notes: string[];
  claude: { configured: boolean; used: boolean };
}
interface UploadedTask {
  name: string;
  startDate: string;
  endDate: string;
  trade: string | null;
  sure: boolean;
  color: string;
}

const TRADE_COLORS: Record<string, string> = {
  Demolition: "#78716c",
  Drywall: "#16a34a",
  Plumbing: "#0284c7",
  HVAC: "#ea580c",
  Electrical: "#ca8a04",
  "Fire Protection": "#dc2626",
  Painting: "#9333ea",
  Concrete: "#475569",
  Flooring: "#db2777",
  Carpentry: "#a16207",
};

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function AiSchedulePanel({
  projects,
  defaultProjectId,
  onChanged,
}: {
  projects: { id: string; name: string }[];
  defaultProjectId: string | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [weeks, setWeeks] = useState(1);
  const [claudeReady, setClaudeReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<Recommendation | null>(null);
  // Per suggestion: included?, and the people the GC kept.
  const [rows, setRows] = useState<Record<string, { on: boolean; people: Person[]; spare: Person[] }>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedTask[] | null>(null);
  const [uploadNotes, setUploadNotes] = useState("");

  useEffect(() => {
    if (defaultProjectId && projects.some((p) => p.id === defaultProjectId)) setProjectId(defaultProjectId);
  }, [defaultProjectId, projects]);
  useEffect(() => {
    api.get<{ claude: boolean }>("/ai/status").then((r) => setClaudeReady(r.claude)).catch(() => setClaudeReady(false));
  }, []);

  const projectName = projects.find((p) => p.id === projectId)?.name ?? "the project";

  const generate = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await api.post<Recommendation>("/ai/recommendations", { projectId, weeks });
      setRec(r);
      setRows(Object.fromEntries(r.suggestions.map((s) => [s.key, { on: true, people: s.employees, spare: s.alternates }])));
      setAnswers(Object.fromEntries(r.questions.map((q) => [q.taskName, q.suggested ?? ""])));
    } catch (err) {
      toast({ title: "Couldn't generate a schedule", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveAnswers = async () => {
    const list = Object.entries(answers)
      .filter(([, trade]) => trade)
      .map(([taskName, trade]) => ({ taskName, trade }));
    if (!list.length) return;
    setBusy(true);
    try {
      await api.post("/ai/trade-answers", { projectId, answers: list });
      toast({ title: "Thanks, remembered", description: "Those tasks will be matched automatically from now on." });
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      setBusy(false);
      return;
    }
    setBusy(false);
    await generate();
  };

  const chosen = rec?.suggestions.filter((s) => rows[s.key]?.on && rows[s.key].people.length > 0) ?? [];
  const send = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const res = await matrixApi.sendBatch({
        create: chosen.map((s) => ({
          projectId: s.projectId,
          subCompanyId: s.subCompanyId,
          employeeIds: rows[s.key].people.map((p) => p.id),
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          description: s.taskName,
        })),
        cancel: [],
        notify: { gcEmail: false, gcPush: true, personnelEmail: false, personnelPush: false },
      });
      toast({
        title: `Sent ${res.created.length} request${res.created.length === 1 ? "" : "s"}`,
        description: res.skipped.length ? `${res.skipped.length} skipped: ${res.skipped.map((x) => x.reason).join(" ")}` : "Subcontractors will confirm them in the app.",
      });
      setRec(null);
      onChanged();
    } catch (err) {
      toast({ title: "Couldn't send", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const changeCount = (key: string, delta: number) =>
    setRows((r) => {
      const row = r[key];
      if (delta > 0 && row.spare.length) return { ...r, [key]: { ...row, people: [...row.people, row.spare[0]], spare: row.spare.slice(1) } };
      if (delta < 0 && row.people.length) {
        const last = row.people[row.people.length - 1];
        return { ...r, [key]: { ...row, people: row.people.slice(0, -1), spare: [last, ...row.spare] } };
      }
      return r;
    });
  const removePerson = (key: string, id: string) =>
    setRows((r) => {
      const row = r[key];
      const p = row.people.find((x) => x.id === id);
      return { ...r, [key]: { ...row, people: row.people.filter((x) => x.id !== id), spare: p ? [p, ...row.spare] : row.spare } };
    });

  const byDate = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of rec?.suggestions ?? []) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [rec]);

  // ---------- Upload Schedule ----------
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // Multipart: the shared JSON client doesn't fit, so call fetch with the same session token.
      const res = await fetch("/api/ai/schedule-upload", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` }, body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      setUploaded(body.tasks);
      setUploadNotes(body.notes ?? "");
    } catch (err) {
      toast({ title: "Couldn't read that schedule", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const addUploaded = async () => {
    if (!uploaded?.length || !projectId) return;
    setBusy(true);
    try {
      for (const t of uploaded) await createTask(projectId, { name: t.name, start_date: t.startDate, end_date: t.endDate, color: t.color });
      toast({ title: `Added ${uploaded.length} tasks to ${projectName}` });
      setUploadOpen(false);
      setUploaded(null);
      onChanged();
    } catch (err) {
      toast({ title: "Couldn't add the tasks", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!projects.length) return null;

  return (
    <TooltipProvider>
      <Card className="border-primary/20">
        <CardHeader className="px-3 py-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" /> AI Schedule Recommender
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <select
            aria-label="Project to schedule"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1" role="group" aria-label="How far ahead">
            {[1, 2, 3].map((w) => (
              <Button key={w} size="sm" variant={weeks === w ? "default" : "outline"} className="h-7 flex-1 text-xs" onClick={() => setWeeks(w)}>
                {w} week{w > 1 ? "s" : ""}
              </Button>
            ))}
          </div>
          <Button size="sm" className="w-full" disabled={busy || !projectId} onClick={() => void generate()}>
            {busy && !uploadOpen ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate Schedule
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Upload Schedule
          </Button>
          {claudeReady === false && (
            <p className="text-[10px] text-muted-foreground">AI helper not set up on this server: matching uses the lookup list and asks you about the rest.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------- review the recommendation ---------- */}
      <Dialog open={!!rec} onOpenChange={(o) => !o && setRec(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Suggested requests for {projectName}</DialogTitle>
            <DialogDescription>
              {rec && `${day(rec.window.start)} – ${day(rec.window.end)}. `}Adjust headcounts and untick anything you don&apos;t want, then send.
              {rec?.claude.used && " AI helped match some tasks."}
            </DialogDescription>
          </DialogHeader>

          {rec?.questions.length ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30">
              <p className="text-sm font-medium">Can you please identify what contractor or trade is associated with these tasks?</p>
              {rec.questions.map((q) => (
                <div key={q.taskName} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{q.taskName}</span> <span className="text-xs text-muted-foreground">({q.why})</span>
                  </span>
                  <select
                    aria-label={`Trade for ${q.taskName}`}
                    value={answers[q.taskName] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.taskName]: e.target.value }))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">Not a trade task / skip</option>
                    {q.options.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <Button size="sm" variant="secondary" disabled={busy || !Object.values(answers).some(Boolean)} onClick={() => void saveAnswers()}>
                Save answers and update suggestions
              </Button>
            </div>
          ) : null}

          {rec?.notes.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {rec.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}

          {rec && !rec.suggestions.length && <p className="py-4 text-center text-sm text-muted-foreground">No requests to suggest for this window.</p>}

          <div className="space-y-3">
            {byDate.map(([date, list]) => (
              <div key={date} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{day(date)}</p>
                {list.map((s) => {
                  const row = rows[s.key];
                  if (!row) return null;
                  return (
                    <div key={s.key} className={`rounded-md border p-2 ${row.on ? "" : "opacity-50"}`} data-suggestion={s.taskName}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Checkbox
                          checked={row.on}
                          aria-label={`Include ${s.taskName} on ${day(s.date)}`}
                          onCheckedChange={(v) => setRows((r) => ({ ...r, [s.key]: { ...r[s.key], on: !!v } }))}
                        />
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: TRADE_COLORS[s.trade] ?? "#64748b" }} />
                        <span className="text-sm font-medium">{s.taskName}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="cursor-help text-[10px]">
                              {s.trade} · {s.subName}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <p>{s.tradeReason}</p>
                            <p className="mt-1">{s.crewReason}</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-xs text-muted-foreground">
                          {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-6 w-6" aria-label="One fewer person" disabled={!row.people.length} onClick={() => changeCount(s.key, -1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-6 text-center text-sm font-semibold" aria-label="Headcount">
                            {row.people.length}
                          </span>
                          <Button size="icon" variant="outline" className="h-6 w-6" aria-label="One more person" disabled={!row.spare.length} onClick={() => changeCount(s.key, 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                        {row.people.map((p) => (
                          <span key={p.id} className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                            {p.name}
                            {!p.assigned && <span className="text-[9px] text-red-600">not assigned</span>}
                            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => removePerson(s.key, p.id)} className="text-muted-foreground hover:text-foreground">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {!row.people.length && <span className="text-xs text-muted-foreground">Nobody (won&apos;t be sent)</span>}
                      </div>
                      <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                        {s.tradeReason} {s.crewReason}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRec(null)}>
              Cancel
            </Button>
            <Button disabled={busy || !chosen.length} onClick={() => void send()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send {chosen.length} request{chosen.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Upload Schedule ---------- */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          setUploadOpen(o);
          if (!o) setUploaded(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Schedule</DialogTitle>
            <DialogDescription>
              Upload a photo, screenshot or PDF of {projectName}&apos;s schedule. The tasks it reads get their trade and colour automatically; check
              them before adding.
            </DialogDescription>
          </DialogHeader>
          {claudeReady === false ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Reading schedules needs the AI helper, which isn&apos;t set up on this server yet. Add tasks by hand from the Tasks panel for now.
            </p>
          ) : !uploaded ? (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-8 text-sm text-muted-foreground hover:bg-muted/40">
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
              {busy ? "Reading the schedule…" : "Choose an image or PDF"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
            </label>
          ) : (
            <div className="space-y-2">
              {uploadNotes && <p className="text-xs text-muted-foreground">Note: {uploadNotes}</p>}
              {uploaded.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <Input
                    value={t.name}
                    aria-label="Task name"
                    onChange={(e) => setUploaded((u) => u!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className="h-8 min-w-0 flex-1 text-sm"
                  />
                  <Input type="date" aria-label="Start" value={t.startDate} onChange={(e) => setUploaded((u) => u!.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))} className="h-8 w-36 text-xs" />
                  <Input type="date" aria-label="End" value={t.endDate} onChange={(e) => setUploaded((u) => u!.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))} className="h-8 w-36 text-xs" />
                  <select
                    aria-label="Trade"
                    value={t.trade ?? ""}
                    onChange={(e) =>
                      setUploaded((u) => u!.map((x, j) => (j === i ? { ...x, trade: e.target.value || null, sure: true, color: TRADE_COLORS[e.target.value] ?? "#64748b" } : x)))
                    }
                    className={`h-8 rounded-md border bg-background px-2 text-xs ${t.trade && t.sure ? "border-input" : "border-amber-400"}`}
                  >
                    <option value="">No trade</option>
                    {Object.keys(TRADE_COLORS).map((tr) => (
                      <option key={tr} value={tr}>
                        {tr}
                      </option>
                    ))}
                  </select>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove task" onClick={() => setUploaded((u) => u!.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {uploaded && (
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setUploaded(null)}>
                Choose another file
              </Button>
              <Button disabled={busy || !uploaded.length} onClick={() => void addUploaded()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add {uploaded.length} tasks
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
