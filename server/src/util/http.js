// Small HTTP helpers so routes stay thin and consistent.

// Wrap an async route handler so thrown errors reach Express' error middleware
// instead of crashing the process or hanging the request.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// A typed error services can throw; the error middleware maps .status → HTTP.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'not found') => new HttpError(404, msg);
