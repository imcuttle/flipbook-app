import { useEffect, useRef } from 'react';
import type { SseEvent } from '../state/types';

export function useCanvasSSE(canvasId: string | null, onEvent: (evt: SseEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!canvasId) return;
    let stopped = false;
    let es: EventSource | null = null;
    let retry = 1000;
    // Track the id of the last event we received so a reconnect can ask the
    // server to replay anything we missed during the gap. EventSource can't
    // set the Last-Event-ID *header* when we manually re-create it, so we
    // pass it as a ?lastEventId= query param (the server accepts either).
    let lastEventId: string | null = null;

    const connect = () => {
      if (stopped) return;
      const base = `/api/canvas/${canvasId}/events`;
      const url = lastEventId
        ? `${base}?lastEventId=${encodeURIComponent(lastEventId)}`
        : base;
      es = new EventSource(url);
      // Subscribe to every typed event the server emits. Missing one here
      // silently drops that event on the floor (EventSource only delivers
      // events we explicitly addListener to when the server sends an
      // `event:` field), so keep this list in sync with server/src/sse/events.js.
      const types = [
        'planning_started',
        'search_started', 'search_done',
        'planner_done',
        'image_started', 'image_ready', 'variants_ready',
        'ocr_done',
        'node_ready', 'tree_updated',
        'click_rejected', 'node_deleted',
        'phase_message',
        // 'gen_error' (renamed from 'error' on the server) — addEventListener
        // for 'error' would otherwise collide with EventSource's built-in
        // connection-error event and silently drop our typed payload.
        'gen_error', 'done',
      ];
      for (const t of types) {
        es.addEventListener(t, (e: MessageEvent) => {
          // Remember the server-assigned id (from the frame's `id:` field)
          // so the next reconnect can resume from here.
          if (e.lastEventId) lastEventId = e.lastEventId;
          try {
            const data = JSON.parse(e.data) as SseEvent;
            handlerRef.current(data);
          } catch {
            // ignore malformed frame
          }
        });
      }
      es.onerror = () => {
        es?.close();
        if (stopped) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
      es.onopen = () => { retry = 1000; };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [canvasId]);
}
