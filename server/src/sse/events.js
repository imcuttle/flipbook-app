// SSE event type catalog (constants only — payload shape is built inline).
export const SseEvents = Object.freeze({
  PLANNING_STARTED: 'planning_started',
  SEARCH_STARTED: 'search_started',
  SEARCH_DONE: 'search_done',
  PLANNER_DONE: 'planner_done',
  IMAGE_STARTED: 'image_started',
  IMAGE_READY: 'image_ready',
  NODE_READY: 'node_ready',
  TREE_UPDATED: 'tree_updated',
  ERROR: 'error',
  DONE: 'done',
});
