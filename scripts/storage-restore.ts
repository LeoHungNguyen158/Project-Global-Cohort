// Upload a storage backup (made by `npm run backup:storage`) into a target project.
//
//   npm run restore:storage -- --from backups/2026-10-05/storage            # checks only
//   npm run restore:storage -- --from backups/2026-10-05/storage --yes      # uploads
//   ... --yes --verify      also downloads each restored file and compares its checksum
//   ... --yes --overwrite   replaces files that already exist in the target
//
// Rehearse in a disposable project or the local stack first. A target with
// APP_ENV=production additionally needs --confirm-production.
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { adminClient, targetDescription } from "./lib/admin-client";
import { argValue, fail, formatSize, guardProduction, hasFlag } from "./lib/cli";
import { BUCKETS, assertSafeObjectPath } from "./lib/storage-walk";
import { hashFile, hashingStream, type Manifest } from "./lib/manifest";

async function main() {
  const from = argValue("--from");
  if (!from) fail("Pass the backup folder: --from <folder> (the one containing manifest.json).");
  const root = resolve(from);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) fail(`No manifest.json in ${root}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (manifest.format !== 1 || !Array.isArray(manifest.objects)) fail("Unrecognized manifest format.");

  const apply = hasFlag("--yes");
  const verify = hasFlag("--verify");
  const overwrite = hasFlag("--overwrite");
  if (apply) guardProduction();
  const sb = adminClient();
  console.log(`Backup:  ${manifest.objectCount} file(s), ${formatSize(manifest.totalBytes)}, made ${manifest.createdAt} from ${manifest.source}`);
  console.log(`Target:  ${targetDescription()}${apply ? "" : "  (check only; add --yes to upload)"}`);

  const { data: buckets, error: bucketError } = await sb.storage.listBuckets();
  if (bucketError) fail(`Could not list buckets in the target: ${bucketError.message}`);
  const missing = BUCKETS.filter((b) => !(buckets ?? []).some((x) => x.id === b));
  if (missing.length > 0) fail(`The target is missing bucket(s) ${missing.join(", ")}. Apply the migrations to it first.`);

  const started = Date.now();
  let uploaded = 0;
  let skipped = 0;
  let verified = 0;
  const failures: string[] = [];

  for (const entry of manifest.objects) {
    const label = `${entry.bucket}/${entry.path}`;
    try {
      if (!(BUCKETS as readonly string[]).includes(entry.bucket)) throw new Error("unknown bucket");
      assertSafeObjectPath(entry.path);
      const file = join(root, entry.bucket, ...entry.path.split("/"));
      if (!existsSync(file)) throw new Error("file missing from the backup folder");
      const local = await hashFile(file);
      if (local.size !== entry.size || local.sha256 !== entry.sha256) throw new Error("backup file does not match its checksum; not uploaded");
      if (!apply) continue;

      const { error } = await sb.storage
        .from(entry.bucket)
        .upload(entry.path, createReadStream(file), { contentType: entry.contentType ?? "application/octet-stream", upsert: overwrite });
      if (error) {
        const exists = /exists|duplicate/i.test(error.message);
        if (!exists) throw new Error(`upload failed: ${error.message}`);
        skipped++;
      } else {
        uploaded++;
      }

      if (verify) {
        const { data: signed, error: signError } = await sb.storage.from(entry.bucket).createSignedUrl(entry.path, 600);
        if (signError || !signed) throw new Error(`could not create a link to verify: ${signError?.message}`);
        const res = await fetch(signed.signedUrl);
        if (!res.ok || !res.body) throw new Error(`verification download failed with HTTP ${res.status}`);
        const hashing = hashingStream();
        const sink = new Writable({ write: (_chunk, _enc, done) => done() });
        await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), hashing.stream, sink);
        const remote = hashing.result();
        if (remote.size !== entry.size || remote.sha256 !== entry.sha256) throw new Error("restored file does not match the manifest checksum");
        verified++;
      }
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!apply) {
    console.log(`\nChecked ${manifest.objects.length - failures.length} of ${manifest.objects.length} backup file(s) against the manifest in ${seconds}s. Nothing uploaded.`);
  } else {
    console.log(`\nUploaded ${uploaded}, already present ${skipped}${verify ? `, verified ${verified} by checksum` : ""}, failed ${failures.length}, in ${seconds}s.`);
    if (skipped > 0 && !overwrite) console.log("Files already present were left as they are (use --overwrite to replace them).");
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) had problems:`);
    for (const f of failures.slice(0, 100)) console.error(`  ${f}`);
    process.exit(1);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
