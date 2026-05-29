import styles from '../styles/TopBar.module.css';
import type { Node } from '../state/types';

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
  fullscreen: boolean;
  showChrome: boolean;
  showLabels: boolean;
  webSearch: boolean;
  readOnly: boolean;
  busy: boolean;
};

export function TopBar(props: Props) {
  const {
    view, topic, currentNode, draftTopic, onDraftTopicChange, onSubmitTopic,
    onBackToGallery, onJumpBreadcrumb, onShare, onToggleFullscreen, onToggleChrome,
    onToggleLabels, onToggleWebSearch,
    fullscreen, showChrome, showLabels, webSearch, readOnly, busy,
  } = props;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || readOnly) return;
    if (view === 'gallery' && draftTopic.trim()) {
      onSubmitTopic();
    }
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
          title="Open gallery / 打开市场"
          aria-label="Gallery"
        >
          <span className={styles.iconLabel}>☰</span>
          <span className={styles.btnText}>Gallery</span>
        </button>
      )}

      {/* Address-bar capsule */}
      <form className={styles.address} onSubmit={onSubmit}>
        {view === 'gallery' && (
          <>
            <span className={styles.modeTag}>New</span>
            <input
              type="text"
              className={styles.addressInput}
              placeholder="Enter a topic / 输入主题"
              value={draftTopic}
              onChange={(e) => onDraftTopicChange(e.target.value)}
            />
          </>
        )}

        {view === 'canvas' && currentNode && (
          <div className={styles.breadcrumb} aria-label="Path">
            {path.map((p, i) => {
              const isLast = i === path.length - 1;
              return (
                <span key={p.hash} className={styles.crumbWrap}>
                  {i > 0 && <span className={styles.crumbSep}>›</span>}
                  <button
                    type="button"
                    className={`${styles.crumb} ${isLast ? styles.crumbCurrent : ''}`}
                    onClick={() => !isLast && onJumpBreadcrumb(p.hash)}
                    disabled={isLast}
                    title={p.title}
                  >
                    {p.title}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {view === 'canvas' && !currentNode && topic && (
          <span className={styles.crumb}>{topic}</span>
        )}

        {view === 'gallery' && (
          <button
            className={styles.submit}
            type="submit"
            disabled={!draftTopic.trim() || busy}
          >
            {busy ? '…' : 'Generate'}
          </button>
        )}
      </form>

      {/* Right-side icon cluster — always mini */}
      <div className={styles.rightCluster}>
        {!readOnly && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleWebSearch}
            title={webSearch
              ? 'Web search ON · 联网搜索已开启 (click to disable)'
              : 'Web search OFF · 联网搜索已关闭 (click to enable)'}
            aria-label="Toggle web search"
            aria-pressed={!webSearch}
            style={!webSearch ? { opacity: 0.5 } : undefined}
          >{webSearch ? '🌐' : '⊘'}</button>
        )}
        {view === 'canvas' && !readOnly && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onShare}
            title="Create share link / 创建分享链接"
            aria-label="Share"
          >🔗</button>
        )}
        {view === 'canvas' && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleLabels}
            title={showLabels ? 'Hide labels / 隐藏标签' : 'Show labels / 显示标签'}
            aria-label="Toggle labels"
            aria-pressed={!showLabels}
          >{showLabels ? '🏷' : '⊘'}</button>
        )}
        {view === 'canvas' && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Exit fullscreen / 退出全屏' : 'Fullscreen / 全屏'}
            aria-label="Fullscreen"
          >{fullscreen ? '⤢' : '⛶'}</button>
        )}
        {view === 'canvas' && fullscreen && (
          <button
            type="button"
            className={styles.miniBtn}
            onClick={onToggleChrome}
            title="Toggle UI chrome / 显隐文本面板"
            aria-label="Toggle chrome"
          >{showChrome ? '👁' : '🚫'}</button>
        )}
      </div>
    </div>
  );
}
