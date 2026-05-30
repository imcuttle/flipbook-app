import { useEffect, useRef, useState } from 'react';
import styles from '../styles/SourcesBadge.module.css';
import type { SourceRef } from '../state/types';
import { useLang, t } from '../lib/i18n';
import { Icon } from './Icon';
import { useIsMobile } from '../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';

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
  const [lang] = useLang();
  const isMobile = useIsMobile();

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

  const list = (
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
  );

  // Mobile: tap the badge to open a bottom sheet (no hover). Desktop:
  // hover/click dropdown anchored to the badge.
  if (isMobile) {
    return (
      <span className={styles.wrap}>
        <button
          type="button"
          className={styles.badge}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          title={`${t('sources.heading', lang)} (${sources.length})`}
        >
          <Icon name="sources" size={12} />
          <span>{sources.length}</span>
        </button>
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={`${t('sources.heading', lang)} (${sources.length})`}
        >
          {list}
        </BottomSheet>
      </span>
    );
  }

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
        title={`${t('sources.heading', lang)} (${sources.length})`}
      >
        <Icon name="sources" size={12} />
        <span>{sources.length}</span>
      </button>
      <div
        className={styles.popover}
        hidden={!open}
        role="dialog"
        aria-label={t('sources.heading', lang)}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className={styles.heading}>
          {t('sources.heading', lang)} ({sources.length})
        </div>
        {list}
      </div>
    </span>
  );
}
