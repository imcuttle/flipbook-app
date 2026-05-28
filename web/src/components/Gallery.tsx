import { useEffect, useState } from 'react';
import styles from '../styles/Gallery.module.css';
import type { GalleryEntry } from '../state/types';
import { listCanvases } from '../lib/api';

type Props = {
  onOpen: (canvasId: string) => void;
  refreshKey?: number;
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const dt = (Date.now() - t) / 1000;
  if (dt < 60) return 'just now / 刚刚';
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

export function Gallery({ onOpen, refreshKey }: Props) {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCanvases()
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className={styles.gallery}>
        <div className={styles.empty}>Loading… 加载中…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.gallery}>
        <div className={styles.empty}>Gallery error: {error}</div>
      </div>
    );
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.header}>
        <h2 className={styles.title}>Gallery · 市场</h2>
        <span className={styles.count}>{entries.length} flipbook{entries.length === 1 ? '' : 's'}</span>
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <p>No flipbooks yet. Type a topic above to start your first one.</p>
          <p>暂无 flipbook,在顶部输入主题即可开始。</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {entries.map((e) => (
            <button
              key={e.canvasId}
              type="button"
              className={styles.card}
              onClick={() => onOpen(e.canvasId)}
              title={e.topic}
            >
              {e.coverImage ? (
                <img className={styles.cover} src={e.coverImage} alt={e.topic} draggable={false} />
              ) : (
                <div className={styles.coverPlaceholder}>generating… 生成中…</div>
              )}
              <div className={styles.body}>
                <div className={styles.cardTitle}>{e.topic}</div>
                <div className={styles.cardMeta}>
                  <span>{e.nodeCount} node{e.nodeCount === 1 ? '' : 's'}</span>
                  <span>{formatRelativeTime(e.last_run_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
