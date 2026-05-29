// Tiny i18n + cookie-persistence layer.
//
// One source of truth: a `messages` table keyed by short ids, with `zh` /
// `en` entries. The current language is read from the cookie at module
// load (so SSR-style first paints pick the right strings) and otherwise
// detected from `navigator.language` — defaulting to Chinese when nothing
// is decisive.
//
// Components use the `useLang()` hook to read the current language and a
// `setLang(next)` setter that writes the cookie + dispatches a window event
// so other hook consumers re-render.
import { useEffect, useState } from 'react';

export type Lang = 'zh' | 'en';

const COOKIE_NAME = 'flipbook_lang';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const EVENT = 'flipbook:lang-change';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) return decodeURIComponent(trimmed.slice(target.length));
  }
  return null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function detectInitial(): Lang {
  const stored = readCookie(COOKIE_NAME);
  if (stored === 'zh' || stored === 'en') return stored;
  if (typeof navigator !== 'undefined') {
    const navLang = (navigator.language || '').toLowerCase();
    // Anything that starts with `zh` (zh-CN, zh-TW, zh-HK, …) is Chinese;
    // a clear English signal flips to English; otherwise default Chinese.
    if (navLang.startsWith('zh')) return 'zh';
    if (navLang.startsWith('en')) return 'en';
  }
  return 'zh';
}

let current: Lang = detectInitial();

export function getLang(): Lang { return current; }

export function setLang(next: Lang) {
  if (next !== 'zh' && next !== 'en') return;
  if (next === current) return;
  current = next;
  writeCookie(COOKIE_NAME, next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }
}

// React hook — re-renders subscribers when setLang is called.
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLocal] = useState<Lang>(current);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Lang>).detail;
      if (detail === 'zh' || detail === 'en') setLocal(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return [lang, setLang];
}

// --- Message catalogue ---
// Keep keys short and stable; values are the literal translated strings.
// Use `tf(key, vars)` for interpolation.
type Catalogue = Record<string, { zh: string; en: string }>;

export const messages: Catalogue = {
  // TopBar
  'topbar.gallery': { zh: '画廊', en: 'Gallery' },
  'topbar.gallery.tip': { zh: '打开画廊', en: 'Open gallery' },
  'topbar.new': { zh: '新建', en: 'New' },
  'topbar.placeholder': { zh: '输入主题', en: 'Enter a topic' },
  'topbar.generate': { zh: '生成', en: 'Generate' },
  'topbar.share': { zh: '创建分享链接', en: 'Create share link' },
  'topbar.labels.show': { zh: '显示标签', en: 'Show labels' },
  'topbar.labels.hide': { zh: '隐藏标签', en: 'Hide labels' },
  'topbar.fullscreen.enter': { zh: '全屏', en: 'Fullscreen' },
  'topbar.fullscreen.exit': { zh: '退出全屏', en: 'Exit fullscreen' },
  'topbar.chrome.toggle': { zh: '显隐文本面板', en: 'Toggle UI chrome' },
  'topbar.web.on': { zh: '联网搜索已开启 (点击关闭)', en: 'Web search ON (click to disable)' },
  'topbar.web.off': { zh: '联网搜索已关闭 (点击开启)', en: 'Web search OFF (click to enable)' },
  'topbar.lang.zh': { zh: '切换到 English', en: 'Switch to 中文' },
  'topbar.attach': { zh: '附加图片(粘贴或选择)', en: 'Attach image (paste or pick)' },
  'topbar.attach.remove': { zh: '移除图片', en: 'Remove image' },
  'topbar.compose-on-click.on': { zh: '点击后弹出输入框 (开)', en: 'Compose-on-click (on)' },
  'topbar.compose-on-click.off': { zh: '点击直接生成 (关)', en: 'Generate immediately (off)' },
  'topbar.more': { zh: '更多', en: 'More' },

  // Canvas
  'canvas.loading': { zh: '正在生成…', en: 'Generating canvas…' },
  'canvas.loading.short': { zh: '加载中…', en: 'Loading…' },
  'canvas.cap.full': { zh: '4 个并行已满,等其中一个完成', en: 'Wait for one to finish' },
  'canvas.hint.press': { zh: '长按图片任意位置 2 秒即可深入', en: 'Press and hold any spot on the image (2 s) to expand' },
  'canvas.preview.hint': { zh: '只读预览,无法触发新生成。生成中的进度仍会同步。', en: 'Read-only preview — clicks disabled. Live progress still streams in.' },
  'canvas.preview.badge': { zh: '只读预览', en: 'Preview' },
  'canvas.busy.badge': { zh: '并行中', en: 'in-flight' },

  // Phase chips on pending click bubbles
  'phase.planning': { zh: '推断标签…', en: 'Inferring label…' },
  'phase.image': { zh: '生成图片…', en: 'Generating image…' },
  'phase.finalizing': { zh: '收尾中…', en: 'Finalizing…' },

  // Hotspot card
  'hotspot.delete.tip': { zh: '删除该分支', en: 'Delete this branch' },

  // Click composer panel
  'composer.placeholder': { zh: '可选:输入主题或粘贴图片', en: 'Optional: type a topic or paste an image' },
  'composer.submit': { zh: '生成 (回车)', en: 'Generate (Enter)' },
  'composer.cancel': { zh: '取消 (Esc)', en: 'Cancel (Esc)' },

  // Confirm modal — node delete
  'confirm.delete.title': { zh: '确认删除该分支?', en: 'Delete this branch?' },
  'confirm.delete.confirm': { zh: '删除', en: 'Delete' },
  'confirm.delete.cancel': { zh: '取消', en: 'Cancel' },

  // Sources / catalog badges
  'sources.heading': { zh: '参考来源', en: 'References' },
  'tree.heading': { zh: '目录', en: 'Catalog' },
  'tree.tip': { zh: '目录', en: 'Catalog' },

  // Toasts
  'toast.click.failed': { zh: '点击失败', en: 'Click failed' },
  'toast.create.failed': { zh: '创建失败', en: 'Create failed' },
  'toast.delete.failed': { zh: '删除失败', en: 'Delete failed' },
  'toast.deleted': { zh: '已删除', en: 'Deleted' },
  'toast.share.copied': { zh: '分享链接已复制', en: 'Share link copied' },
  'toast.share.fallback': { zh: '分享链接', en: 'Share link' },
  'toast.share.failed': { zh: '分享失败', en: 'Share failed' },
  'toast.bad.share': { zh: '分享链接无效', en: 'Bad share link' },
  'toast.preview.failed': { zh: '预览加载失败', en: 'Preview load failed' },
  'toast.canvas.load.failed': { zh: '画布加载失败', en: 'Failed to load canvas' },
  'toast.click.rejected': { zh: '该点无可深入内容,请重新选点', en: 'Nothing specific to drill into here — please pick a different spot' },

  // Gallery
  'gallery.title': { zh: '画廊', en: 'Gallery' },
  'gallery.loading': { zh: '加载中…', en: 'Loading…' },
  'gallery.error': { zh: '画廊错误', en: 'Gallery error' },
  'gallery.count.one': { zh: '{n} 个画册', en: '{n} flipbook' },
  'gallery.count.many': { zh: '{n} 个画册', en: '{n} flipbooks' },
  'gallery.empty.line1': { zh: '还没有画册', en: 'No flipbooks yet.' },
  'gallery.empty.line2': { zh: '在顶部输入主题即可开始', en: 'Type a topic above to start your first one.' },
  'gallery.cover.generating': { zh: '生成中…', en: 'generating…' },
  'gallery.nodes.one': { zh: '{n} 张画布', en: '{n} node' },
  'gallery.nodes.many': { zh: '{n} 张画布', en: '{n} nodes' },

  // Relative time
  'time.justNow': { zh: '刚刚', en: 'just now' },
  'time.minutesAgo': { zh: '{n} 分钟前', en: '{n}m ago' },
  'time.hoursAgo': { zh: '{n} 小时前', en: '{n}h ago' },
  'time.daysAgo': { zh: '{n} 天前', en: '{n}d ago' },
};

export function t(key: keyof typeof messages, lang: Lang = current): string {
  const entry = messages[key];
  if (!entry) return String(key);
  return entry[lang];
}

// Interpolation helper for messages with {placeholders}. Pass the format
// string already localised.
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
