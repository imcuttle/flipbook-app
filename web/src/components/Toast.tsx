import { useEffect, useRef, useState } from 'react';
import styles from '../styles/Toast.module.css';
import type { Toast } from '../state/types';

type Props = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

// Default auto-dismiss for non-error toasts. Error toasts stick around
// until the user closes them — failures are usually actionable, so
// silently disappearing them after 5s would lose context.
const AUTO_DISMISS_MS = 5_000;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  // Hover pauses the timer. paused=true clears the timeout; paused=false
  // (re)starts a fresh AUTO_DISMISS_MS countdown so re-entry doesn't
  // trigger an instant dismiss on whatever was left over.
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Errors and explicitly-sticky toasts persist until the user closes them.
    if (toast.level === 'error' || toast.sticky) return;
    if (paused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [toast.id, toast.level, paused, onDismiss]);

  return (
    <div
      className={`${styles.toast} ${styles[toast.level]}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{toast.message}</span>
      <button className={styles.close} onClick={() => onDismiss(toast.id)} aria-label="Dismiss">×</button>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: Props) {
  if (!toasts.length) return null;
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
