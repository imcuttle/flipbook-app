import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/TopBar.module.css';
import { displayTopic, t } from '../lib/i18n';
import { BottomSheet } from './BottomSheet';
import { useIsMobile } from '../hooks/useIsMobile';

type Crumb = { hash: string; title: string };

type Props = {
  path: Crumb[];
  lang: 'zh' | 'en';
  onJump: (hash: string) => void;
};

// Breadcrumb with collapsing for deep paths. When the chain is short it
// renders inline. When it's deep we keep the ROOT and the last two crumbs
// (parent + current leaf) visible — the leaf is the most important and is
// shown as fully as the row allows — and fold the middle ancestors behind a
// "…" button. Tapping "…" opens a popover (desktop) / bottom sheet (mobile)
// listing every collapsed node so the user can jump straight to one.
const MAX_INLINE = 4; // show all crumbs at or below this length

export function BreadcrumbNav({ path, lang, onJump }: Props) {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop popover is portaled to <body> (the breadcrumb row is
  // overflow:hidden, which would otherwise clip an in-flow popover). We
  // anchor it to the "…" button's bounding rect.
  const ellipsisRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuOpen || isMobile) { setPopoverPos(null); return; }
    const update = () => {
      const r = ellipsisRef.current?.getBoundingClientRect();
      if (r) setPopoverPos({ left: r.left, top: r.bottom + 6 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen, isMobile]);

  // Close the desktop popover on outside-click / Escape.
  useEffect(() => {
    if (!menuOpen || isMobile) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (ellipsisRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, isMobile]);

  if (!path.length) return null;

  const renderCrumb = (p: Crumb, isLast: boolean, withSep: boolean) => {
    const shown = displayTopic(p.title, lang);
    return (
      <span key={p.hash} className={styles.crumbWrap}>
        {withSep && <span className={styles.crumbSep}>›</span>}
        <button
          type="button"
          className={`${styles.crumb} ${isLast ? styles.crumbCurrent : ''} ${isLast ? styles.crumbLeaf : ''}`}
          onClick={() => !isLast && onJump(p.hash)}
          disabled={isLast}
          title={shown}
        >
          {shown}
        </button>
      </span>
    );
  };

  // Short path: render everything inline (existing behaviour).
  if (path.length <= MAX_INLINE) {
    return (
      <div className={styles.breadcrumb} aria-label="Path">
        {path.map((p, i) => renderCrumb(p, i === path.length - 1, i > 0))}
      </div>
    );
  }

  // Deep path: root + … + parent + leaf.
  const root = path[0];
  const tail = path.slice(-2); // parent + leaf
  const collapsed = path.slice(1, -2); // hidden middle ancestors

  return (
    <div className={styles.breadcrumb} aria-label="Path">
      {renderCrumb(root, false, false)}
      <span className={styles.crumbWrap}>
        <span className={styles.crumbSep}>›</span>
        <button
          type="button"
          ref={ellipsisRef}
          className={styles.crumbEllipsis}
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t('breadcrumb.more', lang)}
          aria-label={t('breadcrumb.more', lang)}
        >
          …
        </button>
      </span>
      {tail.map((p, i) => renderCrumb(p, i === tail.length - 1, true))}
      {/* Desktop popover — portaled to <body> so the breadcrumb row's
          overflow:hidden doesn't clip it. Positioned under the "…" button. */}
      {menuOpen && !isMobile && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className={styles.crumbMenu}
          role="menu"
          style={{ position: 'fixed', left: popoverPos.left, top: popoverPos.top }}
        >
          {collapsed.map((p) => (
            <button
              key={p.hash}
              type="button"
              className={styles.crumbMenuItem}
              role="menuitem"
              onClick={() => { onJump(p.hash); setMenuOpen(false); }}
              title={displayTopic(p.title, lang)}
            >
              {displayTopic(p.title, lang)}
            </button>
          ))}
        </div>,
        document.body,
      )}
      {isMobile && (
        <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t('breadcrumb.more', lang)}>
          <div className={styles.crumbSheetList} role="menu">
            {collapsed.map((p) => (
              <button
                key={p.hash}
                type="button"
                className={styles.crumbMenuItem}
                role="menuitem"
                onClick={() => { onJump(p.hash); setMenuOpen(false); }}
              >
                {displayTopic(p.title, lang)}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
