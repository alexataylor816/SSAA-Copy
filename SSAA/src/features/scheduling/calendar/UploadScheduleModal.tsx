import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent as AlertContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { Upload, FileImage, Loader2, AlertTriangle, Check, Pencil, Trash2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ParsedTask {
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  trade?: string;
  color_from_image?: string;
}

const TRADE_COLOR_MAP: Record<string, string> = {
  drywall: '#9333ea',
  electrical: '#ca8a04',
  plumbing: '#0284c7',
  hvac: '#0891b2',
  flooring: '#ea580c',
  sprinkler: '#dc2626',
  security: '#64748b',
  masonry: '#e11d48',
  'structural steel': '#d946ef',
  painting: '#f59e0b',
  concrete: '#78716c',
  roofing: '#65a30d',
  glazing: '#06b6d4',
  millwork: '#a16207',
  insulation: '#ec4899',
  earthwork: '#854d0e',
  general: '#16a34a',
};

const getTaskColor = (task: ParsedTask): string => {
  if (task.color_from_image) return task.color_from_image;
  if (task.trade) {
    const mapped = TRADE_COLOR_MAP[task.trade.toLowerCase()];
    if (mapped) return mapped;
  }
  return '#0284c7';
};

interface ExistingTask {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

interface UploadScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  existingTasks: ExistingTask[];
  onTasksCreated: () => void;
  isGCView?: boolean;
}

const UploadScheduleModal = ({
  isOpen,
  onClose,
  projectId,
  existingTasks,
  onTasksCreated,
  isGCView = false,
}: UploadScheduleModalProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  const [step, setStep] = useState<'upload' | 'review' | 'confirm-update'>('upload');
  const [tasksToCreate, setTasksToCreate] = useState<ParsedTask[]>([]);
  const [tasksToUpdate, setTasksToUpdate] = useState<{ parsed: ParsedTask; existing: ExistingTask }[]>([]);
  const [tasksToDelete, setTasksToDelete] = useState<ExistingTask[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  const [editColor, setEditColor] = useState('#0284c7');
  const startEditing = (index: number) => {
    const task = parsedTasks[index];
    setEditingIndex(index);
    setEditName(task.name);
    setEditStartDate(task.start_date);
    setEditEndDate(task.end_date);
    setEditColor(getTaskColor(task));
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    setParsedTasks((prev) => prev.map((t, i) =>
      i === editingIndex ? { ...t, name: editName, start_date: editStartDate, end_date: editEndDate, color_from_image: editColor } : t
    ));
    setEditingIndex(null);
  };

  const cancelEdit = () => setEditingIndex(null);

  const deleteEditingTask = () => {
    if (editingIndex === null) return;
    setParsedTasks((prev) => prev.filter((_, i) => i !== editingIndex));
    setEditingIndex(null);
  };

  const resetState = () => {
    setFile(null);
    setPreviewUrl(null);
    setParsing(false);
    setParsedTasks([]);
    setStep('upload');
    setTasksToCreate([]);
    setTasksToUpdate([]);
    setTasksToDelete([]);
    setSaving(false);
    setEditingIndex(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    if (selectedFile.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(selectedFile));
    } else {
      setPreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const mimeType = file.type || 'image/png';

      const { data, error } = await supabase.functions.invoke('parse-schedule', {
        body: { imageBase64: base64, mimeType },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to parse schedule');

      const tasks: ParsedTask[] = data.data.tasks || [];
      setParsedTasks(tasks);
      setStep('review');
    } catch (err: any) {
      toast({
        title: 'Error parsing schedule',
        description: err.message || 'Could not parse the uploaded schedule',
        variant: 'destructive',
      });
    } finally {
      setParsing(false);
    }
  };

  const findMatchingTask = (parsed: ParsedTask): ExistingTask | undefined => {
    return existingTasks.find(
      (t) => t.name.toLowerCase().trim() === parsed.name.toLowerCase().trim()
    );
  };

  const handleImport = () => {
    // All parsed tasks are imported (no selection checkboxes)
    const toCreate: ParsedTask[] = [];
    const toUpdate: { parsed: ParsedTask; existing: ExistingTask }[] = [];

    const parsedNames = new Set(
      parsedTasks.map((t) => t.name.toLowerCase().trim())
    );

    for (const task of parsedTasks) {
      const match = findMatchingTask(task);
      if (match) {
        if (match.start_date !== task.start_date || match.end_date !== task.end_date) {
          toUpdate.push({ parsed: task, existing: match });
        }
      } else {
        toCreate.push(task);
      }
    }

    // Tasks in existing that are NOT in the new schedule → delete
    const toDelete = existingTasks.filter(
      (t) => !parsedNames.has(t.name.toLowerCase().trim())
    );

    setTasksToCreate(toCreate);
    setTasksToUpdate(toUpdate);
    setTasksToDelete(toDelete);

    // Always show confirmation if there are any changes or existing tasks
    if (toUpdate.length > 0 || toDelete.length > 0 || existingTasks.length > 0) {
      setStep('confirm-update');
    } else {
      performImport(toCreate, [], [], true);
    }
  };

  const performImport = async (
    create: ParsedTask[],
    update: { parsed: ParsedTask; existing: ExistingTask }[],
    remove: ExistingTask[],
    sharedWithSubs: boolean = false
  ) => {
    setSaving(true);
    // Colors are now determined by trade via getTaskColor()

    try {
      // Delete removed tasks
      if (remove.length > 0) {
        const deleteIds = remove.map((t) => t.id);
        const { error } = await supabase.from('tasks').delete().in('id', deleteIds);
        if (error) throw error;
      }

      // Create new tasks
      if (create.length > 0) {
        const inserts = create.map((t) => ({
          name: t.name,
          start_date: t.start_date,
          end_date: t.end_date,
          project_id: projectId,
          color: getTaskColor(t),
          status: t.status || 'not_started',
          shared_with_subs: sharedWithSubs,
        }));
        const { error } = await supabase.from('tasks').insert(inserts);
        if (error) throw error;
      }

      // Update existing tasks
      for (const item of update) {
        const { error } = await supabase
          .from('tasks')
          .update({
            start_date: item.parsed.start_date,
            end_date: item.parsed.end_date,
          })
          .eq('id', item.existing.id);
        if (error) throw error;
      }

      toast({
        title: 'Schedule imported',
        description: `${create.length} created, ${update.length} updated, ${remove.length} removed`,
      });

      onTasksCreated();
      handleClose();
    } catch (err: any) {
      toast({
        title: 'Error importing tasks',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {step === 'upload' && 'Upload Schedule'}
            {step === 'review' && 'Review Parsed Tasks'}
            {step === 'confirm-update' && 'Confirm Schedule Changes'}
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            >
              {file ? (
                <div className="space-y-2">
                  <FileImage className="h-10 w-10 mx-auto text-primary" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Schedule preview"
                      className="max-h-48 mx-auto rounded border"
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop a schedule image or PDF, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supports PNG, JPG, PDF
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
            </div>

            <Button
              onClick={handleParse}
              disabled={!file || parsing}
              className="w-full"
            >
              {parsing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing Schedule...
                </>
              ) : (
                'Parse Schedule'
              )}
            </Button>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4 flex-1 min-h-0 flex flex-col">
            <p className="text-sm text-muted-foreground">
              {parsedTasks.length} tasks found. Edit any tasks before importing.
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto max-h-[400px]">
              <div className="space-y-2 pr-1">
                {parsedTasks.map((task, i) => {
                  const existing = findMatchingTask(task);
                  const isEditing = editingIndex === i;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Task name"
                              className="h-8 text-sm"
                            />
                            <div className="flex gap-2">
                              <Input
                                type="date"
                                value={editStartDate}
                                onChange={(e) => setEditStartDate(e.target.value)}
                                className="h-8 text-xs flex-1"
                              />
                              <Input
                                type="date"
                                value={editEndDate}
                                onChange={(e) => setEditEndDate(e.target.value)}
                                className="h-8 text-xs flex-1"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs">Color:</Label>
                              <input
                                type="color"
                                value={editColor}
                                onChange={(e) => setEditColor(e.target.value)}
                                className="h-7 w-10 rounded border cursor-pointer"
                              />
                            </div>
                            <div className="flex gap-1">
                              <Button size="sm" variant="default" onClick={saveEdit} className="h-7 text-xs">
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-xs">
                                Cancel
                              </Button>
                              <Button size="sm" variant="destructive" onClick={deleteEditingTask} className="h-7 text-xs">
                                Delete
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{task.name}</span>
                              <span
                                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: getTaskColor(task) }}
                              />
                              {existing && (
                                <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded">
                                  Exists
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {task.start_date} → {task.end_date}
                            </p>
                            {existing && (
                              <p className="text-xs text-muted-foreground">
                                Current: {existing.start_date} → {existing.end_date}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      {!isEditing && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0"
                          onClick={() => startEditing(i)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('upload')} className="flex-1">
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={parsedTasks.length === 0}
                className="flex-1"
              >
                Import {parsedTasks.length} Tasks
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm-update' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-4">
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                The uploaded schedule will replace your current schedule. Are you sure you want to proceed with the following changes?
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="space-y-3 pr-4">
                {/* Tasks to Update */}
                {tasksToUpdate.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {tasksToUpdate.length} task(s) to update
                    </p>
                    {tasksToUpdate.map((item, i) => (
                      <div key={`update-${i}`} className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-1">
                        <p className="text-sm font-medium">{item.parsed.name}</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Current: </span>
                            <span>{item.existing.start_date} → {item.existing.end_date}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">New: </span>
                            <span className="text-primary font-medium">
                              {item.parsed.start_date} → {item.parsed.end_date}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks to Add */}
                {tasksToCreate.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      {tasksToCreate.length} task(s) to add
                    </p>
                    {tasksToCreate.map((task, i) => (
                      <div key={`new-${i}`} className="p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
                        <div className="flex items-center gap-2">
                          <Check className="h-3 w-3 text-green-600" />
                          <span className="text-sm font-medium">{task.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {task.start_date} → {task.end_date}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks to Remove */}
                {tasksToDelete.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" />
                      {tasksToDelete.length} task(s) to remove
                    </p>
                    {tasksToDelete.map((task, i) => (
                      <div key={`del-${i}`} className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
                        <div className="flex items-center gap-2">
                          <Trash2 className="h-3 w-3 text-red-600" />
                          <span className="text-sm font-medium">{task.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {task.start_date} → {task.end_date}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* No changes case */}
                {tasksToUpdate.length === 0 && tasksToCreate.length === 0 && tasksToDelete.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No changes detected. All tasks match the current schedule.
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-2 flex-shrink-0">
              <Button variant="outline" onClick={() => setStep('review')} className="flex-1">
                Back
              </Button>
              <Button
                onClick={() => {
                  performImport(tasksToCreate, tasksToUpdate, tasksToDelete, true);
                }}
                disabled={saving}
                className="flex-1"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Confirm & Import
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UploadScheduleModal;
