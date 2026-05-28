import { useEffect, useRef, useState } from 'react';
import styles from '../styles/SourcesBadge.module.css';
import type { SourceRef } from '../state/types';

type Props = {
  sources: SourceRef[];
};

function hostnameOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const CLOSE_DELAY_MS = 220; // grace period when the cursor leaves the badge / popover

export function SourcesBadge({ sources }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => () => cancelClose(), []);

  if (!sources?.length) return null;

  return (
    <span
      className={styles.wrap}
      // The whole wrap (badge + popover) shares hover state. Entering either
      // cancels any pending close; leaving schedules a close after a grace
      // period so the user can move the cursor across the gap into the popover.
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      onFocus={() => { cancelClose(); setOpen(true); }}
      onBlur={scheduleClose}
    >
      <button
        type="button"
        className={styles.badge}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${sources.length} reference link${sources.length === 1 ? '' : 's'}`}
      >
        📚 {sources.length}
      </button>
      <div
        className={styles.popover}
        hidden={!open}
        role="dialog"
        aria-label="Sources"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className={styles.heading}>
          References · 参考来源 ({sources.length})
        </div>
        <div className={styles.list}>
          {sources.slice(0, 12).map((s, i) => (
            <a
              key={`${i}-${s.url}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.item}
              title={s.title}
            >
              <span className={styles.itemTitle}>{s.title || s.url}</span>
              <span className={styles.itemMeta}>{s.source || hostnameOf(s.url)}</span>
              {s.snippet && <span className={styles.itemSnippet}>{s.snippet}</span>}
            </a>
          ))}
        </div>
      </div>
    </span>
  );
}
