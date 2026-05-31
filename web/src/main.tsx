import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Disable mobile pinch-zoom of the PAGE. The canvas provides its own
// enlarge/zoom view for images, and accidental page zoom (especially the
// pinch gesture overlapping a long-press) is disorienting on a full-bleed
// app. The viewport meta (maximum-scale=1, user-scalable=no) handles most
// browsers; iOS Safari ignores those, so we also block its non-standard
// `gesture*` events and any 2-finger touchmove. Single-finger scroll and
// taps are left untouched.
if (typeof window !== 'undefined') {
  for (const evt of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(evt, (e) => {
      // Allow native zoom gestures inside an opted-in zoom surface (the image
      // lightbox), block everywhere else.
      if ((e.target as HTMLElement | null)?.closest?.('[data-allow-zoom="1"]')) return;
      e.preventDefault();
    }, { passive: false });
  }
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length <= 1) return;
      // Permit multi-touch (pinch) inside opted-in zoom surfaces.
      if ((e.target as HTMLElement | null)?.closest?.('[data-allow-zoom="1"]')) return;
      e.preventDefault();
    },
    { passive: false },
  );
}

// We deliberately do NOT wrap in <React.StrictMode>. StrictMode mounts every
// component twice in dev to flush out side-effect bugs, but the symptom
// (every effect firing twice on first paint, e.g. a duplicate
// /api/canvas?limit=24&offset=0) is a constant source of confusion when
// debugging real network behaviour. Production rendering is always single-
// mount; running dev the same way matches what users see.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);
