// Find stored files that no longer belong to anything, and uploads that were never finished.
//
//   npm run maintenance:orphans                 # report only (default)
//   npm run maintenance:orphans -- --apply      # delete what the report lists
//
// What it reports:
//   1. Objects in the four private buckets without a matching file record.
//   2. Objects whose record is rejected or deleted (the record stays; the bytes go).
//   3. Uploads still "pending" after 24 hours (never finished in the browser): the object,
//      if any, is deleted and the record is marked rejected.
//   4. Profile photos replaced or removed more than 24 hours ago (no profile uses them):
//      the object is deleted and the record is marked deleted.
// Academic records (submissions, grades, attempts) are never touched; only file bytes and
// unfinished upload records.
import { adminClient, targetDescription } from "./lib/admin-client";
import { fail, formatSize, guardProduction, hasFlag } from "./lib/cli";
import { BUCKETS, walkBucket } from "./lib/storage-walk";

type AssetRow = { id: string; purpose: string; bucket: string; object_path: string; status: string; created_at: string };

const PENDING_GRACE_MS = 24 * 60 * 60 * 1000;

async function loadAssets(sb: ReturnType<typeof adminClient>): Promise<AssetRow[]> {
  const rows: AssetRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from("content_assets")
      .select("id, purpose, bucket, object_path, status, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`Could not read file records: ${error.message}`);
    rows.push(...((data ?? []) as AssetRow[]));
    if (!data || data.length < page) return rows;
  }
}

/** Avatar files a profile currently uses; any other ready avatar was replaced or removed. */
async function avatarsInUse(sb: ReturnType<typeof adminClient>): Promise<Set<string>> {
  const used = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from("profiles").select("avatar_asset_id").not("avatar_asset_id", "is", null).range(from, from + page - 1);
    if (error) throw new Error(`Could not read profiles: ${error.message}`);
    for (const r of data ?? []) used.add(r.avatar_asset_id as string);
    if (!data || data.length < page) return used;
  }
}

async function main() {
  const apply = hasFlag("--apply");
  if (apply) guardProduction();
  const sb = adminClient();
  console.log(`Target project: ${targetDescription()}${apply ? "" : "  (report only; add --apply to delete)"}`);

  const assets = await loadAssets(sb);
  const byKey = new Map(assets.map((a) => [`${a.bucket}/${a.object_path}`, a]));
  const now = Date.now();

  const orphanObjects: { bucket: string; path: string; size: number }[] = [];
  const deadObjects: { bucket: string; path: string; size: number; status: string }[] = [];
  const seen = new Set<string>();
  for (const bucket of BUCKETS) {
    for await (const obj of walkBucket(sb, bucket)) {
      const key = `${bucket}/${obj.path}`;
      seen.add(key);
      const row = byKey.get(key);
      if (!row) orphanObjects.push({ bucket, path: obj.path, size: obj.size ?? 0 });
      else if (row.status === "rejected" || row.status === "deleted") deadObjects.push({ bucket, path: obj.path, size: obj.size ?? 0, status: row.status });
    }
  }
  const abandoned = assets.filter((a) => a.status === "pending" && now - new Date(a.created_at).getTime() > PENDING_GRACE_MS);
  const inUse = await avatarsInUse(sb);
  const oldAvatars = assets.filter(
    (a) => a.purpose === "avatar" && a.status === "ready" && !inUse.has(a.id) && now - new Date(a.created_at).getTime() > PENDING_GRACE_MS,
  );

  const total = (list: { size: number }[]) => formatSize(list.reduce((n, o) => n + o.size, 0));
  console.log(`\nFile records: ${assets.length}`);
  console.log(`Objects without a record:            ${orphanObjects.length} (${total(orphanObjects)})`);
  console.log(`Objects of rejected/deleted records: ${deadObjects.length} (${total(deadObjects)})`);
  console.log(`Uploads pending for over 24 hours:   ${abandoned.length}`);
  console.log(`Replaced or removed profile photos:  ${oldAvatars.length}`);
  for (const o of orphanObjects.slice(0, 50)) console.log(`  orphan   ${o.bucket}/${o.path} (${formatSize(o.size)})`);
  for (const o of deadObjects.slice(0, 50)) console.log(`  ${o.status.padEnd(8)} ${o.bucket}/${o.path} (${formatSize(o.size)})`);
  for (const a of abandoned.slice(0, 50)) console.log(`  pending  ${a.bucket}/${a.object_path} since ${a.created_at}`);
  for (const a of oldAvatars.slice(0, 50)) console.log(`  unused   ${a.bucket}/${a.object_path}`);
  if (orphanObjects.length + deadObjects.length + abandoned.length + oldAvatars.length > 200) console.log("  (lists truncated)");

  if (!apply) return;

  const removeAll = async (bucket: string, paths: string[]) => {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`Could not delete from ${bucket}: ${error.message}`);
    }
  };
  for (const bucket of BUCKETS) {
    const paths = [...orphanObjects, ...deadObjects].filter((o) => o.bucket === bucket).map((o) => o.path);
    if (paths.length > 0) await removeAll(bucket, paths);
  }
  for (const a of abandoned) {
    if (seen.has(`${a.bucket}/${a.object_path}`)) await removeAll(a.bucket, [a.object_path]);
    const { error } = await sb
      .from("content_assets")
      .update({ status: "rejected", rejection_reason: "The upload was not finished within 24 hours." })
      .eq("id", a.id)
      .eq("status", "pending");
    if (error) throw new Error(`Could not update record ${a.id}: ${error.message}`);
  }
  for (const a of oldAvatars) {
    if (seen.has(`${a.bucket}/${a.object_path}`)) await removeAll(a.bucket, [a.object_path]);
    const { error } = await sb.from("content_assets").update({ status: "deleted" }).eq("id", a.id).eq("status", "ready");
    if (error) throw new Error(`Could not update record ${a.id}: ${error.message}`);
  }
  console.log(
    `\nDeleted ${orphanObjects.length + deadObjects.length + oldAvatars.length} object(s); closed ${abandoned.length} unfinished upload(s).`,
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
