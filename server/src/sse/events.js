// SSE event type catalog (constants only — payload shape is built inline).
export const SseEvents = Object.freeze({
  PLANNING_STARTED: 'planning_started',
  SEARCH_STARTED: 'search_started',
  SEARCH_DONE: 'search_done',
  PLANNER_DONE: 'planner_done',
  IMAGE_STARTED: 'image_started',
  IMAGE_READY: 'image_ready',
  OCR_DONE: 'ocr_done',
  NODE_READY: 'node_ready',
  // A user-friendly progress line for the pending click bubble. Sent
  // throughout generation (describeSeed / search / planner / image
  // attempts / repair retry) with a `messageKey` (i18n id the client
  // resolves) plus an optional english fallback `messageEn` for clients
  // without a translation. Cheap to ignore by clients that don't care.
  PHASE_MESSAGE: 'phase_message',
  TREE_UPDATED: 'tree_updated',
  // Renamed from 'error' to 'gen_error' so addEventListener('error') in the
  // browser doesn't collide with EventSource's built-in connection-error
  // event (which would otherwise eat or double-fire our payload).
  ERROR: 'gen_error',
  DONE: 'done',
  // The click-label LLM decided the click didn't land on anything drillable.
  // Frontend drops the pending bubble and toasts the reason.
  CLICK_REJECTED: 'click_rejected',
  // A node and its descendants were deleted. Frontend removes them from
  // state.nodes / state.tree.nodes and bumps the gallery cover/count.
  NODE_DELETED: 'node_deleted',
});
