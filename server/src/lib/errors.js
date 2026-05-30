export class AppError extends Error {
  constructor(message, code = 'app_error', recoverable = false) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class PlannerError extends AppError {
  constructor(message, recoverable = true) { super(message, 'planner_error', recoverable); }
}

// Specific subclass for "the model returned prose instead of JSON" — almost
// always a content-policy refusal. Carries the prose so the pipeline can
// forward the human-readable reason to the UI as a toast.
export class PlannerRefusalError extends PlannerError {
  constructor(message) {
    super(message, false);
    this.code = 'planner_refusal';
    // Refusals are not retry-recoverable — running it again gets the same
    // refusal and just wastes time/tokens.
  }
}

export class ImageGenError extends AppError {
  constructor(message, recoverable = true) { super(message, 'image_error', recoverable); }
}

export class TimeoutError extends AppError {
  constructor(message) { super(message, 'timeout', true); }
}
