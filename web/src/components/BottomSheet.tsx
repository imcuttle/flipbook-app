import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/BottomSheet.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

// Past this downward travel (px), releasing dismisses the sheet.
const DISMISS_THRESHOLD = 90;
// Must match the exit-slide transition duration below.
const CLOSE_ANIM_MS = 220;

// Mobile bottom-sheet: a panel that slides up from the bottom edge over a
// dimmed backdrop. Used on small screens in place of the desktop
// hover/dropdown popovers (Sources / Catalog / More / breadcrumb). Portals
// to document.body so it overlays everything and isn't clipped by any
// scrollable/transformed ancestor.
//
// Swipe-down-to-dismiss: dragging the sheet down — from the header
// (grabber/title) or the backdrop OUTSIDE the sheet — past a threshold
// closes it with a slide-out animation; a shorter drag springs back. A drag
// that starts inside SCROLLABLE content is left to scroll natively and never
// dismisses (so the gesture doesn't fight the scroll).
export function BottomSheet({ open, onClose, title, children }: Props) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const startRef = useRef<{ y: number; allowDismiss: boolean } | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Lock background scroll while open, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Reset drag/close state whenever the sheet (re)opens.
  useEffect(() => {
    if (open) { setDragY(0); setDragging(false); setClosing(false); }
  }, [open]);

  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current); }, []);

  // Animate the sheet sliding out, THEN unmount via onClose — so a dismiss
  // gesture visibly collapses the panel instead of blinking away.
  const animateClose = () => {
    if (closing) return;
    setClosing(true);
    setDragging(false);
    closeTimerRef.current = window.setTimeout(onClose, CLOSE_ANIM_MS);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || closing) { startRef.current = null; return; }
    const target = e.target as HTMLElement | null;
    // Dismiss-drag is allowed ONLY from the header (grabber/title) or the
    // backdrop outside the sheet. Anything starting inside the scrollable
    // content is left entirely to native scrolling and never dismisses — this
    // avoids the gesture fighting the scroll on overflowing sheets.
    const inContent = !!target?.closest?.(`.${styles.content}`);
    const allowDismiss = !inContent;
    startRef.current = { y: e.touches[0].clientY, allowDismiss };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start || !start.allowDismiss || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - start.y;
    if (dy <= 0) { if (dragging) { setDragging(false); setDragY(0); } return; }
    if (e.cancelable) e.preventDefault();
    if (!dragging) setDragging(true);
    setDragY(dy);
  };

  const onTouchEnd = () => {
    if (!startRef.current) return;
    const shouldClose = startRef.current.allowDismiss && dragY > DISMISS_THRESHOLD;
    startRef.current = null;
    if (shouldClose) { animateClose(); return; }
    setDragging(false);
    setDragY(0);
  };

  if (!open) return null;

  // Backdrop fades as the sheet is dragged down / closing.
  const progress = closing ? 1 : dragging ? Math.min(1, dragY / (DISMISS_THRESHOLD * 2.5)) : 0;

  // Sheet transform: slide fully out while closing, follow the finger while
  // dragging, otherwise rest at origin (the CSS entry animation handles open).
  const sheetTransform = closing
    ? 'translateY(100%)'
    : dragging ? `translateY(${dragY}px)` : undefined;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="presentation"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ background: `rgba(31, 31, 31, ${(0.4 * (1 - progress)).toFixed(3)})` }}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: sheetTransform,
          // The entry animation uses fill-mode:both, whose final transform
          // would override our inline transform. Disable it once we start
          // dragging / closing so the sheet actually follows the gesture.
          animation: dragging || closing ? 'none' : undefined,
          transition: dragging ? 'none' : `transform ${CLOSE_ANIM_MS}ms cubic-bezier(0.22, 0.8, 0.32, 1)`,
        }}
      >
        <div className={styles.grabber} aria-hidden />
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.content}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
