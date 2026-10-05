import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";

export type ManifestEntry = { bucket: string; path: string; size: number; sha256: string; contentType: string | null };
export type Manifest = {
  format: 1;
  createdAt: string;
  source: string;
  buckets: readonly string[];
  objectCount: number;
  totalBytes: number;
  objects: ManifestEntry[];
};

/** A pass-through stream that measures and hashes what flows through it. */
export function hashingStream() {
  const hash = createHash("sha256");
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  return { stream, result: () => ({ size, sha256: hash.digest("hex") }) };
}

export async function hashFile(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest("hex") };
}
