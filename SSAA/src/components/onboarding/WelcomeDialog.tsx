import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onStart: () => void;
  onSkip: () => void;
}

const WelcomeDialog = ({ open, onStart, onSkip }: Props) => (
  <Dialog open={open} onOpenChange={(v) => { if (!v) onSkip(); }}>
    <DialogContent className="sm:max-w-lg z-[70]">
      <DialogHeader>
        <DialogTitle>Welcome to SSAA (Schedule Someone Anytime Anywhere)</DialogTitle>
        <DialogDescription>
          Let's take a quick tour. We'll walk through your Monthly and Weekly schedule, projects and
          the Master Schedule, your project team, Manage My Company Account, and Messages.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
        <Button onClick={onStart}>Start Tour</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default WelcomeDialog;
