// Off-site copy of the nightly database dump: reads the .sql.gz from stdin and stores it
// in the PRIVATE R2 bucket under backups/db/, then deletes copies older than KEEP_DAYS.
// Called by deploy/backup-db.sh inside the api container (which already has the R2 keys):
//   docker compose exec -T api node src/scripts/backup-upload.js db-2026-10-25.sql.gz < backups/db-2026-10-25.sql.gz
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/env.js";

const KEEP_DAYS = 30;
const PREFIX = "backups/db/";

const name = process.argv[2];
if (!/^db-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(name ?? "")) {
  console.error("usage: backup-upload.js db-YYYY-MM-DD.sql.gz < file");
  process.exit(1);
}
if (!config.s3Configured) {
  console.error("R2 (S3_*) is not configured: no off-site copy made");
  process.exit(1);
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const body = Buffer.concat(chunks);
// a gzip file starts with 1f 8b; refuse an empty or broken dump rather than overwrite a good copy
if (body.length < 100 || body[0] !== 0x1f || body[1] !== 0x8b) {
  console.error(`refusing to upload: ${name} is not a gzip dump (${body.length} bytes)`);
  process.exit(1);
}

const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
});
const Bucket = config.S3_BUCKET_PRIVATE;

await s3.send(new PutObjectCommand({ Bucket, Key: PREFIX + name, Body: body, ContentType: "application/gzip", CacheControl: "private, no-store" }));

console.log(`uploaded ${PREFIX}${name} (${Math.round(body.length / 1024)} kB) to R2`);

// prune copies older than KEEP_DAYS (by the date in the file name); the upload above already counts
try {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      const day = o.Key.match(/db-(\d{4}-\d{2}-\d{2})\.sql\.gz$/)?.[1];
      if (day && day < cutoff) old.push({ Key: o.Key });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  if (old.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: old } }));
  console.log(`pruned ${old.length} copies older than ${KEEP_DAYS} days`);
} catch (err) {
  console.warn(`could not prune old copies (${err.name}): check the R2 token may list/delete`);
}
