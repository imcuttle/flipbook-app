import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/TopBar.module.css';
import type { Node } from '../state/types';
import { useLang, t, displayTopic } from '../lib/i18n';
import { Icon } from './Icon';
import { selectionFromClipboard, selectionFromFileList, type ImageSelection } from '../lib/imageUpload';
import { useIsMobile } from '../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';

type Props = {
  view: 'gallery' | 'canvas';
  topic: string | null;
  currentNode: Node | null;
  draftTopic: string;
  onDraftTopicChange: (v: string) => void;
  onSubmitTopic: () => void;
  onBackToGallery: () => void;
  onJumpBreadcrumb: (hash: string) => void;
  onShare: () => void;
  onToggleFullscreen: () => void;
  onToggleChrome: () => void;
  onToggleLabels: () => void;
  onToggleWebSearch: () => void;
  onToggleComposeOnClick: () => void;
  onRegenerate?: () => void;
  // Attachment for new-canvas creation. Picked / pasted in the address bar.
  attachment: ImageSelection | null;
  onAttachmentChange: (sel: ImageSelection | null) => void;
  fullscreen: boolean;
  showChrome: boolean;
  showLabels: boolean;
  webSearch: boolean;
  composeOnClick: boolean;
  readOnly: boolean;
  busy: boolean;
};

export function TopBar(props: Props) {
  const {
    view, topic, currentNode, draftTopic, onDraftTopicChange, onSubmitTopic,
    onBackToGallery, onJumpBreadcrumb, onShare, onToggleFullscreen, onToggleChrome,
    onToggleLabels, onToggleWebSearch, onToggleComposeOnClick, onRegenerate,
    attachment, onAttachmentChange,
    fullscreen, showChrome, showLabels, webSearch, composeOnClick, readOnly, busy,
  } = props;

  const [lang, setLang] = useLang();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || readOnly) return;
    if (view === 'gallery' && (draftTopic.trim() || attachment)) {
      onSubmitTopic();
    }
  };

  // Paste-to-attach is scoped to the address input only (per the user's
  // explicit constraint). We attach onPaste directly to the <input>, then
  // walk the clipboard for image items.
  const onInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const sel = selectionFromClipboard(e);
    if (sel) {
      e.preventDefault();
      onAttachmentChange(sel);
    }
    // Otherwise let the browser do its default text paste.
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sel = selectionFromFileList(e.target.files);
    if (sel) {
      onAttachmentChange(sel);
      // Defer focus to the next frame: focusing synchronously inside the
      // file-input change handler can stall the picker teardown. rAF lets
      // the input dialog fully close first, then we move the caret to the
      // topic field so the user can type / submit immediately.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // Reset so the same file can be picked again after removal.
    e.target.value = '';
  };

  const path = currentNode?.path ?? [];

  return (
    <div className={`${styles.topbar} ${fullscreen ? styles.compact : ''}`}>
      <div className={styles.dots}><span /><span /><span /></div>

      {!fullscreen && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBackToGallery}
          title={t('topbar.gallery.tip', lang)}
          aria-label={t('topbar.gallery', lang)}
        >
          <span className={styles.iconLabel}><Icon name="menu" size={14} /></span>
          <span className={styles.btnText}>{t('topbar.gallery', lang)}</span>
        </button>
      )}

      {/* Address-bar capsule */}
      <form className={styles.address} onSubmit={onSubmit}>
        {view === 'gallery' && (
          <>
            <span className={styles.modeTag}>{t('topbar.new', lang)}</span>
            <input
              ref={inputRef}
              type="text"
              className={styles.addressInput}
              placeholder={t('topbar.placeholder', lang)}
              value={draftTopic}
              onChange={(e) => onDraftTopicChange(e.target.value)}
              onPaste={onInputPaste}
            />
            {attachment && (
              <span className={styles.attachThumbWrap} title={attachment.file.name || 'image'}>
                <img src={attachment.previewUrl} alt="" className={styles.attachThumb} />
                <button
                  type="button"
                  className={styles.attachThumbRemove}
                  aria-label={t('topbar.attach.remove', lang)}
                  onClick={(e) => { e.preventDefault(); onAttachmentChange(null); }}
                ><Icon name="close" size={10} strokeWidth={2.5} /></button>
              </span>
            )}
            <button
              type="button"
              className={styles.attachBtn}
              title={t('topbar.attach', lang)}
              aria-label={t('topbar.attach', lang)}
              onClick={(e) => { e.preventDefault(); fileRef.current?.click(); }}
            ><Icon name="attach" size={14} /></button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onFilePicked}
            />
          </>
        )}

        {view === 'canvas' && currentNode && (
          <div className={styles.breadcrumb} aria-label="Path">
            {path.map((p, i) => {
              const isLast = i === path.length - 1;
              const shown = displayTopic(p.title, lang);
              return (
                <span key={p.hash} className={styles.crumbWrap}>
                  {i > 0 && <span className={styles.crumbSep}>›</span>}
                  <button
                    type="button"
                    className={`${styles.crumb} ${isLast ? styles.crumbCurrent : ''}`}
                    onClick={() => !isLast && onJumpBreadcrumb(p.hash)}
                    disabled={isLast}
                    title={shown}
                  >
                    {shown}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {view === 'canvas' && !currentNode && topic && (
          <span className={styles.crumb}>{displayTopic(topic, lang)}</span>
        )}

        {view === 'gallery' && (
          <button
            className={styles.submit}
            type="submit"
            disabled={(!draftTopic.trim() && !attachment) || busy}
          >
            {busy ? '…' : t('topbar.generate', lang)}
          </button>
        )}
      </form>

      {/* Right-side icon cluster — primary actions inline, secondary in More dropdown */}
      <div className={styles.rightCluster}>
        {view === 'canvas' && !readOnly && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onShare}
            title={t('topbar.share', lang)}
            aria-label="Share"
          ><Icon name="share" size={14} /></button>
        )}
        {view === 'canvas' && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleFullscreen}
            title={fullscreen ? t('topbar.fullscreen.exit', lang) : t('topbar.fullscreen.enter', lang)}
            aria-label="Fullscreen"
          ><Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen-enter'} size={14} /></button>
        )}
        {view === 'canvas' && fullscreen && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleChrome}
            title={t('topbar.chrome.toggle', lang)}
            aria-label="Toggle chrome"
          ><Icon name={showChrome ? 'eye' : 'eye-off'} size={14} /></button>
        )}
        <MoreMenu
          lang={lang}
          setLang={setLang}
          onToggleWebSearch={!readOnly ? onToggleWebSearch : undefined}
          onToggleLabels={view === 'canvas' ? onToggleLabels : undefined}
          onToggleComposeOnClick={view === 'canvas' && !readOnly ? onToggleComposeOnClick : undefined}
          onRegenerate={view === 'canvas' && !readOnly && currentNode ? onRegenerate : undefined}
          regenerateInfo={view === 'canvas' && currentNode ? {
            // Faithful to inputs: topic only if the user actually typed one
            // (root node records user_topic; null for image-only). Child
            // nodes have no topic input.
            userTopic: currentNode.gen_inputs?.user_topic ?? null,
            clickLabel: currentNode.gen_inputs?.user_label ?? null,
            clickXY: currentNode.gen_inputs?.click_xy ?? null,
            seedImageUrl: currentNode.seed_image_url
              ?? (currentNode.gen_inputs?.seed_image ? null : null),
          } : null}
          webSearch={webSearch}
          showLabels={showLabels}
          composeOnClick={composeOnClick}
        />
      </div>
    </div>
  );
}

// More-menu — collapses lower-priority toggles into a kebab dropdown so
// the right cluster stays compact as features accrue.
type RegenerateInfo = {
  userTopic: string | null;
  clickLabel: string | null;
  clickXY: [number, number] | null;
  seedImageUrl: string | null;
};

type MoreMenuProps = {
  lang: 'zh' | 'en';
  setLang: (l: 'zh' | 'en') => void;
  onToggleWebSearch?: () => void;
  onToggleLabels?: () => void;
  onToggleComposeOnClick?: () => void;
  onRegenerate?: () => void;
  regenerateInfo?: RegenerateInfo | null;
  webSearch: boolean;
  showLabels: boolean;
  composeOnClick: boolean;
};

function MoreMenu({
  lang, setLang,
  onToggleWebSearch, onToggleLabels, onToggleComposeOnClick, onRegenerate, regenerateInfo,
  webSearch, showLabels, composeOnClick,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();
  // Lightbox for viewing the seed image full-size from the regenerate info.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // Cast via the global DOM Node — the local `Node` import shadows it
      // (we imported it from state/types for breadcrumb props).
      if (!wrapRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Shared menu rows — rendered into the desktop dropdown or the mobile
  // bottom sheet depending on viewport.
  const menuItems = (
    <>
      {onRegenerate && (
        <>
          <button
            type="button"
            className={styles.moreItem}
            role="menuitem"
            onClick={() => { onRegenerate(); setOpen(false); }}
          >
            <Icon name="regenerate" size={14} />
            <span className={styles.moreItemLabel}>{t('topbar.regenerate', lang)}</span>
            {regenerateInfo && !isMobile
              && (regenerateInfo.userTopic || regenerateInfo.clickLabel
                || regenerateInfo.clickXY || regenerateInfo.seedImageUrl) && (
              <span
                className={styles.moreInfo}
                role="img"
                aria-label={t('topbar.regenerate.info', lang)}
                tabIndex={0}
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="info" size={12} />
                <span className={styles.moreInfoPop} role="tooltip">
                  {regenerateInfo.userTopic && (
                    <span className={styles.moreInfoRow}>
                      <span className={styles.moreInfoKey}>{t('topbar.regenerate.input.topic', lang)}</span>
                      <span className={styles.moreInfoVal}>{regenerateInfo.userTopic}</span>
                    </span>
                  )}
                  {regenerateInfo.clickLabel && (
                    <span className={styles.moreInfoRow}>
                      <span className={styles.moreInfoKey}>{t('topbar.regenerate.input.label', lang)}</span>
                      <span className={styles.moreInfoVal}>{regenerateInfo.clickLabel}</span>
                    </span>
                  )}
                  {regenerateInfo.clickXY && (
                    <span className={styles.moreInfoRow}>
                      <span className={styles.moreInfoKey}>{t('topbar.regenerate.input.click', lang)}</span>
                      <span className={styles.moreInfoVal}>
                        {regenerateInfo.clickXY[0].toFixed(2)}, {regenerateInfo.clickXY[1].toFixed(2)}
                      </span>
                    </span>
                  )}
                  {regenerateInfo.seedImageUrl && (
                    <span className={styles.moreInfoRow}>
                      <span className={styles.moreInfoKey}>{t('topbar.regenerate.input.image', lang)}</span>
                      <img
                        src={regenerateInfo.seedImageUrl}
                        alt=""
                        className={styles.moreInfoThumb}
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(regenerateInfo.seedImageUrl); }}
                      />
                    </span>
                  )}
                </span>
              </span>
            )}
          </button>
          <div className={styles.moreSep} aria-hidden />
        </>
      )}
      {onToggleComposeOnClick && (
        <button
          type="button"
          className={`${styles.moreItem} ${composeOnClick ? styles.moreItemOn : ''}`}
          role="menuitemcheckbox"
          aria-checked={composeOnClick}
          onClick={() => { onToggleComposeOnClick(); setOpen(false); }}
        >
          {/* Icon stays constant — on/off is shown by the row's tint
              + ◆ marker, not by swapping glyphs. */}
          <Icon name="long-press" size={14} />
          <span className={styles.moreItemLabel}>{t('topbar.compose-on-click', lang)}</span>
          <span className={styles.moreItemState} aria-hidden>
            {composeOnClick ? <Icon name="current" size={10} /> : null}
          </span>
        </button>
      )}
      {onToggleWebSearch && (
        <button
          type="button"
          className={`${styles.moreItem} ${webSearch ? styles.moreItemOn : ''}`}
          role="menuitemcheckbox"
          aria-checked={webSearch}
          onClick={() => { onToggleWebSearch(); setOpen(false); }}
        >
          <Icon name="web-on" size={14} />
          <span className={styles.moreItemLabel}>{t('topbar.web', lang)}</span>
          <span className={styles.moreItemState} aria-hidden>
            {webSearch ? <Icon name="current" size={10} /> : null}
          </span>
        </button>
      )}
      {onToggleLabels && (
        <button
          type="button"
          className={`${styles.moreItem} ${showLabels ? styles.moreItemOn : ''}`}
          role="menuitemcheckbox"
          aria-checked={showLabels}
          onClick={() => { onToggleLabels(); setOpen(false); }}
        >
          <Icon name="tag-on" size={14} />
          <span className={styles.moreItemLabel}>{t('topbar.labels', lang)}</span>
          <span className={styles.moreItemState} aria-hidden>
            {showLabels ? <Icon name="current" size={10} /> : null}
          </span>
        </button>
      )}
      <button
        type="button"
        className={styles.moreItem}
        role="menuitem"
        onClick={() => { setLang(lang === 'zh' ? 'en' : 'zh'); setOpen(false); }}
      >
        <span className={styles.langInline}>{lang === 'zh' ? 'EN' : '中'}</span>
        <span className={styles.moreItemLabel}>{t('topbar.lang.zh', lang)}</span>
      </button>
    </>
  );

  return (
    <div ref={wrapRef} className={styles.moreWrap}>
      <button
        type="button"
        className={styles.miniBtn}
        onClick={() => setOpen((v) => !v)}
        title={t('topbar.more', lang)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('topbar.more', lang)}
      ><Icon name="more" size={14} /></button>
      {open && !isMobile && (
        <div className={styles.moreMenu} role="menu">
          {menuItems}
        </div>
      )}
      {isMobile && (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={t('topbar.more', lang)}>
          <div className={styles.moreSheetList} role="menu">
            {menuItems}
          </div>
        </BottomSheet>
      )}
      {lightboxUrl && createPortal(
        <div className={styles.lightbox} onClick={() => setLightboxUrl(null)} role="presentation">
          <img src={lightboxUrl} alt="" className={styles.lightboxImg} />
        </div>,
        document.body,
      )}
    </div>
  );
}
