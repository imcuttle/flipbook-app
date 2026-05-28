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

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/canvas/${canvasId}/events`);
      const types = [
        'planning_started', 'planner_done', 'image_started',
        'image_ready', 'node_ready', 'tree_updated', 'error', 'done',
      ];
      for (const t of types) {
        es.addEventListener(t, (e: MessageEvent) => {
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
