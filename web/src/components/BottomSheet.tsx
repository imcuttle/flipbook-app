import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/BottomSheet.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

// Mobile bottom-sheet: a panel that slides up from the bottom edge over a
// dimmed backdrop. Used on small screens in place of the desktop
// hover/dropdown popovers (Sources / Catalog / More). Portals to
// document.body so it overlays everything and isn't clipped by any
// scrollable/transformed ancestor.
export function BottomSheet({ open, onClose, title, children }: Props) {
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

  if (!open) return null;
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grabber} aria-hidden />
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.content}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
