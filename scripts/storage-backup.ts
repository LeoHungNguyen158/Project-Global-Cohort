// Download every stored file (the four private buckets) with a checksum manifest.
// A database backup does not include these files, so both are needed for recovery.
//
//   npm run backup:storage -- --out backups/2026-10-05/storage
//
// The output contains learners' work and personal files: keep it encrypted, restrict
// access, delete it when the retention period ends, and never commit it.
import { createWriteStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { adminClient, targetDescription } from "./lib/admin-client";
import { argValue, fail, formatSize } from "./lib/cli";
import { BUCKETS, assertSafeObjectPath, walkBucket } from "./lib/storage-walk";
import { hashingStream, type Manifest, type ManifestEntry } from "./lib/manifest";

async function main() {
  const out = argValue("--out");
  if (!out) fail("Pass an output folder: --out <folder> (new or empty).");
  const root = resolve(out);
  if (existsSync(root) && readdirSync(root).length > 0) fail(`${root} is not empty. Choose a new folder for each backup.`);
  mkdirSync(root, { recursive: true });

  const sb = adminClient();
  const source = targetDescription();
  console.log(`Source project: ${source}\nWriting to:     ${root}`);
  const started = Date.now();
  const objects: ManifestEntry[] = [];
  const failures: string[] = [];

  for (const bucket of BUCKETS) {
    let count = 0;
    for await (const obj of walkBucket(sb, bucket)) {
      try {
        assertSafeObjectPath(obj.path);
        const { data: signed, error } = await sb.storage.from(bucket).createSignedUrl(obj.path, 600);
        if (error || !signed) throw new Error(error?.message ?? "no signed URL");
        const res = await fetch(signed.signedUrl);
        if (!res.ok || !res.body) throw new Error(`download failed with HTTP ${res.status}`);
        const dest = join(root, bucket, ...obj.path.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        const hashing = hashingStream();
        await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), hashing.stream, createWriteStream(dest, { flags: "wx", mode: 0o600 }));
        const { size, sha256 } = hashing.result();
        if (obj.size !== null && obj.size !== size) throw new Error(`size mismatch: listed ${obj.size}, downloaded ${size}`);
        objects.push({ bucket, path: obj.path, size, sha256, contentType: obj.contentType });
        count++;
      } catch (err) {
        failures.push(`${bucket}/${obj.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`  ${bucket}: ${count} file(s)`);
  }

  const manifest: Manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    source,
    buckets: BUCKETS,
    objectCount: objects.length,
    totalBytes: objects.reduce((n, o) => n + o.size, 0),
    objects,
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nSaved ${manifest.objectCount} file(s), ${formatSize(manifest.totalBytes)}, in ${seconds}s. Manifest: ${join(root, "manifest.json")}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) could not be saved:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
