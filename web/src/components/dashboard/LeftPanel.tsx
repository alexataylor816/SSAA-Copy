import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Upload, GripVertical, Plus, MoreVertical, Circle, Clock, CheckCircle2, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useLanguage } from '@/contexts/LanguageContext';
import AnchoredFirstClickTip from '@/components/onboarding/AnchoredFirstClickTip';

const TRADES = [
  'Drywall', 'HVAC', 'Electrical', 'Sprinkler', 'Flooring',
  'Security', 'Masonry', 'Structural Steel', 'Plumbing', 'Air Balancer', 'Other'
];

interface Task {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  status?: string;
  project_id?: string;
}

interface ConnectedSub {
  id: string;
  name: string;
  trade?: string | null;
}

interface DraftRecommendation {
  id: string;
  subId: string;
  subName: string;
  trade: string;
  date: string;
  taskName: string;
  startTime?: string | null;
  endTime?: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface LeftPanelProps {
  viewMode: 'gc' | 'sub' | 'moa';
  tasks: Task[];
  showOverlay: boolean;
  setShowOverlay: (show: boolean) => void;
  onDeleteTask: (id: string) => void;
  onCreateTask: () => void;
  onReorderTasks?: (tasks: Task[]) => void;
  onEditTask?: (task: Task) => void;
  connectedSubs?: ConnectedSub[];
  draftRecommendations?: DraftRecommendation[];
  onGenerateSchedule?: (data: { selectedSubs: { id: string; trade: string }[]; selectedWeeks: number[] }) => void;
  onApproveDraft?: (id: string) => void;
  onDeleteDraft?: (id: string) => void;
  onUpdateDraft?: (id: string, updates: { subId?: string; date?: string; startTime?: string; endTime?: string; description?: string }) => void;
  onUploadSchedule?: () => void;
  selectedProject?: string;
  projects?: ProjectItem[];
  masterOverlayProjectIds?: string[];
  onToggleMasterOverlay?: (projectId: string) => void;
  isReadOnlyOperator?: boolean;
  /** The AI Schedule Recommender card (GC dashboards only). */
  aiPanel?: React.ReactNode;
}

const getStatusIcon = (status?: string) => {
  switch (status) {
    case 'in_progress':
      return <Clock className="h-3 w-3 text-yellow-500" />;
    case 'completed':
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground" />;
  }
};

const LeftPanel = ({ 
  viewMode, 
  tasks, 
  showOverlay, 
  setShowOverlay, 
  onDeleteTask, 
  onCreateTask, 
  onReorderTasks, 
  onEditTask,
  connectedSubs = [],
  draftRecommendations = [],
  onGenerateSchedule,
  onApproveDraft,
  onDeleteDraft,
  onUpdateDraft,
  onUploadSchedule,
  selectedProject,
  projects = [],
  masterOverlayProjectIds = [],
  onToggleMasterOverlay,
  isReadOnlyOperator = false,
  aiPanel,
}: LeftPanelProps) => {
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>([1]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedSubs, setSelectedSubs] = useState<Record<string, boolean>>({});
  const [subTrades, setSubTrades] = useState<Record<string, string>>({});
  const [editDraftDialogOpen, setEditDraftDialogOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<DraftRecommendation | null>(null);
  const [editSubId, setEditSubId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('08:00');
  const [editEndTime, setEditEndTime] = useState('17:00');
  const { t } = useLanguage();

  const isGCView = viewMode === 'gc' || viewMode === 'moa';
  const isMasterSchedule = selectedProject === 'master';

  // Initialize trades from connected subs. Reads the previous trades inside the
  // updater rather than closing over `subTrades`, so connectedSubs stays the
  // only dependency without re-seeding trades the user already changed.
  useEffect(() => {
    setSubTrades(prev => {
      let changed = false;
      const next = { ...prev };
      connectedSubs.forEach(sub => {
        if (sub.trade && !next[sub.id]) {
          next[sub.id] = sub.trade;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [connectedSubs]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newTasks = [...tasks];
      const [removed] = newTasks.splice(draggedIndex, 1);
      newTasks.splice(dragOverIndex, 0, removed);
      onReorderTasks?.(newTasks);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleSubToggle = (subId: string, checked: boolean) => {
    setSelectedSubs(prev => ({ ...prev, [subId]: checked }));
  };

  const handleTradeChange = (subId: string, trade: string) => {
    setSubTrades(prev => ({ ...prev, [subId]: trade }));
  };

  const handleWeekToggle = (week: number, checked: boolean) => {
    if (checked) {
      setSelectedWeeks(prev => [...prev, week].sort());
    } else {
      setSelectedWeeks(prev => prev.filter(w => w !== week));
    }
  };

  const handleGenerateSchedule = () => {
    const selected = connectedSubs
      .filter(sub => selectedSubs[sub.id])
      .map(sub => ({
        id: sub.id,
        trade: subTrades[sub.id] || sub.trade || ''
      }));
    
    onGenerateSchedule?.({
      selectedSubs: selected,
      selectedWeeks
    });
    setAiDialogOpen(false);
  };

  return (
    <div className="w-full min-[1400px]:w-72 space-y-3 flex-shrink-0 flex flex-col min-[1400px]:h-full order-3 min-[1400px]:order-none">
      {/* AI Schedule Recommender + Upload Schedule (GC), where Luke's app has them. */}
      {aiPanel}

      {/* Task List - hidden on master schedule for GC/Guest GC unless overlays are active */}
      {!(isGCView && isMasterSchedule && masterOverlayProjectIds.length === 0) && (
      <Card className={`border-primary/20 flex flex-col min-h-0 ${isMasterSchedule && masterOverlayProjectIds.length > 0 ? 'max-h-[50%]' : 'flex-1'}`}>
        <CardHeader className="py-2 px-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{t('left.tasks')}</CardTitle>
            <AnchoredFirstClickTip
              tipKey="overlays"
              copy={projects.length > 1
                ? "Toggle overlays to layer additional data on your calendar like project task lines, request statuses, and even multiple project schedules so you can see the full picture at a glance."
                : "Toggle overlays to layer additional data on your calendar like project task lines."}
            >
              <div className="flex items-center gap-1">
                <Checkbox
                  id="overlay"
                  checked={showOverlay}
                  onCheckedChange={(checked) => setShowOverlay(!!checked)}
                  className="h-3 w-3"
                />
                <label htmlFor="overlay" className="text-xs text-muted-foreground">
                  {t('common.overlay')}
                </label>
              </div>
            </AnchoredFirstClickTip>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3 flex-1 flex flex-col min-h-0">
          {isGCView && (
            <Button variant="outline" className="w-full flex-shrink-0" size="sm" onClick={onCreateTask} disabled={isReadOnlyOperator}>
              <Plus className="h-3 w-3 mr-1" />
              {t('left.createTask')}
            </Button>
          )}
          {/* Phone: the list scrolls inside the card (about eight rows) instead of making the page endless. */}
          <ScrollArea className="flex-1 min-h-0 max-sm:[&>[data-radix-scroll-area-viewport]]:max-h-80">
            <div className="space-y-1 pr-2">
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {isGCView ? t('left.noTasksGC') : t('left.noTasks')}
                </p>
              ) : (isMasterSchedule && masterOverlayProjectIds.length > 0) || (!isMasterSchedule && !isGCView) ? (
                // Group tasks by project — master schedule overlays OR sub viewing specific project (collapsible)
                (() => {
                  const grouped: Record<string, Task[]> = {};
                  tasks.forEach(task => {
                    const pid = (task as any).project_id || 'unknown';
                    if (!grouped[pid]) grouped[pid] = [];
                    grouped[pid].push(task);
                  });
                  return Object.entries(grouped).map(([pid, projectTasks]) => {
                    const projectName = projects.find(p => p.id === pid)?.name || 'Unknown Project';
                    return (
                      <Collapsible key={pid} defaultOpen>
                        <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-bold text-foreground pt-1 pb-0.5 hover:text-primary transition-colors">
                          <span>{projectName}</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-1">
                            {projectTasks.map((task) => (
                              <div
                                key={task.id}
                                className="flex items-center gap-1 p-1.5 bg-muted/50 max-sm:bg-muted/20 rounded"
                              >
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: task.color }} />
                                {getStatusIcon(task.status)}
                                <div className="flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar]:opacity-0 hover:[&::-webkit-scrollbar]:opacity-100 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
                                  <span className="text-xs whitespace-nowrap">{task.name}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  });
                })()
              ) : (
                tasks.map((task, index) => (
                  <div
                    key={task.id}
                    draggable={isGCView}
                    onDragStart={isGCView ? (e) => handleDragStart(e, index) : undefined}
                    onDragOver={isGCView ? (e) => handleDragOver(e, index) : undefined}
                    onDragEnd={isGCView ? handleDragEnd : undefined}
                    onDragLeave={isGCView ? handleDragLeave : undefined}
                    className={`flex items-center gap-1 p-1.5 bg-muted/50 max-sm:bg-muted/20 rounded group transition-all ${
                      isGCView ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${dragOverIndex === index ? 'border-2 border-primary' : ''} ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    {isGCView && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex-shrink-0 hover:bg-muted rounded p-0.5 transition-colors">
                            <MoreVertical className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => onEditTask?.(task)}>
                            {t('left.editTask')}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => onDeleteTask(task.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            {t('left.deleteTask')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {isGCView && <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: task.color }}
                    />
                    {getStatusIcon(task.status)}
                    <div className="flex-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar]:opacity-0 hover:[&::-webkit-scrollbar]:opacity-100 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full transition-opacity">
                      <span className="text-xs whitespace-nowrap">{task.name}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      )}

      {/* Master Schedule: Project Schedule Overlays */}
      {selectedProject === 'master' && projects.length > 0 && (
        <Card className={`border-primary/20 ${masterOverlayProjectIds.length > 0 ? 'max-h-[50%] flex flex-col min-h-0' : 'flex-shrink-0'}`}>
          <CardHeader className="py-2 px-3 flex-shrink-0">
            <CardTitle className="text-sm">Project Schedule Overlays</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 flex-1 min-h-0">
            <ScrollArea className={masterOverlayProjectIds.length > 0 ? 'h-full' : 'max-h-40'}>
              <div className="space-y-1 pr-2">
                {projects.map(project => (
                  <div key={project.id} className="flex items-center justify-between gap-2 p-1.5 bg-muted/50 max-sm:bg-muted/20 rounded">
                    <span className="text-xs truncate flex-1">{project.name}</span>
                    <Checkbox
                      checked={masterOverlayProjectIds.includes(project.id)}
                      onCheckedChange={() => {
                        onToggleMasterOverlay?.(project.id);
                        // Auto-enable overlay rendering when toggling projects
                        if (!showOverlay) {
                          setShowOverlay(true);
                        }
                      }}
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default LeftPanel;