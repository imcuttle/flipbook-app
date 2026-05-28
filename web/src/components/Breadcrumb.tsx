import styles from '../styles/Breadcrumb.module.css';
import type { Node } from '../state/types';

type Props = {
  node: Node | null;
  onJump: (hash: string) => void;
};

export function Breadcrumb({ node, onJump }: Props) {
  if (!node || !node.path?.length) return null;
  const path = node.path;
  return (
    <nav className={styles.breadcrumb} aria-label="Path">
      {path.map((p, i) => {
        const isLast = i === path.length - 1;
        return (
          <span key={p.hash} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && <span className={styles.sep}>›</span>}
            <button
              type="button"
              className={`${styles.chip} ${isLast ? styles.current : ''}`}
              onClick={() => !isLast && onJump(p.hash)}
              disabled={isLast}
              title={p.title}
            >
              {p.title}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
