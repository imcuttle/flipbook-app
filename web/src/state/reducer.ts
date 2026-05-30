import type { AppState, Node, SseEvent, Tree, Toast, View, PendingClick } from './types';
import { initialState, persistWebSearchPref } from './types';

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
  | { type: 'toggle_web_search' }
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
          // Preserve UI prefs that aren't tied to a specific canvas.
          webSearch: state.webSearch,
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
        // Preserve UI prefs across canvas creation so a user who turned web
        // search off doesn't have it silently re-enabled on the next topic.
        webSearch: state.webSearch,
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
      const nextNode = state.nodes[action.hash];
      if (!nextNode) return state;
      // Manual breadcrumb / hotspot navigation — clear any pending drill origin
      // so the destination plays a "side jump" fade rather than a zoom-in.
      // Also re-sync the web-search toggle to whatever value was used when
      // the destination node was generated, so the toggle reflects the
      // current branch's history. Falls back to the existing state for
      // legacy nodes that don't have the field yet.
      const webSearch = typeof nextNode.web_search_used === 'boolean'
        ? nextNode.web_search_used
        : state.webSearch;
      return {
        ...state,
        currentHash: action.hash,
        status: { phase: 'ready' },
        lastDrillFrom: null,
        webSearch,
      };
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

    case 'toggle_web_search': {
      const next = !state.webSearch;
      // Persist across page reloads. Per-node history (node.web_search_used)
      // still overrides on navigate, so this only changes the *default* the
      // user sees when starting fresh / before navigating to a node that
      // recorded its own value.
      persistWebSearchPref(next);
      return { ...state, webSearch: next };
    }

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
      // When we adopt this node as the visible one (root on first paint, or
      // auto-navigate to a freshly-completed child of the current node),
      // re-sync the web-search toggle to whatever the node was generated
      // with. See navigate-action comment for rationale.
      const adoptToggle = (n: Node) =>
        typeof n.web_search_used === 'boolean' ? n.web_search_used : s.webSearch;
      if (!node.parent) {
        s = {
          ...s,
          rootHash: state.rootHash ?? evt.hash,
          currentHash: state.currentHash ?? evt.hash,
          webSearch: state.currentHash ? s.webSearch : adoptToggle(node),
        };
      } else if (node.parent && state.currentHash === node.parent) {
        // Only auto-navigate to a finished child if the user is sitting on
        // its parent AND there are no other in-flight clicks under that
        // parent. In multi-click parallel mode we don't want a sibling
        // racing to first-finished to yank the canvas away from a click
        // the user might still be evaluating.
        const otherPending = (state.pendingByParent[node.parent] ?? [])
          .filter((j) => j !== evt.jobId).length;
        if (otherPending === 0) {
          s = { ...s, currentHash: evt.hash, webSearch: adoptToggle(node) };
        }
      }
      // Keep state.tree in sync so the catalog (TreeBadge) updates live as
      // nodes finish — without this it only refreshed on a full reload
      // (getTree). We upsert the node into tree.nodes and link it under its
      // parent's children[]. Root sets tree.root.
      if (s.tree?.nodes) {
        const tnodes = { ...s.tree.nodes };
        const existing = tnodes[evt.hash];
        tnodes[evt.hash] = {
          title: node.title,
          depth: node.depth ?? existing?.depth ?? 0,
          parent: node.parent ?? null,
          children: existing?.children ?? [],
        };
        // Link into parent's children[] (dedup).
        if (node.parent && tnodes[node.parent]) {
          const kids = tnodes[node.parent].children ?? [];
          if (!kids.includes(evt.hash)) {
            tnodes[node.parent] = { ...tnodes[node.parent], children: [...kids, evt.hash] };
          }
        }
        const nextTree = { ...s.tree, nodes: tnodes };
        if (!node.parent && !nextTree.root) nextTree.root = evt.hash;
        s = { ...s, tree: nextTree };
      }
      return s;
    }

    case 'tree_updated':
      return state;

    case 'phase_message': {
      // Stream a user-facing progress line into the matching pending
      // click bubble so the user sees what step is currently running
      // (analysing image / searching / planning / repairing prompt /
      // generating image / etc.) instead of just a static phase chip.
      const c = state.pendingClicks[evt.jobId];
      if (!c) return state;
      return {
        ...state,
        pendingClicks: {
          ...state.pendingClicks,
          [evt.jobId]: { ...c, messageKey: evt.messageKey, messageEn: evt.messageEn },
        },
      };
    }

    case 'click_rejected': {
      // The label LLM didn't see anything drillable under the click.
      // Drop the pending bubble + tell the user to pick a different spot.
      let s = dropPending(state, evt.jobId);
      // Also clear the drill-from origin so the next navigate doesn't
      // animate from a stale point.
      if (s.lastDrillFrom?.parentHash === evt.parentHash) {
        s = { ...s, lastDrillFrom: null };
      }
      const id = _toastId++;
      const reason = evt.reason || 'No drillable subject under that point.';
      const msg = `${reason} · 该点无可深入内容,请重新选点`;
      const toast: Toast = { id, level: 'warn', message: msg };
      return { ...s, toasts: [...s.toasts, toast].slice(-5) };
    }

    case 'node_deleted': {
      // Remove deleted node hashes from state.nodes and from state.tree.
      const deleted = new Set(evt.deletedHashes);
      const cancelledLabel = evt.cancelledHotspot?.label ?? null;
      const cancelledParent = evt.cancelledHotspot?.parentHash ?? null;
      const nodes: Record<string, Node> = {};
      for (const [h, n] of Object.entries(state.nodes)) {
        if (deleted.has(h)) continue;
        // Strip stale hotspots from surviving parents — both linked
        // (next_hash points at a deleted node) and pending (matched by
        // (parentHash, label) for the cancel-hotspot path where there's
        // no real child hash yet).
        const hotspots = (n.hotspots ?? []).filter((hot) => {
          if (hot.next_hash && deleted.has(hot.next_hash)) return false;
          if (
            cancelledLabel
            && cancelledParent === h
            && !hot.next_hash
            && hot.label === cancelledLabel
          ) return false;
          return true;
        });
        nodes[h] = hotspots.length === (n.hotspots ?? []).length ? n : { ...n, hotspots };
      }
      let tree = state.tree;
      if (tree?.nodes) {
        const treeNodes: typeof tree.nodes = {};
        for (const [h, n] of Object.entries(tree.nodes)) {
          if (deleted.has(h)) continue;
          // Drop deleted children from the parent's children[] list.
          const children = (n.children ?? []).filter((c) => !deleted.has(c));
          treeNodes[h] = { ...n, children };
        }
        tree = { ...tree, nodes: treeNodes };
        if (tree.root && deleted.has(tree.root)) tree = { ...tree, root: null };
      }
      // If the user is sitting on a deleted node, jump to its parent (or
      // root, or gallery) so we don't render a missing node.
      let currentHash = state.currentHash;
      if (currentHash && deleted.has(currentHash)) {
        currentHash = evt.parentHash ?? state.rootHash ?? null;
      }
      let rootHash = state.rootHash;
      if (rootHash && deleted.has(rootHash)) rootHash = null;
      // Drop any pendingClick whose parent matches the cancelled hotspot
      // and whose XY is near the cancelled hotspot's leader_xy. Without
      // this the spinner bubble keeps pulsing forever after cancel.
      let pendingClicks = state.pendingClicks;
      let pendingByParent = state.pendingByParent;
      if (cancelledParent && evt.cancelledHotspot?.leaderXY) {
        const [lx, ly] = evt.cancelledHotspot.leaderXY;
        const drop: string[] = [];
        for (const [jobId, pc] of Object.entries(state.pendingClicks)) {
          if (pc.parentHash !== cancelledParent) continue;
          const dx = pc.clickXY[0] - lx;
          const dy = pc.clickXY[1] - ly;
          if (Math.hypot(dx, dy) <= 0.06) drop.push(jobId);
        }
        if (drop.length) {
          pendingClicks = { ...state.pendingClicks };
          for (const j of drop) delete pendingClicks[j];
          const arr = (state.pendingByParent[cancelledParent] ?? []).filter((j) => !drop.includes(j));
          pendingByParent = { ...state.pendingByParent };
          if (arr.length) pendingByParent[cancelledParent] = arr;
          else delete pendingByParent[cancelledParent];
        }
      }
      return {
        ...state,
        nodes, tree, currentHash, rootHash,
        pendingClicks, pendingByParent,
      };
    }

    case 'gen_error': {
      const id = _toastId++;
      // seed_refused: the uploaded image was declined by the image model and
      // we fell back to text-to-image. Generation CONTINUES, so this is a
      // warn-level toast carrying the model's reason verbatim, and we must
      // NOT drop the pending click (the image is still coming).
      if (evt.code === 'seed_refused') {
        const next: Toast = { id, level: 'warn', message: evt.message };
        return { ...state, toasts: [...state.toasts, next].slice(-5) };
      }
      // image_fallback: providers failed, svg placeholder shown. The server
      // already localised the message; show it verbatim at warn level. The
      // node still rendered (placeholder), so don't drop pending here — the
      // node_ready/done events manage that.
      if (evt.code === 'image_fallback') {
        const next: Toast = { id, level: 'warn', message: evt.message };
        return { ...state, toasts: [...state.toasts, next].slice(-5) };
      }
      // Refusals (model declined to plan, e.g. content-policy) come through
      // as code=planner_refusal. Store an i18n key instead of the raw
      // model prose so Toast renders in the user's currently selected
      // language (Chinese UI gets Chinese refusal copy, English UI gets
      // English). Keep raw message as fallback / title context.
      const isRefusal = evt.code === 'planner_refusal';
      const msg = isRefusal ? evt.message : `${evt.phase}: ${evt.message}`;
      const next: Toast = isRefusal
        ? {
            id,
            level: 'warn',
            message: msg,
            messageKey: 'toast.planner.refusal',
          }
        : { id, level: 'error', message: msg };
      let s: AppState = { ...state, toasts: [...state.toasts, next].slice(-5) };
      s = dropPending(s, evt.jobId);
      // Root-generation failure: the planner failed for a canvas that has no
      // rendered node yet (fresh creation). The server deletes the empty
      // canvas, so the client must leave the dead "生成中…" view and return
      // to the gallery rather than spinning forever.
      if (evt.phase === 'plan' && !s.currentHash) {
        s = {
          ...s,
          view: 'gallery',
          canvasId: null,
          topic: null,
          rootHash: null,
          tree: null,
        };
      }
      return s;
    }

    case 'done':
      return dropPending(state, evt.jobId);

    default:
      return state;
  }
}
