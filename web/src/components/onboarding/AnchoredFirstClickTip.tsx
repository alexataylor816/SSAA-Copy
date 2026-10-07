import type { ReactNode } from 'react';
import type { TooltipKey } from './TooltipFlagsProvider';

interface Props {
  tipKey: TooltipKey;
  copy: string;
  children: ReactNode;
  className?: string;
  as?: 'div' | 'span';
}

/**
 * Wraps children in the requested element and shows nothing. This is the real
 * component's shape minus the tooltip, so components copied from the Lovable
 * app keep their exact structure and can adopt the real tour later by swapping
 * this one file.
 */
const AnchoredFirstClickTip = ({ children, className, as = 'span' }: Props) => {
  if (as === 'div') {
    return <div className={className}>{children}</div>;
  }
  return <span className={className}>{children}</span>;
};

export default AnchoredFirstClickTip;