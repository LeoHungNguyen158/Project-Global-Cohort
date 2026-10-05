// File signature ("magic byte") checks run on the server after an upload completes.
// A file whose leading bytes do not match its declared type is rejected, so a
// renamed executable or HTML page cannot be stored as a PDF, image or video.

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    // Allow a multi-byte character to be cut at the end of the sample.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.length > 4 ? bytes.subarray(0, bytes.length - 4) : bytes);
    return true;
  } catch {
    return false;
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** Returns true when the leading bytes are consistent with the declared type. */
export function signatureMatches(declaredMime: string, head: Uint8Array): boolean {
  switch (declaredMime) {
    case "application/pdf":
      return startsWith(head, ascii("%PDF-"));
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"));
    case "image/webp":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    case "video/mp4":
      return startsWith(head, ascii("ftyp"), 4);
    case "video/webm":
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case "text/vtt": {
      const body = startsWith(head, UTF8_BOM) ? head.subarray(3) : head;
      return startsWith(body, ascii("WEBVTT")) && looksLikeUtf8Text(body);
    }
    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return looksLikeUtf8Text(head);
    default:
      return false;
  }
}
