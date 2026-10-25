// Accepts only real JPEG / PNG / WebP bytes: the declared Content-Type must match
// the file's magic number, so a script renamed to .jpg is refused.

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAGIC = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
};
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Returns the file extension for a valid image body, or null. */
export function imageExtension(contentType, body) {
  const ext = IMAGE_TYPES[String(contentType ?? "").split(";")[0].trim()];
  if (!ext || !Buffer.isBuffer(body) || body.length < 16 || body.length > MAX_IMAGE_BYTES) return null;
  return MAGIC[ext](body) ? ext : null;
}
