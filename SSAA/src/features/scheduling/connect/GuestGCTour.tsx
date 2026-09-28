import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface TourStep {
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to SSAA 👋',
    body: "This quick tour will show you how to schedule your subcontractor. You can dismiss it anytime.",
  },
  {
    title: 'Your Subcontractor Roster',
    body: 'On the right side you can see the workers your subcontractor has available. Drag them onto a date or click a calendar day to start scheduling.',
  },
  {
    title: 'Your Calendar',
    body: 'Click any future day on the calendar to request workers from your sub. You can multi-select to schedule across many days at once.',
  },
  {
    title: 'Notification Choice',
    body: "When you publish a request, you'll be asked whether to notify the sub by Email, SMS, both, or in-app only.",
  },
  {
    title: 'Master Schedule',
    body: 'Use the left panel to switch to Master Schedule to see availability for ALL your projects in one place.',
  },
  {
    title: 'Project & Account',
    body: "Use the project picker on the right to switch projects, or 'Manage My Account' to edit project info, your company details, or invite teammates.",
  },
];

interface Props {
  userId: string;
  enabled: boolean;
}

const GuestGCTour = ({ userId, enabled }: Props) => {
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  const dismissForever = async () => {
    setOpen(false);
    try {
      await supabase.from('profiles').update({ tour_seen: true }).eq('user_id', userId);
    } catch (e) {
      console.error('Failed to mark tour seen:', e);
    }
  };

  if (!open) return null;
  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-in fade-in slide-in-from-bottom-4">
      <Card className="border-primary shadow-2xl">
        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <CardTitle className="text-base">{step.title}</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{step.body}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Step {stepIdx + 1} of {STEPS.length}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={dismissForever}>
                Don't show again
              </Button>
              {isLast ? (
                <Button size="sm" onClick={dismissForever}>
                  Got it
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStepIdx((i) => i + 1)}>
                  Next <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestGCTour;
