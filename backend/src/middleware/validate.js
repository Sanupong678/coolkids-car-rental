import { z } from "zod";
import { BadRequest } from "../shared/errors.js";

/**
 * Validates and replaces req.body / req.query / req.params with parsed values,
 * so controllers only ever see typed, whitelisted input (unknown keys stripped).
 *   router.post("/", validate({ body: schema }), handler)
 */
export const validate = (schemas) => (req, _res, next) => {
  for (const part of ["params", "query", "body"]) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      throw BadRequest("Validation failed", z.flattenError(result.error).fieldErrors);
    }
    // Express 5 exposes req.query as a getter; store parsed values on req.valid.
    req.valid = { ...req.valid, [part]: result.data };
  }
  next();
};
