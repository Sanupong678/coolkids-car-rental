// Typed errors thrown by services. The error middleware maps them to HTTP;
// services never touch `res`.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (message, details) => new AppError(400, "BAD_REQUEST", message, details);
export const Unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
export const Forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);
export const NotFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const Conflict = (code, message, details) => new AppError(409, code, message, details);

// Translate PostgreSQL constraint errors into domain errors so DB-enforced rules
// surface as clean 4xx responses rather than 500s.
const PG = { UNIQUE: "23505", EXCLUSION: "23P01", CHECK: "23514", FK: "23503", RESTRICT: "23001" };

export function fromPgError(err) {
  switch (err.code) {
    case PG.EXCLUSION:
      return Conflict("VEHICLE_UNAVAILABLE", "The vehicle is not available for the selected period");
    case PG.UNIQUE:
      return Conflict("DUPLICATE", "A record with the same unique value already exists", { constraint: err.constraint });
    case PG.CHECK:
      return BadRequest("The request violates a business rule", { constraint: err.constraint });
    case PG.FK:
      return BadRequest("A referenced record does not exist", { constraint: err.constraint });
    case PG.RESTRICT:
      return Conflict("NOT_ALLOWED", err.message);
    default:
      return null;
  }
}
