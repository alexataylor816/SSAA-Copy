import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Users, Eye } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import AnchoredFirstClickTip from '@/components/onboarding/AnchoredFirstClickTip';
import type { TooltipKey } from '@/components/onboarding/TooltipFlagsProvider';

interface Company {
  id: string;
  name: string;
  trade?: string | null;
}

interface Employee {
  id: string;
  name: string;
  company_id?: string;
}

interface Availability {
  id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
}

export interface SubOverlayData {
  subId: string;
  subName: string;
  trade?: string | null;
  enabled: boolean;
  dayData: { date: string; employeeCount: number }[];
}

interface SubOverlayPanelProps {
  connectedSubs: Company[];
  allEmployees: Employee[];
  availabilities: Availability[];
  currentDate: Date;
  overlayEnabled: boolean;
  onOverlayEnabledChange: (enabled: boolean) => void;
  selectedSubIds: string[];
  onSelectedSubIdsChange: (ids: string[]) => void;
  /** Optional card title override (e.g. "Subcontractor Overlay" for main subs). */
  title?: string;
  /** Optional first-click tooltip key + copy override. */
  tipKey?: TooltipKey;
  tipCopy?: string;
}

const SubOverlayPanel = ({
  connectedSubs,
  allEmployees,
  availabilities,
  currentDate,
  overlayEnabled,
  onOverlayEnabledChange,
  selectedSubIds,
  onSelectedSubIdsChange,
  title,
  tipKey = 'sub_availability_overlay',
  tipCopy = 'Turn on Sub Availability to see, in real time, how many workers each of your connected subcontractors has available on any given day.',
}: SubOverlayPanelProps) => {
  const { t } = useLanguage();


  const subOverlayData = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

    return connectedSubs.map(sub => {
      const subEmployeeIds = allEmployees
        .filter(e => e.company_id === sub.id)
        .map(e => e.id);

      const dayData = days.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const availableEmployees = new Set<string>();
        
        availabilities.forEach(a => {
          if (!subEmployeeIds.includes(a.employee_id)) return;
          const d = new Date(a.start_time);
          const availDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          if (availDate === dateStr) {
            availableEmployees.add(a.employee_id);
          }
        });

        return { date: dateStr, employeeCount: availableEmployees.size };
      });

      return {
        subId: sub.id,
        subName: sub.name,
        trade: sub.trade,
        dayData,
      };
    });
  }, [connectedSubs, allEmployees, availabilities, currentDate]);

  const handleSubToggle = (subId: string, checked: boolean) => {
    if (checked) {
      onSelectedSubIdsChange([...selectedSubIds, subId]);
    } else {
      onSelectedSubIdsChange(selectedSubIds.filter(id => id !== subId));
    }
  };

  if (connectedSubs.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            {title || t('overlay.subAvailability')}
          </CardTitle>
          <AnchoredFirstClickTip
            tipKey={tipKey}
            copy={tipCopy}
          >
            <Switch
              checked={overlayEnabled}
              onCheckedChange={onOverlayEnabledChange}
            />
          </AnchoredFirstClickTip>
        </div>
      </CardHeader>
      {overlayEnabled && (
        <CardContent className="px-3 pb-3">
          <ScrollArea className="max-h-40">
            <div className="space-y-1.5">
              {connectedSubs.map(sub => {
                const data = subOverlayData.find(d => d.subId === sub.id);
                const totalAvail = data?.dayData.reduce((sum, d) => sum + (d.employeeCount > 0 ? 1 : 0), 0) || 0;
                
                return (
                  <div key={sub.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`overlay-sub-${sub.id}`}
                      checked={selectedSubIds.includes(sub.id)}
                      onCheckedChange={(checked) => handleSubToggle(sub.id, !!checked)}
                    />
                    <label
                      htmlFor={`overlay-sub-${sub.id}`}
                      className="text-xs cursor-pointer flex-1 truncate"
                    >
                      {sub.name}
                    </label>
                    {sub.trade && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {sub.trade}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
};

export default SubOverlayPanel;
export type { SubOverlayPanelProps };
