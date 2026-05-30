import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import styles from './styles/App.module.css';
import { reducer } from './state/reducer';
import { initialState } from './state/types';
import type { SseEvent } from './state/types';
import { TopBar } from './components/TopBar';
import { Canvas } from './components/Canvas';
import { ToastStack } from './components/Toast';
import { Gallery } from './components/Gallery';
import { ConfirmModal } from './components/ConfirmModal';
import { ClickComposer } from './components/ClickComposer';
import { useCanvasSSE } from './hooks/useCanvasSSE';
import { createCanvas, clickAt, getNode, getTree, createShareLink, resolveShareLink, deleteNode, regenerateNode } from './lib/api';
import { useLang, t, displayTopic } from './lib/i18n';
import { revokeSelection, type ImageSelection } from './lib/imageUpload';

function readUrlState() {
  const url = new URL(window.location.href);
  return {
    canvasId: url.searchParams.get('c'),
    nodeHash: url.searchParams.get('n'),
    mode: url.searchParams.get('mode'),
    legacyShareToken: url.searchParams.get('s'),
  };
}

function writeUrlState({ canvasId, nodeHash, preview }: {
  canvasId: string | null;
  nodeHash: string | null;
  preview: boolean;
}) {
  const url = new URL(window.location.href);
  if (canvasId) url.searchParams.set('c', canvasId);
  else url.searchParams.delete('c');
  if (nodeHash) url.searchParams.set('n', nodeHash);
  else url.searchParams.delete('n');
  if (preview) url.searchParams.set('mode', 'preview');
  else url.searchParams.delete('mode');
  // Drop legacy share token if present
  url.searchParams.delete('s');
  window.history.replaceState({}, '', url.toString());
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [draftTopic, setDraftTopic] = useState('');
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  // Image attached to the gallery topic input (used for image-seeded
  // canvas creation). Cleared on successful submit or via the X button.
  const [topicAttachment, setTopicAttachment] = useState<ImageSelection | null>(null);
  // Local "POST in flight" flag. Spans the gap between the user clicking
  // Generate and the server's createCanvas response — `state.status.busy`
  // flips on later (after the first SSE event), so without this guard
  // double-clicking Generate during multipart upload would fire multiple
  // POSTs.
  const [submitting, setSubmitting] = useState(false);
  // Whether long-press should open the floating compose panel (default ON)
  // or fire generate immediately (legacy behaviour).
  const [composeOnClick, setComposeOnClick] = useState(true);
  // Pending click-composer state. When non-null the floating panel is open
  // anchored at this image-relative xy, capturing label + image attachment.
  const [clickComposer, setClickComposer] = useState<{ xy: [number, number] } | null>(null);
  // Latest imageRect reported by the Canvas (in % of stage). Lets us
  // convert image-relative xy into stage-relative xy for the composer.
  const [canvasImageRect, setCanvasImageRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [lang] = useLang();
  // True once boot URL has been parsed and any hydrate dispatched; before this
  // we MUST NOT write to the URL or we'll erase the params we're about to read.
  const bootedRef = useRef(false);

  const handleSseEvent = useCallback((evt: SseEvent) => {
    dispatch({ type: 'sse', evt });
  }, []);

  useCanvasSSE(state.canvasId, handleSseEvent);

  // Boot: parse URL → restore state. Precedence: legacy ?s=<token> still works
  // for old links; otherwise ?c=<id>&n=<hash>&mode=preview drives the view.
  useEffect(() => {
    const u = readUrlState();
    const isPreview = u.mode === 'preview';

    if (u.legacyShareToken) {
      (async () => {
        try {
          const link = await resolveShareLink(u.legacyShareToken!);
          dispatch({ type: 'set_share_mode', canvasId: link.canvasId, topic: link.topic, token: u.legacyShareToken! });
          await hydrateCanvas(link.canvasId, u.nodeHash);
          // Migrate URL: drop ?s=, write ?c&mode=preview
          writeUrlState({ canvasId: link.canvasId, nodeHash: u.nodeHash, preview: true });
        } catch (e) {
          dispatch({ type: 'add_toast', toast: { level: 'error', message: `Bad share link: ${(e as Error).message}` } });
          dispatch({ type: 'set_view', view: 'gallery' });
        } finally {
          bootedRef.current = true;
        }
      })();
      return;
    }

    if (u.canvasId) {
      if (isPreview) {
        // Preview-mode boot: hydrate then mark read-only
        (async () => {
          try {
            const tree = await getTree(u.canvasId!);
            dispatch({ type: 'set_share_mode', canvasId: u.canvasId!, topic: tree.topic, token: u.canvasId! });
            dispatch({ type: 'set_tree', tree });
            const targetHash = u.nodeHash || tree.root;
            if (targetHash) {
              const node = await getNode(u.canvasId!, targetHash);
              // Pre-fetch ancestors so breadcrumb works
              for (const p of (node.path ?? []).slice(0, -1)) {
                try {
                  const a = await getNode(u.canvasId!, p.hash);
                  dispatch({ type: 'sse', evt: { type: 'node_ready', canvasId: u.canvasId!, jobId: 'hydrate-anc', hash: a.hash, node: a } });
                } catch { /* ignore */ }
              }
              dispatch({ type: 'sse', evt: { type: 'node_ready', canvasId: u.canvasId!, jobId: 'hydrate', hash: node.hash, node } });
              // Explicit navigate — covers deep-link to non-root node
              dispatch({ type: 'navigate', hash: node.hash });
            }
          } catch (e) {
            dispatch({ type: 'add_toast', toast: { level: 'warn', message: `Preview load failed: ${(e as Error).message}` } });
            dispatch({ type: 'set_view', view: 'gallery' });
          } finally {
            bootedRef.current = true;
          }
        })();
      } else {
        hydrateCanvas(u.canvasId, u.nodeHash).finally(() => { bootedRef.current = true; });
      }
    } else {
      // Nothing to hydrate; we're on a fresh gallery view, allow URL writes.
      bootedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist canvasId / current node / preview mode to URL whenever they change.
  // Three guards:
  //   (1) bootedRef — never write URL until boot has finished reading it; otherwise
  //       the initial gallery-view render would clobber ?c/?n/?mode params we
  //       were just about to load.
  //   (2) Don't strip an existing ?n= during hydrate. If the URL already has
  //       n=<hash> but state.currentHash hasn't caught up yet (mid-hydrate),
  //       skip — but ONLY in that scenario. New-canvas creation also has
  //       currentHash=null transiently and we DO want to write ?c there.
  //   (3) Gallery view: clear all canvas params.
  useEffect(() => {
    if (!bootedRef.current) return;
    if (state.view === 'gallery') {
      writeUrlState({ canvasId: null, nodeHash: null, preview: false });
      return;
    }
    if (state.canvasId && !state.currentHash) {
      // Decide: hydrate-in-progress, or new-canvas creation?
      // Read the live URL — if it already has ?n for a canvas that matches
      // ours, we're hydrating and should not overwrite. Otherwise (new canvas
      // or canvas switch via gallery), write ?c immediately so the user can
      // refresh / share even before the root node finishes generating.
      const live = readUrlState();
      const hydrating =
        live.canvasId === state.canvasId && !!live.nodeHash;
      if (hydrating) return;
    }
    writeUrlState({
      canvasId: state.canvasId,
      nodeHash: state.currentHash,
      preview: state.readOnly,
    });
  }, [state.view, state.canvasId, state.currentHash, state.readOnly]);

  // Listen to native fullscreen change (e.g. user pressing Esc)
  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement;
      dispatch({ type: 'set_fullscreen', on: fs });
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const hydrateCanvas = async (id: string, targetHash: string | null = null) => {
    try {
      const tree = await getTree(id);
      dispatch({ type: 'canvas_created', canvasId: id, topic: tree.topic });
      dispatch({ type: 'set_tree', tree });
      const hashToLoad = targetHash || tree.root;
      if (hashToLoad) {
        const node = await getNode(id, hashToLoad);
        // First inject the node into state via node_ready (handles root path)
        dispatch({ type: 'sse', evt: { type: 'node_ready', canvasId: id, jobId: 'hydrate', hash: node.hash, node } });
        // Explicitly navigate — covers the deep-link case where the node has a
        // parent and node_ready's auto-navigate guard wouldn't fire because
        // currentHash is null. If we land on a non-root node, also walk up to
        // hydrate ancestors so the breadcrumb in TopBar works.
        if (node.parent && tree.nodes) {
          await hydrateAncestors(id, node, tree);
        }
        dispatch({ type: 'navigate', hash: node.hash });
      }
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'warn', message: `Failed to load canvas: ${(e as Error).message}` } });
      dispatch({ type: 'set_view', view: 'gallery' });
    }
  };

  // Pre-fetch ancestor node JSONs so the in-bar breadcrumb chips are clickable
  // immediately on a deep-link load. Cheap: just walks node.path array.
  const hydrateAncestors = async (id: string, node: { path: { hash: string }[] }, _tree: unknown) => {
    const path = node.path ?? [];
    // Fetch all ancestors in parallel; ignore failures (gallery still works).
    await Promise.all(
      path.slice(0, -1).map(async (p) => {
        try {
          const a = await getNode(id, p.hash);
          dispatch({ type: 'sse', evt: { type: 'node_ready', canvasId: id, jobId: 'hydrate-anc', hash: a.hash, node: a } });
        } catch { /* ignore */ }
      }),
    );
  };

  const onSubmitTopic = useCallback(async () => {
    const topic = draftTopic.trim();
    // Either a topic, an attached image, or both — server will accept any.
    if (!topic && !topicAttachment) return;
    if (state.readOnly) return;
    if (submitting) return; // dedupe: POST already in flight
    setSubmitting(true);
    try {
      const { canvasId } = await createCanvas(topic, {
        webSearch: state.webSearch,
        image: topicAttachment?.file ?? null,
      });
      // Sync the in-memory topic to whatever the server stored. When only
      // an image was uploaded, the server uses '__pending__' as a sentinel
      // until the planner produces a real title — we keep that sentinel in
      // state so displayTopic() shows the localised "Content generating…"
      // placeholder rather than the file's name.
      dispatch({
        type: 'canvas_created',
        canvasId,
        topic: topic || '__pending__',
      });
      setDraftTopic('');
      revokeSelection(topicAttachment);
      setTopicAttachment(null);
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Create failed: ${(e as Error).message}` } });
    } finally {
      setSubmitting(false);
    }
  }, [draftTopic, state.readOnly, state.webSearch, topicAttachment, submitting]);

  const onImageClick = useCallback(async (xy: [number, number]) => {
    if (state.readOnly) return;
    if (!state.canvasId || !state.currentHash) return;
    // Compose-on-click ON: open the floating panel and let the user add
    // an optional label / image attachment before submitting.
    // Compose-on-click OFF: legacy behaviour — fire the click immediately.
    if (composeOnClick) {
      setClickComposer({ xy });
      return;
    }
    try {
      const r = await clickAt(state.canvasId, state.currentHash, xy[0], xy[1], { webSearch: state.webSearch });
      dispatch({
        type: 'click_pending_local',
        jobId: r.jobId,
        parentHash: state.currentHash,
        clickXY: xy,
      });
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Click failed: ${(e as Error).message}` } });
    }
  }, [state.canvasId, state.currentHash, state.readOnly, state.webSearch, composeOnClick]);

  // Submit handler for the floating click composer panel.
  const submitClickComposer = useCallback(async (
    xy: [number, number],
    label: string,
    image: ImageSelection | null,
  ) => {
    if (state.readOnly || !state.canvasId || !state.currentHash) return;
    try {
      const r = await clickAt(state.canvasId, state.currentHash, xy[0], xy[1], {
        webSearch: state.webSearch,
        label: label || null,
        image: image?.file ?? null,
      });
      dispatch({
        type: 'click_pending_local',
        jobId: r.jobId,
        parentHash: state.currentHash,
        clickXY: xy,
      });
      revokeSelection(image);
      setClickComposer(null);
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Click failed: ${(e as Error).message}` } });
    }
  }, [state.canvasId, state.currentHash, state.readOnly, state.webSearch]);

  const cancelClickComposer = useCallback(() => {
    setClickComposer(null);
  }, []);

  const onHotspotClick = useCallback((index: number) => {
    if (!state.currentHash || !state.canvasId) return;
    const node = state.nodes[state.currentHash];
    if (!node) return;
    const hot = node.hotspots[index];
    if (!hot) return;
    if (hot.next_hash) {
      const nh = hot.next_hash;
      if (state.nodes[nh]) {
        dispatch({ type: 'navigate', hash: nh });
      } else {
        getNode(state.canvasId, nh)
          .then((child) => {
            dispatch({
              type: 'sse',
              evt: { type: 'node_ready', canvasId: state.canvasId!, jobId: 'cache', hash: child.hash, node: child },
            });
            // Same reason as onJumpBreadcrumb: node_ready only auto-navigates
            // when child.parent === state.currentHash AND no other clicks
            // are pending, so we explicitly navigate after register.
            dispatch({ type: 'navigate', hash: child.hash });
          })
          .catch((e) => dispatch({
            type: 'add_toast',
            toast: { level: 'warn', message: `Load failed: ${(e as Error).message}` },
          }));
      }
    }
  }, [state.canvasId, state.currentHash, state.nodes]);

  // --- Delete confirmation modal state. We stage which hotspot the user
  // wants to delete here; the modal reads it and on confirm calls the API.
  const [deleteTarget, setDeleteTarget] = useState<{ hash: string; label: string; descendantCount: number } | null>(null);
  // Regenerate confirmation modal — single boolean is enough since the
  // target is always state.currentHash at click time.
  const [regenTarget, setRegenTarget] = useState<{ hash: string; title: string; descendantCount: number } | null>(null);

  const onHotspotDelete = useCallback((index: number) => {
    if (state.readOnly) return;
    if (!state.currentHash || !state.canvasId) return;
    const node = state.nodes[state.currentHash];
    const hot = node?.hotspots?.[index];
    if (!hot?.next_hash) return;
    const childHash = hot.next_hash;
    // Count descendants under this hash from tree.nodes for the confirm
    // body. Walk children iteratively.
    let descendantCount = 1;
    const treeNodes = state.tree?.nodes;
    if (treeNodes) {
      const seen = new Set<string>();
      const queue: string[] = [childHash];
      while (queue.length) {
        const h = queue.shift()!;
        if (seen.has(h)) continue;
        seen.add(h);
        const tn = treeNodes[h];
        if (tn?.children) for (const c of tn.children) if (!seen.has(c)) queue.push(c);
      }
      descendantCount = seen.size;
    }
    setDeleteTarget({ hash: childHash, label: hot.label, descendantCount });
  }, [state.canvasId, state.currentHash, state.nodes, state.readOnly, state.tree]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || !state.canvasId) {
      setDeleteTarget(null);
      return;
    }
    const { hash, label } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteNode(state.canvasId, hash);
      // Server will broadcast node_deleted; the reducer prunes state. We
      // also surface a toast for explicit user feedback.
      dispatch({ type: 'add_toast', toast: { level: 'info', message: `Deleted: ${label} · 已删除` } });
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Delete failed: ${(e as Error).message}` } });
    }
  }, [deleteTarget, state.canvasId]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  // Open the Regenerate confirm modal for the currently-displayed node.
  // We pre-count descendants from state.tree so the modal body can warn
  // the user how much will be wiped.
  const onRegenerate = useCallback(() => {
    if (state.readOnly) return;
    if (!state.canvasId || !state.currentHash) return;
    const node = state.nodes[state.currentHash];
    if (!node) return;
    const treeNodes = state.tree?.nodes;
    let descendantCount = 0;
    if (treeNodes) {
      const seen = new Set<string>();
      // Count children only — not the node itself (it stays in place,
      // server will re-roll its content).
      const queue: string[] = [...(treeNodes[node.hash]?.children ?? [])];
      while (queue.length) {
        const h = queue.shift()!;
        if (seen.has(h)) continue;
        seen.add(h);
        const tn = treeNodes[h];
        if (tn?.children) for (const c of tn.children) if (!seen.has(c)) queue.push(c);
      }
      descendantCount = seen.size;
    }
    setRegenTarget({ hash: node.hash, title: node.title, descendantCount });
  }, [state.canvasId, state.currentHash, state.nodes, state.readOnly, state.tree]);

  const confirmRegenerate = useCallback(async () => {
    if (!regenTarget || !state.canvasId) {
      setRegenTarget(null);
      return;
    }
    const { hash, title } = regenTarget;
    setRegenTarget(null);
    try {
      // Pass the current toggle state — webSearch for the regen pass is
      // the user's CURRENT intent, not whatever was persisted on the
      // node from its original generation.
      await regenerateNode(state.canvasId, hash, { webSearch: state.webSearch });
      dispatch({ type: 'add_toast', toast: { level: 'info', message: `${title} · ${t('toast.regenerating', lang)}` } });
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Regenerate failed: ${(e as Error).message}` } });
    }
  }, [regenTarget, state.canvasId, state.webSearch, lang]);

  const cancelRegenerate = useCallback(() => setRegenTarget(null), []);

  const onJumpBreadcrumb = useCallback((hash: string) => {
    if (state.nodes[hash]) {
      dispatch({ type: 'navigate', hash });
    } else if (state.canvasId) {
      // Fetch first, then dispatch BOTH node_ready (to register the node in
      // state.nodes) AND navigate (to switch to it). node_ready alone would
      // only auto-navigate when node.parent === state.currentHash, which is
      // false for cross-branch ancestor jumps from the catalog popover —
      // without the explicit navigate, the first click silently no-ops and
      // only the second click (now cache-hit) works.
      getNode(state.canvasId, hash).then((n) => {
        dispatch({ type: 'sse', evt: { type: 'node_ready', canvasId: state.canvasId!, jobId: 'jump', hash: n.hash, node: n } });
        dispatch({ type: 'navigate', hash: n.hash });
      });
    }
  }, [state.canvasId, state.nodes]);

  const onBackToGallery = useCallback(() => {
    setGalleryRefreshKey((k) => k + 1);
    dispatch({ type: 'set_view', view: 'gallery' });
  }, []);

  const onOpenFromGallery = useCallback((id: string) => {
    if (id === state.canvasId) {
      dispatch({ type: 'set_view', view: 'canvas' });
      return;
    }
    dispatch({ type: 'reset' });
    dispatch({ type: 'set_view', view: 'canvas' });
    hydrateCanvas(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.canvasId]);

  const onShare = useCallback(async () => {
    if (!state.canvasId) return;
    // The new model: a share link is just the canvas URL with mode=preview.
    // No server token is needed — the canvasId itself is the access proof
    // (same as the unshared link, but the URL parameter flips the UI to
    // read-only). We still call createShareLink so the existence is logged
    // server-side for future analytics; the token isn't used in the URL.
    try {
      // Best-effort: register the share for server-side bookkeeping.
      try { await createShareLink(state.canvasId); } catch { /* ignore */ }
      const url = new URL(window.location.origin);
      url.searchParams.set('c', state.canvasId);
      if (state.currentHash) url.searchParams.set('n', state.currentHash);
      url.searchParams.set('mode', 'preview');
      const fullUrl = url.toString();
      try {
        await navigator.clipboard.writeText(fullUrl);
        dispatch({ type: 'add_toast', toast: { level: 'info', message: `Share link copied: ${fullUrl}` } });
      } catch {
        dispatch({ type: 'add_toast', toast: { level: 'info', message: `Share link: ${fullUrl}` } });
      }
    } catch (e) {
      dispatch({ type: 'add_toast', toast: { level: 'error', message: `Share failed: ${(e as Error).message}` } });
    }
  }, [state.canvasId, state.currentHash]);

  const onToggleFullscreen = useCallback(() => {
    const next = !state.fullscreen;
    if (next) {
      document.documentElement.requestFullscreen?.().catch(() => {
        // Some browsers (iOS Safari) don't support fullscreen API; fall back to CSS-only fullscreen flag.
        dispatch({ type: 'set_fullscreen', on: true });
      });
      dispatch({ type: 'set_fullscreen', on: true });
    } else {
      document.exitFullscreen?.().catch(() => {});
      dispatch({ type: 'set_fullscreen', on: false });
    }
  }, [state.fullscreen]);

  const onToggleChrome = useCallback(() => {
    dispatch({ type: 'toggle_chrome' });
  }, []);

  const onToggleLabels = useCallback(() => {
    dispatch({ type: 'toggle_labels' });
  }, []);

  const onToggleWebSearch = useCallback(() => {
    dispatch({ type: 'toggle_web_search' });
  }, []);

  const currentNode = state.currentHash ? state.nodes[state.currentHash] : null;
  // `busy` covers two distinct in-flight states:
  //   1. `submitting` — local POST hasn't returned yet (the multipart
  //      upload is still streaming over the wire).
  //   2. status.phase planning/image_loading — server has accepted the
  //      job and the SSE pipeline is mid-generation.
  // Either should disable the Generate button so the user can't fire a
  // duplicate submission.
  const busy = submitting
    || state.status.phase === 'planning'
    || state.status.phase === 'image_loading';
  const imageLoadingForCurrent =
    state.status.phase === 'image_loading' && state.status.hash === currentNode?.hash;

  // Decide scene-transition mode for the current node based on previous one.
  // We only emit a transition class on the FIRST render where currentHash flips
  // — subsequent re-renders for the same node keep enterMode='none' so SSE
  // events / image loads don't replay the entrance animation.
  const prevHashRef = useRef<string | null>(null);
  const animatedHashRef = useRef<string | null>(null);
  let enterMode: 'drill' | 'up' | 'fade' | 'none' = 'none';
  let originXY: [number, number] | undefined;
  if (currentNode && animatedHashRef.current !== currentNode.hash) {
    const prev = prevHashRef.current;
    if (!prev) {
      enterMode = 'fade';
    } else if (prev !== currentNode.hash) {
      if (currentNode.parent === prev) {
        enterMode = 'drill';
        if (state.lastDrillFrom?.parentHash === prev) originXY = state.lastDrillFrom.xy;
      } else if (state.nodes[prev]?.parent === currentNode.hash) {
        enterMode = 'up';
      } else {
        enterMode = 'fade';
      }
    }
  }

  // After render, mark the current hash as animated so we won't re-apply the
  // transition class on subsequent re-renders for the same node.
  useEffect(() => {
    if (currentNode) {
      animatedHashRef.current = currentNode.hash;
      prevHashRef.current = currentNode.hash;
      if (state.lastDrillFrom) {
        const t = setTimeout(() => dispatch({ type: 'consume_drill_origin' }), 600);
        return () => clearTimeout(t);
      }
    }
  }, [currentNode?.hash, state.lastDrillFrom]);

  // Filter pending clicks down to those whose parent === current node
  const pendingForNode = currentNode
    ? (state.pendingByParent[currentNode.hash] ?? [])
        .map((id) => state.pendingClicks[id])
        .filter(Boolean)
    : [];

  const showChromeOrNotFullscreen = !state.fullscreen || state.showChrome;

  return (
    <div className={`${styles.shell} ${state.fullscreen ? styles.fullscreen : ''}`}>
      <div className={styles.window}>
        <TopBar
          view={state.view}
          topic={state.topic}
          currentNode={currentNode}
          draftTopic={draftTopic}
          onDraftTopicChange={setDraftTopic}
          onSubmitTopic={onSubmitTopic}
          onBackToGallery={onBackToGallery}
          onJumpBreadcrumb={onJumpBreadcrumb}
          onShare={onShare}
          onToggleFullscreen={onToggleFullscreen}
          onToggleChrome={onToggleChrome}
          onToggleLabels={onToggleLabels}
          onToggleWebSearch={onToggleWebSearch}
          onToggleComposeOnClick={() => setComposeOnClick((v) => !v)}
          onRegenerate={onRegenerate}
          attachment={topicAttachment}
          onAttachmentChange={(sel) => {
            // Revoke the previous preview URL when replacing.
            if (topicAttachment && topicAttachment !== sel) revokeSelection(topicAttachment);
            setTopicAttachment(sel);
          }}
          fullscreen={state.fullscreen}
          showChrome={state.showChrome}
          showLabels={state.showLabels}
          webSearch={state.webSearch}
          composeOnClick={composeOnClick}
          readOnly={state.readOnly}
          busy={busy}
        />
        <div className={styles.canvas}>
          {state.view === 'gallery' && (
            <Gallery refreshKey={galleryRefreshKey} onOpen={onOpenFromGallery} />
          )}

          {state.view === 'canvas' && state.canvasId && !currentNode && (
            <div className={styles.empty}>
              <p>{busy ? t('canvas.loading', lang) : t('canvas.loading.short', lang)}</p>
            </div>
          )}

          {state.view === 'canvas' && currentNode && (
            <Canvas
              key={currentNode.hash}
              canvasId={state.canvasId!}
              node={currentNode}
              tree={state.tree}
              imageLoading={imageLoadingForCurrent}
              pendingClicks={pendingForNode}
              readOnly={state.readOnly}
              showChrome={showChromeOrNotFullscreen}
              showLabels={state.showLabels}
              fullscreen={state.fullscreen}
              enterMode={enterMode}
              originXY={originXY}
              onImageClick={onImageClick}
              onHotspotClick={onHotspotClick}
              onHotspotDelete={onHotspotDelete}
              onJumpToHash={onJumpBreadcrumb}
              onImageRectChange={setCanvasImageRect}
              overlay={clickComposer && (() => {
                // image-relative xy → stage-relative for placement.
                const ir = canvasImageRect ?? { left: 0, top: 0, width: 100, height: 100 };
                const sx = (ir.left + clickComposer.xy[0] * ir.width) / 100;
                const sy = (ir.top + clickComposer.xy[1] * ir.height) / 100;
                return (
                  <ClickComposer
                    xy={clickComposer.xy}
                    stageXY={[sx, sy]}
                    onSubmit={(label, image) => submitClickComposer(clickComposer.xy, label, image)}
                    onCancel={cancelClickComposer}
                  />
                );
              })()}
            />
          )}
        </div>
      </div>

      <ToastStack
        toasts={state.toasts}
        onDismiss={(id) => dispatch({ type: 'remove_toast', id })}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title={t('confirm.delete.title', lang)}
        body={deleteTarget
          ? lang === 'zh'
            ? `这将永久删除「${displayTopic(deleteTarget.label, lang)}」及其下的 ${deleteTarget.descendantCount} 张画布(含子孙画布和图片),无法恢复。`
            : `«${displayTopic(deleteTarget.label, lang)}» will be deleted along with ${deleteTarget.descendantCount} node${deleteTarget.descendantCount === 1 ? '' : 's'} (including its descendants and images). This cannot be undone.`
          : ''}
        confirmLabel={t('confirm.delete.confirm', lang)}
        cancelLabel={t('confirm.delete.cancel', lang)}
        destructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      <ConfirmModal
        open={!!regenTarget}
        title={t('confirm.regen.title', lang)}
        body={regenTarget
          ? lang === 'zh'
            ? `「${displayTopic(regenTarget.title, lang)}」将被重新生成,并清除其下 ${regenTarget.descendantCount} 张子画布(含子孙画布和图片),无法恢复。`
            : `«${displayTopic(regenTarget.title, lang)}» will be regenerated, and ${regenTarget.descendantCount} descendant node${regenTarget.descendantCount === 1 ? '' : 's'} (with images) will be wiped. This cannot be undone.`
          : ''}
        confirmLabel={t('confirm.regen.confirm', lang)}
        cancelLabel={t('confirm.regen.cancel', lang)}
        destructive
        onConfirm={confirmRegenerate}
        onCancel={cancelRegenerate}
      />
    </div>
  );
}
