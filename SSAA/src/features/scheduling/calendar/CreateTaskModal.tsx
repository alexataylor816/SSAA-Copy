import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { CalendarIcon, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface TaskEntry {
  name: string;
  startDate: Date | undefined;
  endDate: Date | undefined;
}

const emptyTask = (): TaskEntry => ({ name: '', startDate: undefined, endDate: undefined });

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTask: (name: string, startDate: Date, endDate: Date, sharedWithSubs?: boolean) => void;
  selectedProject: string;
  isGCView?: boolean;
}

const CreateTaskModal = ({ isOpen, onClose, onCreateTask, selectedProject, isGCView = false }: CreateTaskModalProps) => {
  const { t } = useLanguage();
  const [multipleMode, setMultipleMode] = useState(false);
  const [tasks, setTasks] = useState<TaskEntry[]>([emptyTask()]);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<TaskEntry[]>([]);

  const resetState = () => {
    setMultipleMode(false);
    setTasks([emptyTask()]);
    setShowShareDialog(false);
    setPendingTasks([]);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const updateTask = (index: number, field: keyof TaskEntry, value: string | Date | undefined) => {
    setTasks(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  };

  const removeTask = (index: number) => {
    setTasks(prev => prev.filter((_, i) => i !== index));
  };

  const addTask = () => {
    setTasks(prev => [...prev, emptyTask()]);
  };

  const handleToggleMultiple = (checked: boolean) => {
    setMultipleMode(checked);
    if (checked && tasks.length === 1) {
      setTasks([tasks[0], emptyTask()]);
    } else if (!checked) {
      setTasks([tasks[0]]);
    }
  };

  const allValid = tasks.every(t => t.name.trim() && t.startDate && t.endDate);

  const handleSubmit = () => {
    if (!allValid) return;
    tasks.forEach(t => {
      onCreateTask(t.name, t.startDate!, t.endDate!, true);
    });
    resetState();
    onClose();
  };

  const handleShareDecision = (share: boolean) => {
    pendingTasks.forEach(t => {
      onCreateTask(t.name, t.startDate!, t.endDate!, share);
    });
    resetState();
    onClose();
  };

  const isProjectSelected = selectedProject !== 'master';

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t('task.createNewTask')}</DialogTitle>
        </DialogHeader>
        
        {!isProjectSelected ? (
          <div className="py-6 text-center">
            <p className="text-muted-foreground">
              {t('task.selectProjectFirst')}
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="space-y-4 pt-2 pb-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="multipleToggle" className="cursor-pointer">{t('task.createMultipleTasks')}</Label>
                <Switch
                  id="multipleToggle"
                  checked={multipleMode}
                  onCheckedChange={handleToggleMultiple}
                />
              </div>

              {tasks.map((task, index) => (
                <TaskEntryForm
                  key={index}
                  index={index}
                  task={task}
                  showLabel={multipleMode}
                  showRemove={multipleMode && tasks.length > 2}
                  onUpdate={updateTask}
                  onRemove={removeTask}
                />
              ))}

              {multipleMode && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={addTask}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('task.addAnotherTask')}
                </Button>
              )}

              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={handleClose}>
                  {t('common.cancel')}
                </Button>
                <Button 
                  className="flex-1" 
                  onClick={handleSubmit}
                  disabled={!allValid}
                >
                  {multipleMode ? t('task.createTasks', { count: String(tasks.length) }) : t('task.createTask')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ── Individual Task Entry ── */

interface TaskEntryFormProps {
  index: number;
  task: TaskEntry;
  showLabel: boolean;
  showRemove: boolean;
  onUpdate: (index: number, field: keyof TaskEntry, value: string | Date | undefined) => void;
  onRemove: (index: number) => void;
}

const TaskEntryForm = ({ index, task, showLabel, showRemove, onUpdate, onRemove }: TaskEntryFormProps) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-3">
      {showLabel && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm font-semibold text-muted-foreground">{t('task.task')} {index + 1}</span>
          {showRemove && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemove(index)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label>{t('task.nameOfTask')}</Label>
        <Input
          placeholder={t('task.enterTaskName')}
          value={task.name}
          onChange={(e) => onUpdate(index, 'name', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('task.startDate')}</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !task.startDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {task.startDate ? format(task.startDate, "PPP") : <span>{t('task.pickStartDate')}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={task.startDate}
              onSelect={(d) => onUpdate(index, 'startDate', d)}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        <Label>{t('task.endDate')}</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !task.endDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {task.endDate ? format(task.endDate, "PPP") : <span>{t('task.pickEndDate')}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={task.endDate}
              onSelect={(d) => onUpdate(index, 'endDate', d)}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {showLabel && <div className="border-b border-border" />}
    </div>
  );
};

export default CreateTaskModal;
