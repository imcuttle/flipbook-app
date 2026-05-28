import { forwardRef } from 'react';
import styles from '../styles/HotspotCard.module.css';
import { pct } from '../lib/geometry';
import type { Hotspot } from '../state/types';

type Props = {
  hotspot: Hotspot;
  index: number;
  anchor: [number, number];
  onClick: (index: number) => void;
};

export const HotspotCard = forwardRef<HTMLButtonElement, Props>(function HotspotCard(
  { hotspot, index, anchor, onClick }: Props,
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
    </button>
  );
});
