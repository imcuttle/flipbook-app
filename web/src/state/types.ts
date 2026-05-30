// Mirrors the server's node JSON schema.
export type Hotspot = {
  label: string;
  anchor_xy: [number, number];
  leader_xy: [number, number];
  next_prompt?: string;
  next_hash?: string | null;
};

export type SourceRef = {
  title: string;
  url: string;
  snippet?: string | null;
  source?: string | null; // hostname / publisher
};

// One OCR'd text run baked into the generated image. bbox is normalized
// 0..1 with origin at the image's TOP-LEFT.
export type TextSpan = {
  text: string;
  bbox: [number, number, number, number];
  confidence?: number;
};

export type Node = {
  hash: string;
  depth: number;
  parent: string | null;
  title: string;
  caption: string;
  image: string;          // relative path (e.g. "images/<hash>.png")
  image_prompt: string;
  hotspots: Hotspot[];
  sources?: SourceRef[];
  text_layer?: TextSpan[];
  image_w?: number;
  image_h?: number;
  // True if this node was generated with the web-search step enabled.
  // Used by the UI on navigation to default the toggle to the value picked
  // when this node was created.
  web_search_used?: boolean;
  // Persisted seed-image absolute path (server-side filesystem) — present
  // when this node was generated from an uploaded image. The frontend
  // mostly uses it as an "this node had a seed" signal; the actual file
  // isn't fetchable over the API.
  seed_image?: string | null;
  // Snapshot of the original click context that produced this node.
  // Replayed by the regenerate flow; also surfaced as the info-hover
  // popover in the More menu.
  gen_inputs?: {
    parent_hash: string;
    click_xy: [number, number];
    user_label: string | null;
    seed_image: string | null;
  } | null;
  path: { hash: string; title: string }[];
  generated_at: string;
  style_tag: string;
};export type Tree = {
  topic: string;
  topic_slug: string;
  root: string | null;
  branches: number;
  style: string;
  nodes: Record<string, { title: string; depth: number; parent: string | null; children: string[] }>;
};

// SSE event payloads
export type SseEvent =
  | { type: 'planning_started'; canvasId: string; jobId: string; parentHash: string | null; hotspotIndex: number | null; label: string | null; clickXY?: [number, number] }
  | { type: 'search_started'; canvasId: string; jobId: string; queries: string[] }
  | { type: 'search_done'; canvasId: string; jobId: string; queries: string[]; sourceCount: number }
  | { type: 'planner_done'; canvasId: string; jobId: string; hash: string; node: Omit<Node, 'image' | 'generated_at'> }
  | { type: 'image_started'; canvasId: string; jobId: string; hash: string }
  | { type: 'image_ready'; canvasId: string; jobId: string; hash: string; imageUrl: string; fallback: boolean }
  | { type: 'ocr_done'; canvasId: string; jobId: string; hash: string; spanCount: number }
  | { type: 'node_ready'; canvasId: string; jobId: string; hash: string; node: Node }
  | { type: 'tree_updated'; canvasId: string; jobId: string; treeNodeCount: number }
  | { type: 'phase_message'; canvasId: string; jobId: string; messageKey: string; messageEn: string }
  | { type: 'gen_error'; canvasId: string; jobId: string; phase: 'plan' | 'image' | 'register'; message: string; recoverable: boolean; code?: string }
  | { type: 'click_rejected'; canvasId: string; jobId: string; parentHash: string; clickXY: [number, number]; reason: string }
  | { type: 'node_deleted'; canvasId: string; hash: string; deletedHashes: string[]; parentHash: string | null }
  | { type: 'done'; canvasId: string; jobId: string; hash: string; cacheHit: boolean };

// UI-only types
export type GenStatus =
  | { phase: 'idle' }
  | { phase: 'planning'; jobId?: string }
  | { phase: 'image_loading'; jobId?: string; hash: string }
  | { phase: 'ready' };

export type Toast = { id: number; level: 'info' | 'warn' | 'error'; message: string };

export type GalleryEntry = {
  canvasId: string;
  topic: string;
  slug: string;
  branches: number;
  created_at: string;
  last_run_at: string;
  rootHash: string | null;
  coverImage: string | null; // server-relative URL or null
  nodeCount: number;
};

export type View = 'gallery' | 'canvas';

// Per-click in-flight progress entry. Keyed by jobId. Position is in [0..1] and
// is set when the user issues the click; the SSE pipeline updates `phase` as
// it advances, then drops the entry on `done`.
export type PendingClick = {
  jobId: string;
  parentHash: string;
  clickXY: [number, number];
  phase: 'planning' | 'image_loading' | 'finalizing';
  startedAt: number;
  // Optional user-facing progress line streamed by the server (i18n key
  // + english fallback). When present the canvas's pending bubble shows
  // this instead of the static phase chip.
  messageKey?: string;
  messageEn?: string;
};

export type AppState = {
  view: View;
  canvasId: string | null;
  topic: string | null;
  rootHash: string | null;
  currentHash: string | null;
  nodes: Record<string, Node>;
  tree: Tree | null;
  status: GenStatus;
  toasts: Toast[];

  // v2 additions
  readOnly: boolean;                       // share-link preview mode
  shareToken: string | null;
  pendingClicks: Record<string, PendingClick>; // by jobId
  pendingByParent: Record<string, string[]>;   // parentHash -> [jobId, ...]
  fullscreen: boolean;
  showChrome: boolean;                     // breadcrumb / caption / hint visibility in fullscreen
  showLabels: boolean;                     // hotspot card overlay visibility
  webSearch: boolean;                      // ask the planner to consult the web before generating
  // Last click position on the *parent* node, used as the zoom-in origin for
  // the next child's enter animation. Cleared after the animation triggers.
  lastDrillFrom: { parentHash: string; xy: [number, number] } | null;
};

// localStorage-backed pref for the web-search toggle. Read once at module
// load so initialState reflects the user's last choice across page reloads.
// Defaults to ON when no value is stored or on SSR/Node.
const WEB_SEARCH_KEY = 'flipbook_web_search';
function readWebSearchPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(WEB_SEARCH_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* localStorage unavailable */ }
  return true;
}

export function persistWebSearchPref(on: boolean) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(WEB_SEARCH_KEY, on ? '1' : '0'); } catch {}
}

export const initialState: AppState = {
  view: 'gallery',
  canvasId: null,
  topic: null,
  rootHash: null,
  currentHash: null,
  nodes: {},
  tree: null,
  status: { phase: 'idle' },
  toasts: [],
  readOnly: false,
  shareToken: null,
  pendingClicks: {},
  pendingByParent: {},
  fullscreen: false,
  showChrome: true,
  showLabels: true,
  webSearch: readWebSearchPref(),
  lastDrillFrom: null,
};
