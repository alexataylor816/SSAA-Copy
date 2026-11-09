import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { classifyTaskTrade, TASK_TRADES, tradeColor } from "@/lib/taskTrades";
import { parseScheduleCsv, type ParsedScheduleTask } from "@/lib/scheduleCsv";

export interface ReviewedScheduleTask extends ParsedScheduleTask { trade: string; color: string }
interface UploadScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (tasks: ReviewedScheduleTask[]) => Promise<void>;
}
type ReviewTask = ParsedScheduleTask & { trade: string; status: "classified" | "ambiguous" | "unresolved" };

export default function UploadScheduleModal({ open, onOpenChange, onImport }: UploadScheduleModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  const reset = () => { setTasks([]); setError(""); setFileName(""); };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError(""); setTasks([]); setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file. For Microsoft Project (.mpp), export Task Name, Start, Finish, Duration, and Predecessors to CSV first. Excel files must also be saved as CSV. Direct .mpp and Excel parsing are not supported.");
      return;
    }
    try {
      const parsed = parseScheduleCsv(await file.text());
      setTasks(parsed.map((task) => {
        const result = classifyTaskTrade(task.name);
        return { ...task, trade: result.trade ?? "", status: result.status };
      }));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read this CSV."); }
  };
  const update = (index: number, changes: Partial<ReviewTask>) => setTasks((current) => current.map((row, i) => i === index ? { ...row, ...changes } : row));
  const importTasks = async () => {
    setBusy(true); setError("");
    try {
      await onImport(tasks.map(({ status: _status, ...task }) => ({ ...task, color: tradeColor(task.trade) })));
      reset(); onOpenChange(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the schedule tasks."); }
    finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
    <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Upload schedule tasks</DialogTitle>
        <DialogDescription>Choose a CSV with Task, Start Date, and End Date columns. Microsoft Project and Excel schedules must be exported as CSV first. Duration and Predecessors are retained when present. Unclear trades can be saved as Needs review.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="schedule-csv">Schedule CSV</Label>
          <Input id="schedule-csv" ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} />
          {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {tasks.length > 0 && <>
          <p className="text-sm font-medium">Review {tasks.length} task{tasks.length === 1 ? "" : "s"}. Unclear trades stay marked Needs review until you choose a trade.</p>
          <div className="space-y-3">
            {tasks.map((task, i) => <div key={`${i}-${task.name}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] md:items-end">
              <div className="space-y-1"><Label>Task</Label><Input value={task.name} onChange={(e) => {
                const result = classifyTaskTrade(e.target.value);
                update(i, { name: e.target.value, trade: result.trade ?? "", status: result.status });
              }} /></div>
              <div className="space-y-1"><Label>Start</Label><Input type="date" value={task.start_date} onChange={(e) => update(i, { start_date: e.target.value })} /></div>
              <div className="space-y-1"><Label>End</Label><Input type="date" value={task.end_date} onChange={(e) => update(i, { end_date: e.target.value })} /></div>
              <div className="space-y-1"><Label>Trade</Label><Select value={task.trade || "unassigned"} onValueChange={(value) => update(i, { trade: value === "unassigned" ? "" : value })}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="unassigned">Choose trade</SelectItem>
                  {TASK_TRADES.map((trade) => <SelectItem key={trade} value={trade}>{trade}</SelectItem>)}
                </SelectContent>
              </Select><p className="text-[11px] text-muted-foreground">{task.trade ? 'Trade identified' : 'Needs review'}</p></div>
              {(task.duration || task.predecessors) && <p className="text-xs text-muted-foreground md:col-span-4">Duration: {task.duration || "—"} · Predecessors: {task.predecessors || "—"}. Retained for reference; dependencies do not change staffing dates automatically.</p>}
            </div>)}
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>Choose another CSV</Button>
            <Button onClick={() => void importTasks()} disabled={busy || tasks.some((t) => !t.name.trim() || !t.start_date || !t.end_date || t.end_date < t.start_date)}>{busy ? "Saving…" : "Save tasks"}</Button>
          </div>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
