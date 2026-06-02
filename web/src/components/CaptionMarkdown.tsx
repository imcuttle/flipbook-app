import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import styles from '../styles/Caption.module.css';
import { useLang, t } from '../lib/i18n';
import { IS_EXPORT } from '../lib/exportProfile';

type Props = {
  /** Raw caption text (may contain inline markdown). */
  text: string;
  /** Class applied to the wrapping element (caller owns caption layout styling). */
  className?: string;
  /**
   * Clamp to N lines with a "查看更多" toggle (default). Set false to render
   * the full text with no toggle — used on a still-generating node page where
   * the caption is streaming in and the expand/collapse interaction would be
   * meaningless (and jumpy).
   */
  clamp?: boolean;
};

// 导出形态下 caption 折叠到 1 行（超一行即出现「查看更多」）；在线 2 行。
const CLAMP_LINES = IS_EXPORT ? 1 : 2;

// Node captions are prose that may contain INLINE markdown (**bold**,
// *italic*, `code`, ~~strike~~, [links](url)). We render with react-markdown
// but allow ONLY inline elements — block constructs (the wrapping paragraph,
// headings, lists, blockquotes) are unwrapped to their text so they can't
// break the caption layout. react-markdown does not render raw HTML by
// default, so this is XSS-safe.
const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

// Inline marks we keep; everything else (incl. the wrapper <p>) is unwrapped.
const ALLOWED = ['a', 'em', 'strong', 'del', 'code', 'br'];

// Caption clamped to 2 lines. When (and only when) the text overflows 2 lines,
// a blue "查看更多" sits at the BOTTOM-RIGHT of the 2nd line (over a fade
// mask); clicking expands to the full text with a trailing "收起".
export function CaptionMarkdown({ text, className, clamp = true }: Props) {
  const [lang] = useLang();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLSpanElement | null>(null);

  // Reset to collapsed on text change (e.g. node navigation).
  useEffect(() => { setExpanded(false); }, [text]);

  // Measure overflow against the 2-line clamp. Skipped when clamp is off.
  useEffect(() => {
    if (!clamp) { setOverflowing(false); return; }
    const measure = () => {
      const el = textRef.current;
      if (!el) return;
      setOverflowing(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, clamp]);

  const md = (
    <ReactMarkdown components={COMPONENTS} allowedElements={ALLOWED} unwrapDisallowed>
      {text}
    </ReactMarkdown>
  );

  // No-clamp mode (e.g. streaming generating node): render full text, no toggle.
  if (!clamp) {
    return (
      <p className={`${styles.caption} ${className ?? ''}`}>
        <span className={styles.full}>{md}</span>
      </p>
    );
  }

  return (
    <p className={`${styles.caption} ${className ?? ''}`}>
      <span
        ref={textRef}
        className={expanded ? styles.full : styles.clamp}
        style={!expanded ? ({ ['--clamp-lines' as string]: String(CLAMP_LINES) }) : undefined}
      >
        {md}
      </span>
      {/* Collapsed + overflowing → "查看更多" pinned bottom-right over a fade. */}
      {!expanded && overflowing && (
        <button
          type="button"
          className={styles.moreBtn}
          onClick={() => setExpanded(true)}
        >
          {t('caption.more', lang)}
        </button>
      )}
      {/* Expanded → trailing inline "收起". */}
      {expanded && (
        <button
          type="button"
          className={styles.lessBtn}
          onClick={() => setExpanded(false)}
        >
          {t('caption.less', lang)}
        </button>
      )}
    </p>
  );
}
