import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { MatrixEmployee } from './MatrixEmployeeCard';

interface MatrixQuickAddModalProps {
  open: boolean;
  onClose: () => void;
  employees: MatrixEmployee[];
  projectName: string;
  dateLabel: string;
  onAssign: (employeeIds: string[]) => void;
}

const MatrixQuickAddModal = ({ open, onClose, employees, projectName, dateLabel, onAssign }: MatrixQuickAddModalProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [jobTitleFilter, setJobTitleFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const jobTitles = useMemo(() => {
    const titles = new Set<string>();
    employees.forEach(e => { if (e.job_title) titles.add(e.job_title); });
    return Array.from(titles).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    let result = employees;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e => e.name.toLowerCase().includes(q));
    }
    if (jobTitleFilter && jobTitleFilter !== 'all') {
      result = result.filter(e => e.job_title === jobTitleFilter);
    }
    return result;
  }, [employees, searchQuery, jobTitleFilter]);

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssign = () => {
    if (selectedIds.size === 0) return;
    onAssign(Array.from(selectedIds));
    setSelectedIds(new Set());
    setSearchQuery('');
    setJobTitleFilter('all');
    onClose();
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedIds(new Set());
      setSearchQuery('');
      setJobTitleFilter('all');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add Team — {projectName}</DialogTitle>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
          {jobTitles.length > 0 && (
            <Select value={jobTitleFilter} onValueChange={setJobTitleFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Filter by job title" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Job Titles</SelectItem>
                {jobTitles.map(title => (
                  <SelectItem key={title} value={title}>{title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="max-h-60 overflow-y-auto space-y-1 border border-border rounded-md p-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No available employees</p>
            ) : (
              filtered.map(emp => (
                <label
                  key={emp.id}
                  className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(emp.id)}
                    onCheckedChange={() => toggleId(emp.id)}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium truncate">{emp.name}</span>
                    {emp.job_title && <span className="text-[10px] text-muted-foreground truncate">{emp.job_title}</span>}
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleAssign} disabled={selectedIds.size === 0}>
            Assign Selected ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatrixQuickAddModal;
