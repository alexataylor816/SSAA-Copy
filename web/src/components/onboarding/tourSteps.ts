/**
 * Stub for the Lovable guided-tour copy. Empty strings mean the pass-through
 * AnchoredFirstClickTip renders nothing, which is what we want until the tour
 * itself is ported. Keys are kept so the dashboard components stay copy-accurate.
 */
export type TourRole = 'gc' | 'guest' | 'sub' | 'mainsub';

export const TOUR_COPY: Record<string, { copy: string }> = {
  project_dropdown: { copy: '' },
  connect_gc_sub: { copy: '' },
  tour_team: { copy: '' },
};