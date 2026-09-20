import { useCallback, useRef, useState } from 'react';
import { useTooltipFlags, TooltipKey } from './TooltipFlagsProvider';

/**
 * Wire returned ref to the anchor element AND call trigger() from that element's
 * onClick handler (before/after your normal handler). Renders <FirstClickTooltip />
 * separately using the anchor ref.
 */
export function useFirstClickTooltip(key: TooltipKey) {
  const { loaded, hasSeen, markSeen } = useTooltipFlags();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [show, setShow] = useState(false);

  const trigger = useCallback(() => {
    if (!loaded) return;
    if (hasSeen(key)) return;
    setShow(true);
  }, [loaded, hasSeen, key]);

  const dismiss = useCallback(() => {
    setShow(false);
    void markSeen(key);
  }, [markSeen, key]);

  const setAnchor = (el: HTMLElement | null) => { anchorRef.current = el; };

  return { show, dismiss, trigger, anchor: anchorRef.current, setAnchor };
}
