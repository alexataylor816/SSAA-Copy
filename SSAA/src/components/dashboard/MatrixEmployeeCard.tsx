import { useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export type CardStatus = 'confirmed' | 'available' | 'draft' | 'cancelled' | 'pending';

export interface MatrixEmployee {
  id: string;
  name: string;
  job_title: string | null;
  company_id: string;
  profile_picture_url?: string | null;
}

interface MatrixEmployeeCardProps {
  employee: MatrixEmployee;
  density: 'full' | 'compact' | 'minimal';
  status?: CardStatus;
  dragId?: string;
  draggable?: boolean;
  onAssign?: () => void;
  onCancelClick?: () => void;
  onRemove?: () => void;
  timeLabel?: string;
  stopLabel?: string;
  /** Multi-select: when true, render a primary-colored selection ring. */
  selected?: boolean;
  /** Multi-select: called when the chip is clicked (below drag threshold). */
  onToggleSelect?: () => void;
  /** When true, render a red outline + "Not assigned to project" warning text under the name. */
  unassignedWarning?: boolean;
}

const getInitials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const getCompactName = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  return name;
};

const statusRingClass: Record<CardStatus, string> = {
  confirmed: 'ring-2 ring-green-500/60',
  available: 'ring-2 ring-yellow-500/60',
  draft: 'ring-2 ring-blue-500/60',
  cancelled: 'ring-2 ring-red-500/60 cursor-pointer',
  pending: 'ring-2 ring-yellow-500/70 bg-yellow-50 dark:bg-yellow-950/30',
};

const statusDotColor: Record<CardStatus, string> = {
  confirmed: 'bg-green-500',
  available: 'bg-yellow-500',
  draft: 'bg-blue-500',
  cancelled: 'bg-red-500',
  pending: 'bg-yellow-500',
};

const MatrixEmployeeCard = ({ employee, density, status, dragId, draggable = true, onAssign, onCancelClick, onRemove, timeLabel, stopLabel, selected, onToggleSelect, unassignedWarning }: MatrixEmployeeCardProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId || employee.id,
    data: { employee },
    disabled: !draggable,
  });

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
  } : undefined;

  const initials = useMemo(() => getInitials(employee.name), [employee.name]);
  // When selected, suppress status ring so the strong selection treatment is unmistakable.
  // Unassigned warning takes priority over status ring (but selection still wins).
  const ringClass = selected
    ? ''
    : unassignedWarning
      ? 'ring-2 ring-red-500'
      : (status ? statusRingClass[status] : '');
  const selectionRingClass = selected
    ? 'ring-4 ring-blue-600 ring-offset-2 ring-offset-background bg-blue-50 dark:bg-blue-950/40 scale-[1.03] shadow-lg transition-transform'
    : '';

  // Track pointer-down position so we can distinguish click from drag.
  // dnd-kit's listeners suppress synthetic onClick, so we trigger selection
  // on pointerup ourselves when the pointer barely moved and no drag started.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    // Forward to dnd-kit so drag activation still works.
    if (draggable) listeners?.onPointerDown?.(e as unknown as PointerEvent);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (isDragging) return;
    if (!down) return;
    const dx = Math.abs(e.clientX - down.x);
    const dy = Math.abs(e.clientY - down.y);
    if (dx > 5 || dy > 5) return;

    if (status === 'cancelled' && onCancelClick) {
      onCancelClick();
      return;
    }
    if (onToggleSelect) {
      onToggleSelect();
    }
  };

  if (density === 'minimal') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...(draggable ? { ...listeners, ...attributes } : {})}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`relative text-xs px-1.5 py-0.5 rounded bg-card border border-border/50 truncate cursor-grab active:cursor-grabbing ${ringClass} ${selectionRingClass}`}
      >
        {status && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDotColor[status]} mr-1 flex-shrink-0`} />
            </TooltipTrigger>
            <TooltipContent>{status === 'confirmed' ? 'Confirmed' : status === 'available' ? 'Available' : status === 'draft' ? 'Newly Assigned' : 'Cancelled'}</TooltipContent>
          </Tooltip>
        )}
        <span className="truncate">{employee.name}</span>
      </div>
    );
  }

  if (density === 'compact') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...(draggable ? { ...listeners, ...attributes } : {})}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`group relative flex items-center gap-1.5 p-1.5 rounded-md bg-card border border-border/50 shadow-sm cursor-grab active:cursor-grabbing ${ringClass} ${selectionRingClass}`}
      >
      {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/80"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-medium truncate">{getCompactName(employee.name)}</span>
          {status === 'pending' ? (
            <span className="text-[9px] font-medium text-yellow-700 dark:text-yellow-400 truncate">Pending Confirmation</span>
          ) : (
            employee.job_title && <span className="text-[10px] text-muted-foreground truncate">{employee.job_title}</span>
          )}
          {timeLabel && (
            <span className="text-[10px] text-muted-foreground truncate">
              {stopLabel ? `${stopLabel} · ` : ''}{timeLabel}
            </span>
          )}
          {unassignedWarning && (
            <span className="text-[9px] font-medium text-red-600 dark:text-red-400 truncate">
              Not assigned to project
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full density
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className={`group relative flex items-center gap-2 p-2 rounded-lg bg-card border border-border/50 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${ringClass} ${selectionRingClass}`}
    >
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/80"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      {employee.profile_picture_url ? (
        <img src={employee.profile_picture_url} alt={employee.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
          {initials}
        </div>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{employee.name}</span>
        {employee.job_title && <span className="text-xs text-muted-foreground truncate">{employee.job_title}</span>}
        {timeLabel && (
          <span className="text-[11px] text-muted-foreground truncate">
            {stopLabel ? `${stopLabel} · ` : ''}{timeLabel}
          </span>
        )}
        {unassignedWarning && (
          <span className="text-[10px] font-medium text-red-600 dark:text-red-400 truncate">
            Not assigned to project
          </span>
        )}
      </div>
    </div>
  );
};

export default MatrixEmployeeCard;
