import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/ConfirmModal.module.css';

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Minimal modal — backdrop click cancels, Escape cancels, Enter confirms.
// No portal/library dep; just a fixed-position overlay attached to the
// document body.
export function ConfirmModal({
  open, title, body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Focus the confirm button on open so Enter immediately confirms.
  // preventScroll stops the browser from scrolling the (possibly
  // scrollable) ancestor to bring the button into view — without it,
  // opening the modal visibly jumps the gallery's scroll position.
  useEffect(() => {
    if (open) {
      // Defer one tick so the DOM is mounted.
      const t = setTimeout(() => confirmRef.current?.focus({ preventScroll: true }), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Global key handlers while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  // Portal to document.body so the fixed backdrop is positioned relative
  // to the viewport, not to any scrollable / transformed ancestor (the
  // gallery grid). Rendering inline would also let an ancestor's
  // overflow / transform clip or shift the overlay.
  return createPortal(
    <div className={styles.backdrop} onClick={onCancel} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className={styles.title}>{title}</h3>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnCancel}
            onClick={onCancel}
          >{cancelLabel}</button>
          <button
            ref={confirmRef}
            type="button"
            className={destructive ? styles.btnDanger : styles.btnConfirm}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
