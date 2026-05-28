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

export class ImageGenError extends AppError {
  constructor(message, recoverable = true) { super(message, 'image_error', recoverable); }
}

export class TimeoutError extends AppError {
  constructor(message) { super(message, 'timeout', true); }
}
