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

// Send a binary artifact as a file download. Uses RFC 5987 `filename*` so
// non-ASCII (e.g. Traditional Chinese) filenames survive intact, with an ASCII
// `filename` fallback for older clients.
export function sendDownload(res, { buffer, filename, mime }) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', mime);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}
