import { Loader2, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "You have N unsaved schedule changes" (O8), from Luke's MatrixDraftBar. */
export default function DraftBar({
  count,
  mode,
  publishing,
  onRevert,
  onPublish,
}: {
  count: number;
  mode: "gc" | "sub";
  publishing: boolean;
  onRevert: () => void;
  onPublish: () => void;
}) {
  if (count === 0) return null;
  const label = publishing ? (mode === "gc" ? "Sending..." : "Publishing...") : mode === "gc" ? "Send Requests" : "Publish & Edit Schedule";
  return (
    <div
      role="region"
      aria-label="Unsaved schedule changes"
      className="fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 shadow-2xl md:inset-x-auto md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:flex-row md:items-center md:gap-4 md:rounded-xl md:px-6 md:py-3"
    >
      <span className="text-center text-[11px] font-medium leading-tight md:text-left md:text-sm">
        <span className="md:hidden">
          <span className="font-bold text-primary">{count}</span> unsaved change{count !== 1 ? "s" : ""}
        </span>
        <span className="hidden md:inline">
          You have <span className="font-bold text-primary">{count}</span> unsaved schedule change{count !== 1 ? "s" : ""}
        </span>
      </span>
      <div className="flex w-full items-center gap-2 md:w-auto">
        <Button variant="outline" size="sm" onClick={onRevert} disabled={publishing} className="h-8 flex-1 px-2 text-xs md:h-9 md:flex-none md:px-3 md:text-sm">
          <Undo2 className="mr-1 h-3.5 w-3.5 md:h-4 md:w-4" />
          Revert<span className="hidden md:inline">&nbsp;Changes</span>
        </Button>
        <Button size="sm" onClick={onPublish} disabled={publishing} className="h-8 flex-1 px-2 text-xs md:h-9 md:flex-none md:px-3 md:text-sm">
          {publishing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin md:h-4 md:w-4" /> : <Send className="mr-1 h-3.5 w-3.5 md:h-4 md:w-4" />}
          {label}
        </Button>
      </div>
    </div>
  );
}
