import React from 'react';
import FirstClickTooltip from './FirstClickTooltip';
import { useFirstClickTooltip } from './useFirstClickTooltip';
import { TooltipKey } from './TooltipFlagsProvider';

interface Props {
  tipKey: TooltipKey;
  copy: string;
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'span';
}

/**
 * Wraps children in a span/div; on first click of anything inside, fires a
 * one-time floating tooltip anchored to the wrapper. Persists dismissal to DB.
 */
const AnchoredFirstClickTip = ({ tipKey, copy, children, className, as = 'span' }: Props) => {
  const { show, dismiss, trigger, anchor, setAnchor } = useFirstClickTooltip(tipKey);
  const Tag: any = as;
  return (
    <>
      <Tag
        ref={(el: HTMLElement | null) => setAnchor(el)}
        onClickCapture={() => trigger()}
        className={className}
      >
        {children}
      </Tag>
      {show && <FirstClickTooltip anchor={anchor} copy={copy} onDismiss={dismiss} />}
    </>
  );
};

export default AnchoredFirstClickTip;
