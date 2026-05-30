import { useEffect, useState } from 'react';

// Tracks whether the viewport is at/below a mobile breakpoint. Used to
// switch dropdown/hover affordances (Sources / Catalog / More menus) over
// to a bottom-sheet interaction on small screens. Matches the 720px
// breakpoint the CSS modules use for their mobile rules.
const QUERY = '(max-width: 720px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);

  return isMobile;
}
