import type { SupabaseClient } from "@supabase/supabase-js";

/** The private buckets created by the migrations. */
export const BUCKETS = ["course-content", "submissions", "message-attachments", "avatars"] as const;

export type StoredObject = { bucket: string; path: string; size: number | null; contentType: string | null; updatedAt: string | null };

/** Every object in a bucket, depth first. Folders are virtual in Storage and are listed with a null id. */
export async function* walkBucket(sb: SupabaseClient, bucket: string, prefix = ""): AsyncGenerator<StoredObject> {
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      if (item.name === ".emptyFolderPlaceholder") continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        yield* walkBucket(sb, bucket, path);
      } else {
        const meta = (item.metadata ?? {}) as { size?: number; mimetype?: string };
        yield { bucket, path, size: typeof meta.size === "number" ? meta.size : null, contentType: meta.mimetype ?? null, updatedAt: item.updated_at ?? null };
      }
    }
    if (!data || data.length < pageSize) return;
  }
}

/** Object paths become file paths in a backup folder; refuse anything that could escape it. */
export function assertSafeObjectPath(path: string): void {
  if (!path || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`Unsafe object path: ${JSON.stringify(path)}`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") throw new Error(`Unsafe object path: ${JSON.stringify(path)}`);
  }
}
