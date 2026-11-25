/** Error types that map cleanly onto HTTP responses. */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message safe, user-facing message
   * @param {string[]} [details] optional list of validation messages
   */
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  /** @param {string[]} details */
  constructor(details) {
    super(400, 'Invalid request.', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class UpstreamError extends HttpError {
  constructor(message = 'The air-quality service is temporarily unavailable. Please try again shortly.') {
    super(502, message);
    this.name = 'UpstreamError';
  }
}
