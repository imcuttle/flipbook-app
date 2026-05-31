import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../styles/Gallery.module.css';
import type { GalleryEntry } from '../state/types';
import { listCanvasesPage, deleteCanvases } from '../lib/api';
import { useLang, t, format, displayTopic } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import { ConfirmModal } from './ConfirmModal';
import { ProgressiveImage } from './ProgressiveImage';

type Props = {
  onOpen: (canvasId: string) => void;
  refreshKey?: number;
};

const PAGE_SIZE = 24;

function formatRelativeTime(iso: string | null, lang: Lang): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const dt = (Date.now() - ts) / 1000;
  if (dt < 60) return t('time.justNow', lang);
  if (dt < 3600) return format(t('time.minutesAgo', lang), { n: Math.floor(dt / 60) });
  if (dt < 86400) return format(t('time.hoursAgo', lang), { n: Math.floor(dt / 3600) });
  return format(t('time.daysAgo', lang), { n: Math.floor(dt / 86400) });
}

export function Gallery({ onOpen, refreshKey }: Props) {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang] = useLang();

  // Edit mode: when on, cards become multi-selectable (checkbox overlay)
  // and a delete bar appears. Selection is a Set of canvasIds.
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sentinel ref — IntersectionObserver triggers loadMore when this scrolls
  // into view. Re-bound on every render via the callback ref pattern so it
  // works after the entries list grows and React re-mounts the sentinel.
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset + initial fetch whenever refreshKey changes (i.e. user navigated
  // back to gallery, or just deleted/created a canvas). React 18 StrictMode
  // mounts effects twice in dev — without an AbortController the second
  // mount fires a duplicate /api/canvas request. Pass `signal` so the
  // teardown actually cancels the first in-flight fetch (the "cancelled"
  // flag alone only suppresses the state update, not the network call).
  useEffect(() => {
    const ctrl = new AbortController();
    setEntries([]);
    setTotal(0);
    setHasMore(true);
    setError(null);
    setLoading(true);
    // Leaving/refreshing the gallery exits edit mode and clears selection.
    setEditMode(false);
    setSelected(new Set());
    listCanvasesPage(PAGE_SIZE, 0, null, ctrl.signal)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setEntries(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        // AbortError is normal on teardown — silently ignore.
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => { ctrl.abort(); };
  }, [refreshKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      // Cursor-based: pass the last item we already have as lastCanvasId.
      // Server keysets after that cursor's (createdAt, canvasId) so a
      // canvas inserted at the top mid-paging doesn't shift our window.
      // offset is still passed as a fallback for when the cursor row is
      // missing (e.g. deleted between pages).
      const last = entries[entries.length - 1];
      const lastId = last?.canvasId ?? null;
      const page = await listCanvasesPage(PAGE_SIZE, entries.length, lastId);
      // Guard against duplicate IDs in case of race / overlapping fetches.
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.canvasId));
        const merged = [...prev];
        for (const item of page.items) {
          if (!seen.has(item.canvasId)) merged.push(item);
        }
        return merged;
      });
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [entries, hasMore, loading, loadingMore]);

  // Bind IO to the sentinel. We use a callback ref so the observer is
  // attached/re-attached as the sentinel mounts (initial load) and remains
  // attached across page bumps (the same DOM node persists).
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver((entriesObs) => {
      for (const entry of entriesObs) {
        if (entry.isIntersecting) loadMore();
      }
    }, { rootMargin: '200px' });
    observerRef.current.observe(node);
  }, [loadMore]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(entries.map((e) => e.canvasId)));
  }, [entries]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelected(new Set());
  }, []);

  const doDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) { setConfirmOpen(false); return; }
    setDeleting(true);
    try {
      const { deleted } = await deleteCanvases(ids);
      const gone = new Set(deleted);
      setEntries((prev) => prev.filter((e) => !gone.has(e.canvasId)));
      setTotal((prev) => Math.max(0, prev - deleted.length));
      setSelected(new Set());
      setConfirmOpen(false);
      setEditMode(false);
    } catch (e) {
      setError((e as Error).message);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }, [selected]);

  if (loading) {
    return (
      <div className={styles.gallery}>
        <div className={styles.empty}>{t('gallery.loading', lang)}</div>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className={styles.gallery}>
        <div className={styles.empty}>{t('gallery.error', lang)}: {error}</div>
      </div>
    );
  }

  const countKey = total === 1 ? 'gallery.count.one' : 'gallery.count.many';
  const selectedCount = selected.size;

  return (
    <div className={styles.gallery}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>{t('gallery.title', lang)}</h2>
          <span className={styles.count}>{format(t(countKey, lang), { n: total })}</span>
        </div>
        {entries.length > 0 && (
          <div className={styles.headerActions}>
            {editMode ? (
              <>
                <button type="button" className={styles.editBtn} onClick={selectAll}>
                  {t('gallery.edit.selectAll', lang)}
                </button>
                <button type="button" className={styles.editBtn} onClick={clearSelection}>
                  {t('gallery.edit.clear', lang)}
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  disabled={selectedCount === 0 || deleting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {format(t('gallery.edit.delete', lang), { n: selectedCount })}
                </button>
                <button type="button" className={styles.editBtn} onClick={exitEditMode}>
                  {t('gallery.edit.done', lang)}
                </button>
              </>
            ) : (
              <button type="button" className={styles.editBtn} onClick={() => setEditMode(true)}>
                {t('gallery.edit', lang)}
              </button>
            )}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <p>{t('gallery.empty.line1', lang)}</p>
          <p>{t('gallery.empty.line2', lang)}</p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {entries.map((e) => {
              const nodeKey = e.nodeCount === 1 ? 'gallery.nodes.one' : 'gallery.nodes.many';
              const shownTopic = displayTopic(e.topic, lang);
              const isSelected = selected.has(e.canvasId);
              return (
                <button
                  key={e.canvasId}
                  type="button"
                  className={`${styles.card} ${editMode && isSelected ? styles.cardSelected : ''}`}
                  onClick={() => (editMode ? toggleSelect(e.canvasId) : onOpen(e.canvasId))}
                  title={shownTopic}
                >
                  {editMode && (
                    <span className={`${styles.checkbox} ${isSelected ? styles.checkboxOn : ''}`} aria-hidden>
                      {isSelected ? '✓' : ''}
                    </span>
                  )}
                  {e.coverImage ? (
                    <ProgressiveImage
                      className={styles.cover}
                      src={e.coverImage}
                      alt={shownTopic}
                      target="thumb"
                      objectFit="cover"
                      draggable={false}
                    />
                  ) : (
                    <div className={styles.coverPlaceholder}>{t('gallery.cover.generating', lang)}</div>
                  )}
                  <div className={styles.body}>
                    <div className={styles.cardTitle}>{shownTopic}</div>
                    <div className={styles.cardMeta}>
                      <span>{format(t(nodeKey, lang), { n: e.nodeCount })}</span>
                      <span>{formatRelativeTime(e.last_run_at, lang)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Infinite-scroll sentinel — IO fires loadMore when this scrolls
              into view (with a 200px lead). When hasMore is false we stop
              rendering the sentinel so the observer disconnects cleanly. */}
          {hasMore && (
            <div ref={sentinelRef} className={styles.sentinel}>
              {loadingMore ? t('gallery.loading', lang) : ''}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={confirmOpen}
        title={t('gallery.edit.confirm.title', lang)}
        body={format(t('gallery.edit.confirm.body', lang), { n: selectedCount })}
        confirmLabel={t('gallery.edit.confirm.ok', lang)}
        cancelLabel={t('gallery.edit.confirm.cancel', lang)}
        destructive
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
