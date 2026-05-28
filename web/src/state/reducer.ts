import type { AppState, Node, SseEvent, Tree, Toast, View, PendingClick } from './types';
import { initialState } from './types';

export type Action =
  | { type: 'reset' }
  | { type: 'set_view'; view: View }
  | { type: 'canvas_created'; canvasId: string; topic: string }
  | { type: 'set_tree'; tree: Tree }
  | { type: 'sse'; evt: SseEvent }
  | { type: 'navigate'; hash: string }
  | { type: 'click_pending_local'; jobId: string; parentHash: string; clickXY: [number, number] }
  | { type: 'set_share_mode'; canvasId: string; topic: string; token: string }
  | { type: 'set_fullscreen'; on: boolean }
  | { type: 'toggle_chrome' }
  | { type: 'toggle_labels' }
  | { type: 'consume_drill_origin' }
  | { type: 'add_toast'; toast: Omit<Toast, 'id'> }
  | { type: 'remove_toast'; id: number };

let _toastId = 1;

function dropPending(state: AppState, jobId: string): AppState {
  const click = state.pendingClicks[jobId];
  if (!click) return state;
  const pendingClicks = { ...state.pendingClicks };
  delete pendingClicks[jobId];
  const arr = (state.pendingByParent[click.parentHash] ?? []).filter((j) => j !== jobId);
  const pendingByParent = { ...state.pendingByParent };
  if (arr.length) pendingByParent[click.parentHash] = arr;
  else delete pendingByParent[click.parentHash];
  return { ...state, pendingClicks, pendingByParent };
}

function setPendingPhase(state: AppState, jobId: string, phase: PendingClick['phase']): AppState {
  const c = state.pendingClicks[jobId];
  if (!c) return state;
  return {
    ...state,
    pendingClicks: { ...state.pendingClicks, [jobId]: { ...c, phase } },
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'reset':
      return initialState;

    case 'set_view':
      // Going back to gallery clears the per-canvas state so URL params are
      // dropped and a previous preview-mode session doesn't leak into a new one.
      if (action.view === 'gallery') {
        return {
          ...initialState,
          view: 'gallery',
          toasts: state.toasts,
        };
      }
      return { ...state, view: action.view };

    case 'canvas_created':
      return {
        ...initialState,
        view: 'canvas',
        canvasId: action.canvasId,
        topic: action.topic,
        status: { phase: 'planning' },
      };

    case 'set_share_mode':
      return {
        ...initialState,
        view: 'canvas',
        canvasId: action.canvasId,
        topic: action.topic,
        readOnly: true,
        shareToken: action.token,
        status: { phase: 'idle' },
      };

    case 'set_tree':
      return { ...state, tree: action.tree, rootHash: state.rootHash ?? action.tree.root };

    case 'navigate': {
      if (!state.nodes[action.hash]) return state;
      // Manual breadcrumb / hotspot navigation — clear any pending drill origin
      // so the destination plays a "side jump" fade rather than a zoom-in.
      return { ...state, currentHash: action.hash, status: { phase: 'ready' }, lastDrillFrom: null };
    }

    case 'click_pending_local': {
      // Idempotent: if SSE planning_started arrived first and already created
      // the entry, just keep it. Without this guard we'd double-push the jobId
      // into pendingByParent and the UI counter would over-count (e.g. 5/4
      // after only 3 clicks).
      if (state.pendingClicks[action.jobId]) return state;
      const click: PendingClick = {
        jobId: action.jobId,
        parentHash: action.parentHash,
        clickXY: action.clickXY,
        phase: 'planning',
        startedAt: Date.now(),
      };
      const arr = state.pendingByParent[action.parentHash] ?? [];
      return {
        ...state,
        pendingClicks: { ...state.pendingClicks, [action.jobId]: click },
        pendingByParent: { ...state.pendingByParent, [action.parentHash]: [...arr, action.jobId] },
        // Remember zoom-in origin so the upcoming child's enter animation can
        // expand from this point. Will be consumed (and cleared) when the
        // child node_ready arrives and we navigate.
        lastDrillFrom: { parentHash: action.parentHash, xy: action.clickXY },
      };
    }

    case 'set_fullscreen':
      return { ...state, fullscreen: action.on, showChrome: action.on ? state.showChrome : true };

    case 'toggle_chrome':
      return { ...state, showChrome: !state.showChrome };

    case 'toggle_labels':
      return { ...state, showLabels: !state.showLabels };

    case 'consume_drill_origin':
      return state.lastDrillFrom ? { ...state, lastDrillFrom: null } : state;

    case 'add_toast': {
      const id = _toastId++;
      const toasts = [...state.toasts, { id, ...action.toast }].slice(-5);
      return { ...state, toasts };
    }

    case 'remove_toast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    case 'sse':
      return applySse(state, action.evt);

    default:
      return state;
  }
}

function applySse(state: AppState, evt: SseEvent): AppState {
  switch (evt.type) {
    case 'planning_started': {
      // Adopt server-issued jobId for a click we made locally — the click handler
      // dispatches click_pending_local with that same jobId synchronously after
      // POST resolves, so usually our entry already exists. If not (e.g. share
      // viewer watching a creator's session), create it here from clickXY.
      let s = state;
      if (evt.parentHash && evt.clickXY && !state.pendingClicks[evt.jobId]) {
        const click: PendingClick = {
          jobId: evt.jobId,
          parentHash: evt.parentHash,
          clickXY: evt.clickXY,
          phase: 'planning',
          startedAt: Date.now(),
        };
        const arr = state.pendingByParent[evt.parentHash] ?? [];
        s = {
          ...state,
          pendingClicks: { ...state.pendingClicks, [evt.jobId]: click },
          pendingByParent: { ...state.pendingByParent, [evt.parentHash]: [...arr, evt.jobId] },
        };
      }
      return { ...s, status: { phase: 'planning', jobId: evt.jobId } };
    }

    case 'search_started':
    case 'search_done':
      // We surface search progress to the pending click bubble via the
      // pendingPhase setter so the user sees "searching web" instead of stalled
      // "inferring label". Treat both events as a planning sub-phase.
      return state;

    case 'planner_done': {
      const skel = evt.node as Node;
      const existing = state.nodes[evt.hash];
      const merged = existing && existing.image
        ? { ...skel, ...existing }
        : (skel as Node);
      let s: AppState = {
        ...state,
        nodes: { ...state.nodes, [evt.hash]: merged as Node },
        status: { phase: 'image_loading', jobId: evt.jobId, hash: evt.hash },
      };
      s = setPendingPhase(s, evt.jobId, 'image_loading');
      return s;
    }

    case 'image_started': {
      let s: AppState = { ...state, status: { phase: 'image_loading', jobId: evt.jobId, hash: evt.hash } };
      s = setPendingPhase(s, evt.jobId, 'image_loading');
      return s;
    }

    case 'image_ready': {
      const cur = state.nodes[evt.hash];
      const updated: Node | undefined = cur ? { ...cur, image: evt.imageUrl } : undefined;
      const nodes = updated ? { ...state.nodes, [evt.hash]: updated } : state.nodes;
      return { ...state, nodes };
    }

    case 'node_ready': {
      const node = evt.node;
      let s: AppState = {
        ...state,
        nodes: { ...state.nodes, [evt.hash]: node },
        status: { phase: 'ready' as const },
      };
      if (!node.parent) {
        s = {
          ...s,
          rootHash: state.rootHash ?? evt.hash,
          currentHash: state.currentHash ?? evt.hash,
        };
      } else if (node.parent && state.currentHash === node.parent) {
        s = { ...s, currentHash: evt.hash };
      }
      return s;
    }

    case 'tree_updated':
      return state;

    case 'error': {
      const id = _toastId++;
      const msg = `${evt.phase}: ${evt.message}`;
      const next: Toast = { id, level: 'error', message: msg };
      let s: AppState = { ...state, toasts: [...state.toasts, next].slice(-5) };
      s = dropPending(s, evt.jobId);
      return s;
    }

    case 'done':
      return dropPending(state, evt.jobId);

    default:
      return state;
  }
}
