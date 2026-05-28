import styles from '../styles/LongPressIndicator.module.css';
import { pct } from '../lib/geometry';

type Props = {
  xy: [number, number];
  // Total duration of the long-press in ms. Indicator's progress ring fills
  // from 0 to circumference over this period.
  durationMs: number;
};

// 2 * Math.PI * 10 ≈ 62.83 — keep in sync with .progress stroke-dasharray.
const CIRCUMFERENCE = 62.83;
const RADIUS = 10;

export function LongPressIndicator({ xy, durationMs }: Props) {
  return (
    <div
      className={styles.indicator}
      style={{ left: pct(xy[0]), top: pct(xy[1]) }}
      aria-hidden
    >
      <svg className={styles.ring} viewBox="0 0 24 24">
        <circle className={styles.bgTrack} cx="12" cy="12" r={RADIUS} />
        <circle
          className={styles.progress}
          cx="12"
          cy="12"
          r={RADIUS}
          // Rotate so progress starts at 12 o'clock and fills clockwise.
          transform="rotate(-90 12 12)"
          style={{
            animation: `pressFill ${durationMs}ms linear forwards`,
          }}
        />
        <circle className={styles.dot} cx="12" cy="12" r="1.4" />
      </svg>
      <style>{`
        @keyframes pressFill {
          from { stroke-dashoffset: ${CIRCUMFERENCE}; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
