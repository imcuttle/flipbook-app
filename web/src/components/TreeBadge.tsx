import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/TreeBadge.module.css';
import type { Tree } from '../state/types';
import { useLang, t } from '../lib/i18n';
import { Icon } from './Icon';
import { useIsMobile } from '../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';

type Props = {
  tree: Tree | null;
  currentHash: string | null;
  onJump: (hash: string) => void;
};

const CLOSE_DELAY_MS = 320;

type TreeRow = { hash: string; depth: number; title: string; isLast: boolean[]; isCurrent: boolean; onPath: boolean };

// Flatten tree.nodes into a render-ready row list (DFS preorder), with each
// row carrying a per-depth "is this the last sibling at this level" array
// to draw the └ / ├ guide lines on the left. Also marks which rows lie on
// the current node's ancestor path so we can highlight them.
function flattenTree(tree: Tree | null, currentHash: string | null): TreeRow[] {
  if (!tree?.nodes || !tree.root) return [];
  const onPath = new Set<string>();
  if (currentHash && tree.nodes[currentHash]) {
    let h: string | null = currentHash;
    while (h) {
      onPath.add(h);
      h = tree.nodes[h]?.parent ?? null;
    }
  }
  const rows: TreeRow[] = [];
  const walk = (hash: string, depth: number, parentSiblingsLast: boolean[], isLastSibling: boolean) => {
    const n = tree.nodes![hash];
    if (!n) return;
    const isLast = [...parentSiblingsLast, isLastSibling];
    rows.push({
      hash,
      depth,
      title: n.title,
      isLast,
      isCurrent: hash === currentHash,
      onPath: onPath.has(hash),
    });
    const kids = n.children ?? [];
    kids.forEach((c, i) => walk(c, depth + 1, isLast, i === kids.length - 1));
  };
  walk(tree.root, 0, [], true);
  return rows;
}

export function TreeBadge({ tree, currentHash, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const [lang] = useLang();
  const isMobile = useIsMobile();

  const rows = useMemo(() => flattenTree(tree, currentHash), [tree, currentHash]);

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

  if (!rows.length) return null;

  const list = (
    <div className={styles.list}>
      {rows.map((r) => (
        <button
          key={r.hash}
          type="button"
          className={[
            styles.row,
            r.isCurrent ? styles.current : '',
            r.onPath ? styles.onPath : '',
          ].filter(Boolean).join(' ')}
          onClick={() => { onJump(r.hash); setOpen(false); }}
          title={r.title}
        >
          <span className={styles.guide} aria-hidden>
            {/* Render one column per depth level. Inner columns get a
                vertical line if THAT ancestor still has siblings below;
                the last column gets the ├ / └ joint. */}
            {r.isLast.slice(1).map((last, i, arr) => {
              const isJoint = i === arr.length - 1;
              if (isJoint) return last ? '└─ ' : '├─ ';
              return last ? '   ' : '│  ';
            })}
          </span>
          <span className={styles.title}>{r.title || '(untitled)'}</span>
        </button>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <span className={styles.wrap}>
        <button
          type="button"
          className={styles.badge}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          title={`${t('tree.tip', lang)} (${rows.length})`}
        >
          <Icon name="catalog" size={12} />
          <span>{rows.length}</span>
        </button>
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title={`${t('tree.heading', lang)} (${rows.length})`}
        >
          {list}
        </BottomSheet>
      </span>
    );
  }

  return (
    <span
      className={styles.wrap}
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
        title={`${t('tree.tip', lang)} (${rows.length})`}
      >
        <Icon name="catalog" size={12} />
        <span>{rows.length}</span>
      </button>
      <div
        className={styles.popover}
        hidden={!open}
        role="dialog"
        aria-label={t('tree.heading', lang)}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className={styles.heading}>
          {t('tree.heading', lang)} ({rows.length})
        </div>
        {list}
      </div>
    </span>
  );
}
