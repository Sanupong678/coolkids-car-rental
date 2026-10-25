import pino from "pino";
import { config } from "../config/env.js";

export const logger = pino({
  level: config.isTest ? "silent" : config.LOG_LEVEL,
  // Never log credentials, cookies or identity documents.
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]', "*.password", "*.token"],
    censor: "[redacted]",
  },
  ...(config.isProd ? {} : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
});
