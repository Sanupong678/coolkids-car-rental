import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// scrypt (memory-hard, built into Node). Parameters are stored with each hash
// so they can be raised later without invalidating existing passwords.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

// Passwords people pick first. Rejected at sign-up (attackers try these first too).
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "password123", "qwerty123", "qwertyui", "11111111",
  "00000000", "88888888", "abcd1234", "1q2w3e4r", "iloveyou", "admin123", "welcome1", "sunshine", "princess",
  "football", "baseball", "12341234", "87654321", "asdfghjk", "zxcvbnm1", "p@ssw0rd", "passw0rd", "letmein1",
]);

/** Returns an error message for a weak password, or null when it is acceptable. */
export function passwordProblem(password, { email } = {}) {
  const p = String(password);
  if (p.length < 8) return "Password must be at least 8 characters";
  if (COMMON.has(p.toLowerCase()) || /^(.)\1+$/.test(p)) return "This password is too common, please choose another";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && p.toLowerCase().includes(local)) return "Password must not contain your email name";
  return null;
}

// Compared against when the login does not exist, so response time does not
// reveal which usernames are registered.
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));
