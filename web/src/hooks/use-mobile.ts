import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Ported from SSAA/src/hooks/use-mobile.ts.
 *
 * Starts as `false` so the first render matches the server/initial markup —
 * the original had a lazy initialiser that returned `true` on narrow viewports,
 * which made desktop-sized layouts flash on first paint.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}