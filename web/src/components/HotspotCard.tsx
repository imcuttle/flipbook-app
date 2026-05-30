import { forwardRef } from 'react';
import styles from '../styles/HotspotCard.module.css';
import { pct } from '../lib/geometry';
import type { Hotspot } from '../state/types';
import { Icon } from './Icon';

type Props = {
  hotspot: Hotspot;
  index: number;
  anchor: [number, number];
  onClick: (index: number) => void;
  // When provided, a small ✕ appears in the card's top-right on hover.
  // Hidden in preview / read-only mode by simply not passing this prop.
  onDelete?: (index: number) => void;
};

export const HotspotCard = forwardRef<HTMLButtonElement, Props>(function HotspotCard(
  { hotspot, index, anchor, onClick, onDelete }: Props,
  ref,
) {
  const linked = !!hotspot.next_hash;
  const cls = [
    styles.hotspot,
    linked ? styles.linked : styles.pending,
  ].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      style={{ left: pct(anchor[0]), top: pct(anchor[1]) }}
      // Stop the pointerdown BEFORE it reaches the stage so the stage doesn't
      // start its long-press timer (and doesn't setPointerCapture, which would
      // swallow our subsequent click).
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(index);
      }}
    >
      {!linked && <span className={styles.spinner} aria-hidden />}
      <span className={styles.label}>{hotspot.label}</span>
      {/* Delete ✕ button. For LINKED hotspots (real child node generated)
          this is the destructive cascade-delete path. For PENDING ones
          (still generating, next_hash null) it's a "cancel this in-flight
          click" — same affordance, the App-side handler distinguishes
          the two cases. Only hidden in read-only / preview mode. */}
      {onDelete && (
        <span
          className={styles.delete}
          role="button"
          tabIndex={0}
          aria-label={linked ? `Delete ${hotspot.label}` : `Cancel ${hotspot.label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete(index);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onDelete(index);
            }
          }}
          title={linked ? 'Delete this branch / 删除该分支' : 'Cancel this generation / 取消生成'}
        >
          <Icon name="close" size={11} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
});
