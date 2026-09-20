import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface IntroItem { label: string; copy: string; }

interface Props {
  open: boolean;
  items: IntroItem[];
  onClose: () => void;
}

const ManageCompanyIntroDialog = ({ open, items, onClose }: Props) => {
  if (!items.length) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg z-[70]">
        <DialogHeader>
          <DialogTitle>Welcome to Manage My Company Account</DialogTitle>
          <DialogDescription>
            Here's a quick overview of what you'll find inside based on your access.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 py-2">
          {items.map((it) => (
            <li key={it.label}>
              <div className="text-sm font-semibold">{it.label}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{it.copy}</div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManageCompanyIntroDialog;
