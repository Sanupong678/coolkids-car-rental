import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "../config/env.js";

const PII_KEY = Buffer.from(config.PII_ENCRYPTION_KEY, "base64");
const KEY_VERSION = 1;

/** Opaque random token for cookies (session id, state). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** SHA-256 — used to store session tokens so the DB never holds usable cookies. */
export const sha256 = (value) => createHash("sha256").update(value).digest();

/** Keyed hash for equality lookups on encrypted values (e.g. duplicate licence detection). */
export const hmac = (value) => createHmac("sha256", config.PII_HMAC_KEY).update(normalise(value)).digest();

const normalise = (v) => String(v).replace(/[\s-]/g, "").toUpperCase();

/**
 * AES-256-GCM. Output layout: [version:1][iv:12][tag:16][ciphertext].
 * The version byte allows key rotation without a flag day.
 */
export function encryptPII(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", PII_KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptPII(buf) {
  if (buf[0] !== KEY_VERSION) throw new Error(`Unknown PII key version ${buf[0]}`);
  const decipher = createDecipheriv("aes-256-gcm", PII_KEY, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString("utf8");
}

export const last4 = (value) => normalise(value).slice(-4);
