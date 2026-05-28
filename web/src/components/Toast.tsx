import styles from '../styles/Toast.module.css';
import type { Toast } from '../state/types';

type Props = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export function ToastStack({ toasts, onDismiss }: Props) {
  if (!toasts.length) return null;
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.level]}`}>
          <span>{t.message}</span>
          <button className={styles.close} onClick={() => onDismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
