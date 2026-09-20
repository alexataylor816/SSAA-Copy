import { useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface TourStep {
  selector: string;      // data-tour="..." value
  copy: string;
  title?: string;
  /** Optional key marked as seen when this step is displayed. */
  key?: string;
}

interface Props {
  steps: TourStep[];
  onFinish: () => void;
  /** Called with a step's key the first time that step is displayed. */
  onStepSeen?: (key: string) => void;
}

const PAD = 8;

const SpotlightTour = ({ steps, onFinish, onStepSeen }: Props) => {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const step = steps[idx];

  useEffect(() => {
    if (step?.key) onStepSeen?.(step.key);
  }, [step?.key]);

  const measure = () => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.selector}"]`) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    setRect(el.getBoundingClientRect());
  };

  useLayoutEffect(() => { measure(); }, [idx, step?.selector]);

  useEffect(() => {
    const onWin = () => measure();
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    const iv = window.setInterval(measure, 500); // catch late-mounting anchors
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
      window.clearInterval(iv);
    };
  }, [idx, step?.selector]);

  if (!step) return null;

  const next = () => {
    if (idx < steps.length - 1) setIdx(idx + 1);
    else onFinish();
  };
  const back = () => idx > 0 && setIdx(idx - 1);

  // Compute hole with padding
  const hole = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Tooltip position: prefer below the hole, else above
  const CARD_W = 340;
  const CARD_H = 180;
  let cardTop = 20;
  let cardLeft = 20;
  if (hole) {
    const spaceBelow = vh - (hole.top + hole.height);
    if (spaceBelow > CARD_H + 20) {
      cardTop = hole.top + hole.height + 12;
    } else {
      cardTop = Math.max(20, hole.top - CARD_H - 12);
    }
    cardLeft = Math.min(Math.max(20, hole.left + hole.width / 2 - CARD_W / 2), vw - CARD_W - 20);
  }

  return (
    <div className="fixed inset-0 z-[50] pointer-events-none">
      {hole ? (
        <>
          {/* 4 dim panels around the hole */}
          <div className="absolute bg-black/60 pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="absolute bg-black/60 pointer-events-auto" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className="absolute bg-black/60 pointer-events-auto" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="absolute bg-black/60 pointer-events-auto" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {/* Highlight ring around target */}
          <div
            className="absolute rounded-md ring-2 ring-primary pointer-events-none"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/60 pointer-events-auto" />
      )}

      {/* Tooltip card */}
      <div
        className="absolute bg-background text-foreground shadow-xl rounded-lg border border-border p-4 pointer-events-auto"
        style={{ top: cardTop, left: cardLeft, width: CARD_W, zIndex: 52 }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Step {idx + 1} of {steps.length}
          </div>
          <button
            aria-label="Close tour"
            onClick={() => setConfirmExit(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {step.title && <div className="font-semibold mb-1">{step.title}</div>}
        <p className="text-sm text-foreground/90 leading-relaxed">{step.copy}</p>
        <div className="flex justify-between items-center mt-4">
          <Button variant="ghost" size="sm" onClick={back} disabled={idx === 0}>
            <ArrowLeft className="h-3 w-3 mr-1" /> Back
          </Button>
          <Button size="sm" onClick={next}>
            {idx === steps.length - 1 ? 'Done' : (<>Next <ArrowRight className="h-3 w-3 ml-1" /></>)}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent className="z-[80]">
          <AlertDialogHeader>
            <AlertDialogTitle>Exit the guided tour?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't be able to restart this tour. Anything you haven't seen yet will still be
              explained the first time you click it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Touring</AlertDialogCancel>
            <AlertDialogAction onClick={onFinish}>Exit Tour</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
};

export default SpotlightTour;
