import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Upload, GripVertical, Plus, MoreVertical, Circle, Clock, CheckCircle2, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  isReadOnlyOperator = false
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

  // Initialize trades from connected subs
  useEffect(() => {
    const initialTrades: Record<string, string> = {};
    connectedSubs.forEach(sub => {
      if (sub.trade && !subTrades[sub.id]) {
        initialTrades[sub.id] = sub.trade;
      }
    });
    if (Object.keys(initialTrades).length > 0) {
      setSubTrades(prev => ({ ...prev, ...initialTrades }));
    }
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
    <div className="w-full lg:w-72 space-y-3 flex-shrink-0 flex flex-col lg:h-full order-3 lg:order-none">
      {isGCView && !isMasterSchedule && (
        <>
          {/* AI Schedule Recommender */}
          <Card className="border-primary/20">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('left.aiScheduleRecommender')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full" size="sm" disabled={isReadOnlyOperator}>
                    {t('left.generateSchedule')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t('left.aiScheduleRecommender')}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>{t('left.howFarAhead')}</Label>
                      <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="week1"
                            checked={selectedWeeks.includes(1)}
                            onCheckedChange={(checked) => handleWeekToggle(1, !!checked)}
                          />
                          <label htmlFor="week1" className="text-sm cursor-pointer">
                            {t('left.week')} 1 ({t('left.days')} 1-7)
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="week2"
                            checked={selectedWeeks.includes(2)}
                            onCheckedChange={(checked) => handleWeekToggle(2, !!checked)}
                          />
                          <label htmlFor="week2" className="text-sm cursor-pointer">
                            {t('left.week')} 2 ({t('left.days')} 8-14)
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="week3"
                            checked={selectedWeeks.includes(3)}
                            onCheckedChange={(checked) => handleWeekToggle(3, !!checked)}
                          />
                          <label htmlFor="week3" className="text-sm cursor-pointer">
                            {t('left.week')} 3 ({t('left.days')} 15-21)
                          </label>
                        </div>
                      </div>
                      {selectedWeeks.length === 0 && (
                        <p className="text-xs text-destructive">{t('left.selectAtLeastOneWeek')}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>{t('left.selectSubcontractors')}</Label>
                      <ScrollArea className="h-48 border rounded-md p-3">
                        <div className="space-y-3">
                          {connectedSubs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('left.noConnectedSubs')}</p>
                          ) : (
                            connectedSubs.map(sub => (
                              <div key={sub.id} className="space-y-2 pb-2 border-b last:border-b-0">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id={`sub-${sub.id}`}
                                    checked={selectedSubs[sub.id] || false}
                                    onCheckedChange={(checked) => handleSubToggle(sub.id, !!checked)}
                                  />
                                  <label htmlFor={`sub-${sub.id}`} className="text-sm font-medium cursor-pointer">
                                    {sub.name}
                                  </label>
                                </div>
                                {selectedSubs[sub.id] && (
                                  <Select
                                    value={subTrades[sub.id] || sub.trade || ''}
                                    onValueChange={(value) => handleTradeChange(sub.id, value)}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue placeholder={t('left.selectTrade')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TRADES.map(trade => (
                                        <SelectItem key={trade} value={trade}>{trade}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={handleGenerateSchedule}
                      disabled={!Object.values(selectedSubs).some(Boolean) || selectedWeeks.length === 0}
                    >
                      {t('left.generateRecommendations')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Draft Recommendations */}
          {draftRecommendations.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <Sparkles className="h-4 w-4" />
                  {t('left.aiRecommendations')} ({draftRecommendations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <ScrollArea className="h-48">
                  <div className="space-y-2 pr-2">
                    {draftRecommendations.map(rec => (
                      <div 
                        key={rec.id} 
                        className="p-2 bg-background rounded border text-xs space-y-1 cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => {
                          setSelectedDraft(rec);
                          setEditSubId(rec.subId);
                          setEditDate(rec.date);
                          setEditStartTime(rec.startTime || '08:00');
                          setEditEndTime(rec.endTime || '17:00');
                          setEditDraftDialogOpen(true);
                        }}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{rec.subName}</div>
                            <div className="text-muted-foreground">{rec.trade}</div>
                          </div>
                          <div className="text-right text-muted-foreground">
                            {rec.date}
                          </div>
                        </div>
                        <div className="text-muted-foreground italic">{rec.taskName}</div>
                        <div className="flex gap-1 pt-1">
                          <Button 
                            size="sm" 
                            className="flex-1 h-6 text-xs"
                            onClick={(e) => { e.stopPropagation(); onApproveDraft?.(rec.id); }}
                          >
                            {t('common.send')}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="flex-1 h-6 text-xs"
                            onClick={(e) => { e.stopPropagation(); onDeleteDraft?.(rec.id); }}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Edit Draft Dialog */}
          <Dialog open={editDraftDialogOpen} onOpenChange={setEditDraftDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('left.editRecommendation')}</DialogTitle>
              </DialogHeader>
              {selectedDraft && (
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>{t('left.task')}</Label>
                    <p className="text-sm text-muted-foreground">{selectedDraft.taskName}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('left.subcontractor')}</Label>
                    <Select value={editSubId} onValueChange={setEditSubId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {connectedSubs.map(sub => (
                          <SelectItem key={sub.id} value={sub.id}>
                            {sub.name} {sub.trade ? `(${sub.trade})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('left.date')}</Label>
                    <input 
                      type="date" 
                      value={editDate} 
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('left.startTime')}</Label>
                      <input
                        type="time" 
                        value={editStartTime} 
                        onChange={(e) => setEditStartTime(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('left.endTime')}</Label>
                      <input
                        type="time" 
                        value={editEndTime} 
                        onChange={(e) => setEditEndTime(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button 
                      className="flex-1"
                      onClick={() => {
                        onUpdateDraft?.(selectedDraft.id, {
                          subId: editSubId,
                          date: editDate,
                          startTime: editStartTime,
                          endTime: editEndTime
                        });
                        setEditDraftDialogOpen(false);
                      }}
                    >
                      {t('left.saveChanges')}
                    </Button>
                    <Button 
                      variant="default"
                      className="flex-1"
                      onClick={() => {
                        onUpdateDraft?.(selectedDraft.id, {
                          subId: editSubId,
                          date: editDate,
                          startTime: editStartTime,
                          endTime: editEndTime
                        });
                        onApproveDraft?.(selectedDraft.id);
                        setEditDraftDialogOpen(false);
                      }}
                    >
                      {t('left.saveSend')}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Upload Schedule */}
          {selectedProject && selectedProject !== 'master' && (
            <Card className="border-primary/20">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  {t('left.uploadSchedule')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <AnchoredFirstClickTip
                  tipKey="upload_schedule"
                  copy="Upload a schedule document (PDF, image, or spreadsheet) and our AI will parse it into draft tasks for your review and approval."
                  as="div"
                >
                  <div
                    onClick={() => !isReadOnlyOperator && onUploadSchedule?.()}
                    className={`border-2 border-dashed border-border rounded-lg p-4 text-center transition-colors ${isReadOnlyOperator ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50 cursor-pointer'}`}
                  >
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                    <p className="text-xs text-muted-foreground">
                      {t('left.uploadScheduleDesc')}
                    </p>
                  </div>
                </AnchoredFirstClickTip>
              </CardContent>
            </Card>
          )}
        </>
      )}

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
          <ScrollArea className="flex-1 min-h-0">
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
                                className="flex items-center gap-1 p-1.5 bg-muted/50 rounded"
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
                    className={`flex items-center gap-1 p-1.5 bg-muted/50 rounded group transition-all ${
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
                  <div key={project.id} className="flex items-center justify-between gap-2 p-1.5 bg-muted/50 rounded">
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