import { useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initialsOf, type Density } from "./helpers";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";
import { jobTitleLabel } from "@/i18n/labels";

/**
 * A person on the Weekly grid or in the side panel. Ported from Luke's MatrixEmployeeCard: three sizes
 * (full / compact / minimal, picked from how full the cell is), a coloured outline per status, a red
 * outline when placed on a project they aren't assigned to, and click (under 5px of movement) to select.
 */

export type CardLook = "confirmed" | "pending" | "draft" | "available" | "unavailable";

const RING: Record<CardLook, string> = {
  confirmed: "ring-2 ring-green-500/60",
  available: "ring-1 ring-yellow-500/50",
  draft: "ring-2 ring-blue-500/60",
  pending: "ring-2 ring-yellow-500/70 bg-yellow-50 dark:bg-yellow-950/30",
  unavailable: "opacity-60",
};
const DOT: Record<CardLook, string> = {
  confirmed: "bg-green-500",
  available: "bg-yellow-500",
  draft: "bg-blue-500",
  pending: "bg-yellow-500",
  unavailable: "bg-muted-foreground",
};
const LABEL: Record<CardLook, string> = {
  get confirmed() { return tr("employeeCard.label.confirmed"); },
  get available() { return tr("employeeCard.label.available"); },
  get draft() { return tr("employeeCard.label.draft"); },
  get pending() { return tr("employeeCard.label.pending"); },
  get unavailable() { return tr("employeeCard.label.unavailable"); },
};

const compactName = (name: string) => {
  const parts = name.split(" ").filter(Boolean);
  return parts.length >= 2 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : name;
};

interface Props {
  name: string;
  jobTitle?: string | null;
  density: Density;
  look: CardLook;
  timeLabel?: string;
  stopLabel?: string | null;
  /** Red outline + "Not assigned to project". Wins over the status outline (selection wins over both). */
  unassigned?: boolean;
  edited?: boolean;
  /** Small tag after the name, e.g. "Sub" for a crew the sub placed itself (GC view). */
  tag?: string;
  dragId?: string;
  dragData?: Record<string, unknown>;
  draggable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onRemove?: () => void;
  /** Phone: tap instead of drag. */
  onTap?: () => void;
}

export default function EmployeeCard({
  name,
  jobTitle,
  density,
  look,
  timeLabel,
  stopLabel,
  unassigned,
  edited,
  tag,
  dragId,
  dragData,
  draggable = false,
  selected,
  onToggleSelect,
  onRemove,
  onTap,
}: Props) {
  const { t } = useLanguage();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId ?? `static::${name}`,
    data: dragData,
    disabled: !draggable || !dragId,
  });
  // The page draws a floating copy (DragOverlay) that follows the pointer; the original stays where it
  // is, faded. Moving the original too would stretch the scrolling grid and make it scroll.
  const style = isDragging ? { opacity: 0.4 } : undefined;

  // dnd-kit swallows click events, so a click is a pointer that barely moved between down and up.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
    if (draggable) listeners?.onPointerDown?.(e as unknown as PointerEvent);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = down.current;
    down.current = null;
    if (isDragging || !start) return;
    if (Math.abs(e.clientX - start.x) > 5 || Math.abs(e.clientY - start.y) > 5) return;
    if (onTap) onTap();
    else onToggleSelect?.();
  };

  const ring = selected
    ? "ring-4 ring-blue-600 ring-offset-2 ring-offset-background bg-blue-50 dark:bg-blue-950/40 shadow-lg"
    : unassigned
      ? "ring-2 ring-red-500"
      : RING[look];
  // Luke's wording for split days: "Stop 1: 5:00 AM – 9:00 AM".
  const time = timeLabel ? `${stopLabel ? `${stopLabel.replace("#", "")}: ` : ""}${timeLabel}` : null;
  // select-none: pressing and moving would otherwise select text, and the browser scrolls the grid to follow it.
  const grab = draggable ? "cursor-grab select-none active:cursor-grabbing touch-none" : onTap ? "cursor-pointer select-none" : "";
  const shared = {
    ref: setNodeRef,
    style,
    ...(draggable ? attributes : {}),
    onPointerDown,
    onPointerUp,
    "data-card": name,
    "data-look": look,
    "data-unassigned": unassigned ? "true" : undefined,
    "aria-label": `${name}${time ? `, ${time}` : ""}, ${LABEL[look]}${unassigned ? ", not assigned to this project" : ""}`,
  };

  const removeButton = onRemove && (
    <button
      type="button"
      aria-label={t("employeeCard.remove", { name: name })}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity hover:bg-destructive/80 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <X className="h-2.5 w-2.5" />
    </button>
  );
  const extras = (
    <>
      {edited && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800">{t("employeeCard.edited")}</span>}
      {tag && <span className="truncate rounded bg-muted/40 px-1 text-[9px] font-medium text-muted-foreground">{tag}</span>}
    </>
  );
  const warning = unassigned && (
    <span className="flex items-center gap-0.5 truncate text-[9px] font-medium text-red-600 dark:text-red-400">
      <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> {" "}{t("employeeCard.notAssignedToProject")}
    </span>
  );

  if (density === "minimal") {
    return (
      <div {...shared} className={`group relative flex max-w-full items-center rounded border border-border/50 bg-card px-1.5 py-0.5 text-xs ${grab} ${ring}`}>
        {removeButton}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${unassigned ? "bg-red-500" : DOT[look]}`} />
          </TooltipTrigger>
          <TooltipContent>{unassigned ? t("employeeCard.notAssignedToThisProject") : LABEL[look]}</TooltipContent>
        </Tooltip>
        <span className="truncate">{name}</span>
      </div>
    );
  }

  if (density === "compact") {
    return (
      <div {...shared} className={`group relative flex items-center gap-1.5 rounded-md border border-border/50 bg-card p-1.5 shadow-sm ${grab} ${ring}`}>
        {removeButton}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1 truncate text-xs font-medium">
            <span className="truncate">{compactName(name)}</span>
            {extras}
          </span>
          {look === "pending" ? (
            <span className="truncate text-[9px] font-medium text-yellow-700 dark:text-yellow-400">{t("employeeCard.pendingConfirmation")}</span>
          ) : (
            jobTitle && <span className="truncate text-[10px] text-muted-foreground">{jobTitleLabel(jobTitle)}</span>
          )}
          {time && <span className="truncate text-[10px] text-muted-foreground">{time}</span>}
          {warning}
        </div>
      </div>
    );
  }

  return (
    <div
      {...shared}
      className={`group relative flex items-center gap-2 rounded-lg border border-border/50 bg-card p-2 shadow-sm transition-shadow hover:shadow-md ${grab} ${ring}`}
    >
      {removeButton}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initialsOf(name)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1 truncate text-sm font-medium">
          <span className="truncate">{name}</span>
          {extras}
        </span>
        {look === "pending" ? (
          <span className="truncate text-[10px] font-medium text-yellow-700 dark:text-yellow-400">{t("employeeCard.pendingConfirmation")}</span>
        ) : (
          jobTitle && <span className="truncate text-xs text-muted-foreground">{jobTitleLabel(jobTitle)}</span>
        )}
        {time && <span className="truncate text-[11px] text-muted-foreground">{time}</span>}
        {warning}
      </div>
    </div>
  );
}
