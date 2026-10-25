import { AppError, fromPgError } from "../shared/errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}

// Single place that shapes error responses: { error: { code, message, details? } }.
// Internal error messages are never leaked for 5xx.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const appErr = err instanceof AppError ? err : fromPgError(err);
  if (appErr) {
    return res.status(appErr.status).json({
      error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
    });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
  }
  req.log?.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", requestId: req.id } });
}
