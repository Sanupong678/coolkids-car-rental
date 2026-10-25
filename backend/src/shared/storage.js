import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/env.js";

// File storage behind one interface, so the code never cares where bytes live.
//   public  — car photos, banners: served by the API at /uploads/<key>
//   private — signatures, ID / licence photos, contract PDFs: never public,
//             opened only through short-lived signed URLs or the API
// Driver: "r2" (any S3-compatible store: Cloudflare R2, Backblaze B2, AWS S3)
// when S3_* is configured, otherwise "local" folders. Each media row records
// the provider it was written to, so old local files keep working after a switch.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_DIRS = { public: path.join(ROOT, "uploads"), private: path.join(ROOT, "storage") };
export const SIGNED_URL_TTL_S = 300;

export const driver = config.s3Configured ? "r2" : "local";

let client;
const s3 = () =>
  (client ??= new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
  }));
const bucketOf = (visibility) => (visibility === "private" ? config.S3_BUCKET_PRIVATE : config.S3_BUCKET_PUBLIC);

/** Keys are app-generated, but refuse anything that could escape the storage folder. */
function assertKey(key) {
  if (!/^[a-z0-9][a-z0-9/_.-]{0,200}$/i.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
  return key;
}
const localPath = (visibility, key) => path.join(LOCAL_DIRS[visibility], ...assertKey(key).split("/"));

/** Stores bytes; returns the provider name to record in media.storage_provider. */
export async function put(visibility, key, body, contentType) {
  if (driver === "r2") {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucketOf(visibility),
        Key: assertKey(key),
        Body: body,
        ContentType: contentType,
        CacheControl: visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
      }),
    );
  } else {
    const file = localPath(visibility, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return driver;
}

/** Reads an object (null when missing). `provider` is the media row's storage_provider. */
export async function get(visibility, key, provider = driver) {
  if (provider === "r2") {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: bucketOf(visibility), Key: assertKey(key) }));
      return { body: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType };
    } catch (err) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }
  const body = await readFile(localPath(visibility, key)).catch(() => null);
  return body ? { body, contentType: null } : null;
}

/**
 * A link a browser can open for a few minutes (private files on R2). Local files
 * have no signed URLs; callers stream them through the API instead (null).
 */
export async function signedUrl(key, provider = driver, ttl = SIGNED_URL_TTL_S) {
  if (provider !== "r2") return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: config.S3_BUCKET_PRIVATE, Key: assertKey(key) }), { expiresIn: ttl });
}

export const LOCAL_PUBLIC_DIR = LOCAL_DIRS.public;
