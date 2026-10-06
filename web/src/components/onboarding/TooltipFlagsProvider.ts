/**
 * Onboarding tooltip plumbing is ported as pass-through no-ops for now, so the
 * dashboard components that Lovable wraps in first-click coach-marks can be
 * copied over without editing their JSX. When the guided tour is ported,
 * replace this file with the real provider and these components light up.
 */
export type TooltipKey = string;

export interface TooltipFlagsContextValue {
  hasSeen: (k: TooltipKey) => boolean;
  markSeen: (k: TooltipKey) => Promise<void>;
}

export const noopTooltipFlags: TooltipFlagsContextValue = {
  hasSeen: () => false,
  markSeen: async () => {},
};