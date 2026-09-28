import { useEffect, useLayoutEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  anchor: HTMLElement | null;
  copy: string;
  onDismiss: () => void;
}

const CARD_W = 300;

const FirstClickTooltip = ({ anchor, copy, onDismiss }: Props) => {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = () => {
    if (!anchor) return setRect(null);
    setRect(anchor.getBoundingClientRect());
  };
  useLayoutEffect(() => { measure(); }, [anchor]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [anchor]);

  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const preferBelow = rect.bottom + 140 < vh;
  const top = preferBelow ? rect.bottom + 10 : Math.max(10, rect.top - 140);
  const left = Math.min(Math.max(10, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 10);

  return (
    <div
      role="tooltip"
      className="fixed bg-background text-foreground shadow-xl rounded-lg border border-border p-3 pr-8"
      style={{ top, left, width: CARD_W, zIndex: 60 }}
    >
      <button
        aria-label="Dismiss tooltip"
        onClick={onDismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {/* pointer arrow */}
      <div
        className="absolute w-3 h-3 bg-background border-border rotate-45"
        style={
          preferBelow
            ? { top: -6, left: Math.min(Math.max(12, rect.left + rect.width / 2 - left - 6), CARD_W - 18), borderLeft: '1px solid hsl(var(--border))', borderTop: '1px solid hsl(var(--border))' }
            : { bottom: -6, left: Math.min(Math.max(12, rect.left + rect.width / 2 - left - 6), CARD_W - 18), borderRight: '1px solid hsl(var(--border))', borderBottom: '1px solid hsl(var(--border))' }
        }
      />
      <p className="text-sm leading-relaxed">{copy}</p>
    </div>
  );
};

export default FirstClickTooltip;
