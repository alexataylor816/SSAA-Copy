import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

interface Task {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  status?: string;
}

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onUpdateTask: (id: string, name: string, startDate: Date, endDate: Date, status: string, color: string, sharedWithSubs?: boolean) => void;
  onDeleteTask?: (id: string) => void;
  isGCView?: boolean;
}

const EditTaskModal = ({ isOpen, onClose, task, onUpdateTask, onDeleteTask, isGCView = false }: EditTaskModalProps) => {
  const { t } = useLanguage();
  const [taskName, setTaskName] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [status, setStatus] = useState('not_started');
  const [color, setColor] = useState('#0284c7');
  const [showShareDialog, setShowShareDialog] = useState(false);

  const COLOR_OPTIONS: { value: string; labelKey: string }[] = [
    { value: '#0284c7', labelKey: 'color.blue' },
    { value: '#16a34a', labelKey: 'color.green' },
    { value: '#dc2626', labelKey: 'color.red' },
    { value: '#9333ea', labelKey: 'color.purple' },
    { value: '#ea580c', labelKey: 'color.orange' },
    { value: '#0891b2', labelKey: 'color.cyan' },
    { value: '#d946ef', labelKey: 'color.fuchsia' },
    { value: '#ca8a04', labelKey: 'color.yellow' },
    { value: '#64748b', labelKey: 'color.slate' },
    { value: '#e11d48', labelKey: 'color.rose' },
  ];

  useEffect(() => {
    if (task) {
      setTaskName(task.name);
      setStartDate(parseLocalDate(task.start_date));
      setEndDate(parseLocalDate(task.end_date));
      setStatus(task.status || 'not_started');
      setColor(task.color || '#0284c7');
    }
  }, [task]);

  const handleSubmit = () => {
    if (!task || !taskName.trim() || !startDate || !endDate) return;
    onUpdateTask(task.id, taskName, startDate, endDate, status, color, true);
    onClose();
  };

  const handleShareDecision = (share: boolean) => {
    if (!task || !startDate || !endDate) return;
    onUpdateTask(task.id, taskName, startDate, endDate, status, color, share);
    setShowShareDialog(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('task.editTask')}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="taskName">{t('task.nameOfTask')}</Label>
            <Input
              id="taskName"
              placeholder={t('task.enterTaskName')}
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
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
                    !startDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, "PPP") : <span>{t('task.pickStartDate')}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
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
                    !endDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, "PPP") : <span>{t('task.pickEndDate')}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>{t('task.status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder={t('task.selectStatus')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">{t('task.notStarted')}</SelectItem>
                <SelectItem value="in_progress">{t('task.inProgress')}</SelectItem>
                <SelectItem value="completed">{t('task.completed')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('task.taskColor')}</Label>
            <Select value={color} onValueChange={setColor}>
              <SelectTrigger>
                <SelectValue placeholder={t('task.selectColor')}>
                  <div className="flex items-center justify-between w-full">
                    <span>{t(COLOR_OPTIONS.find(c => c.value === color)?.labelKey || 'task.selectColor')}</span>
                    <span
                      className="w-4 h-4 rounded-full ml-2 shrink-0"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                {COLOR_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <div className="flex items-center justify-between w-full gap-2">
                      <span>{t(c.labelKey)}</span>
                      <span
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: c.value }}
                      />
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-4">
            {onDeleteTask && (
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (task) {
                    onDeleteTask(task.id);
                    onClose();
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button 
              className="flex-1" 
              onClick={handleSubmit}
              disabled={!taskName.trim() || !startDate || !endDate}
            >
              {t('profile.saveChanges')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditTaskModal;
