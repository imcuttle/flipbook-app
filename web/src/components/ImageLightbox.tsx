import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/ImageLightbox.module.css';
import { Icon } from './Icon';
import { useLang, t } from '../lib/i18n';

type Props = {
  src: string;
  alt?: string;
  // Suggested filename for the download (without extension is fine; the
  // extension is derived from the src URL).
  downloadName?: string;
  onClose: () => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;

// Full-screen image viewer with download + two-finger pinch-zoom and
// pan. We implement zoom via a CSS transform (rather than relying on
// native page zoom, which is disabled app-wide) so the gesture is
// self-contained and predictable on every browser.
export function ImageLightbox({ src, alt = '', downloadName, onClose }: Props) {
  const [lang] = useLang();
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  // Swipe-to-dismiss: vertical offset + live progress while dragging down
  // (only when not zoomed). Drives a downward translate + backdrop fade.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Gesture bookkeeping refs (don't trigger re-renders mid-gesture).
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // Swipe-down dismiss tracking (single finger, not zoomed).
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  // Past this downward travel (px), releasing dismisses the viewer.
  const DISMISS_THRESHOLD = 110;

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const dist = (t0: React.Touch, t1: React.Touch) =>
    Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: dist(e.touches[0], e.touches[1]), startScale: scale };
      panRef.current = null;
      swipeRef.current = null;
    } else if (e.touches.length === 1 && scale > 1) {
      // Single-finger pan only when zoomed in.
      panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty };
    } else if (e.touches.length === 1) {
      // Single finger at fit-scale: candidate swipe-to-dismiss.
      swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    // Prevent the gesture from bubbling to the page (pull-to-refresh /
    // overscroll-close). touch-action:none on the backdrop handles most
    // browsers; this is the belt-and-suspenders for the rest.
    if (e.cancelable) e.preventDefault();
    if (pinchRef.current && e.touches.length === 2) {
      const d = dist(e.touches[0], e.touches[1]);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchRef.current.startScale * (d / pinchRef.current.startDist)));
      setScale(next);
      if (next === 1) { setTx(0); setTy(0); }
    } else if (panRef.current && e.touches.length === 1) {
      setTx(panRef.current.tx + (e.touches[0].clientX - panRef.current.x));
      setTy(panRef.current.ty + (e.touches[0].clientY - panRef.current.y));
    } else if (swipeRef.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - swipeRef.current.x;
      const dy = e.touches[0].clientY - swipeRef.current.y;
      // Only treat as a dismiss drag once it's clearly vertical + downward,
      // so horizontal flicks don't accidentally start dragging the image.
      if (dy > 0 && dy > Math.abs(dx)) {
        if (!dragging) setDragging(true);
        setDragY(dy);
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) {
      panRef.current = null;
      // Resolve a pending swipe-to-dismiss: past the threshold → close,
      // otherwise spring back to origin.
      if (swipeRef.current) {
        swipeRef.current = null;
        if (dragY > DISMISS_THRESHOLD) { onClose(); return; }
        setDragging(false);
        setDragY(0);
      }
    }
  };

  // Double-tap toggles between fit and 2× (centred).
  const lastTapRef = useRef(0);
  const onImgClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scale > 1) { setScale(1); setTx(0); setTy(0); } else { setScale(2); }
    }
    lastTapRef.current = now;
  };

  const download = async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = (src.split('?')[0].match(/\.(png|jpe?g|webp|svg)$/i)?.[1] ?? 'png').toLowerCase();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(downloadName || 'flipbook').replace(/[^\w.-]+/g, '_').slice(0, 80)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank', 'noopener,noreferrer');
    }
  };

  // Backdrop fades as the image is dragged down (caps at ~0.4 opacity left).
  const dismissProgress = dragging ? Math.min(1, dragY / (DISMISS_THRESHOLD * 2)) : 0;
  const backdropOpacity = 1 - dismissProgress * 0.6;

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      data-allow-zoom="1"
      onClick={onClose}
      style={{ background: `rgba(0, 0, 0, ${(0.9 * backdropOpacity).toFixed(3)})` }}
    >
      <div className={styles.toolbar} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={download}
          aria-label={t('canvas.image.download', lang)}
          title={t('canvas.image.download', lang)}
        >
          <Icon name="download" size={18} />
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={onClose}
          aria-label={t('canvas.image.close', lang)}
          title={t('canvas.image.close', lang)}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div
        className={styles.scroll}
        onClick={onClose}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          className={styles.img}
          src={src}
          alt={alt}
          onClick={onImgClick}
          draggable={false}
          style={{
            // When dragging to dismiss (only at fit-scale) the image follows
            // the finger downward and scales down slightly; on release it
            // springs back via the transition.
            transform: dragging
              ? `translate(0px, ${dragY}px) scale(${(1 - dismissProgress * 0.1).toFixed(3)})`
              : `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: swipeRef.current ? 'none' : 'transform 200ms ease',
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
