// Approved embedded video. Authors paste a normal YouTube or Vimeo link; only the
// provider and the video id are stored (never iframe HTML), and the player URL is built
// here from a fixed template. The server never fetches the pasted URL.

export type EmbedProvider = "youtube" | "vimeo";

export const EMBED_PROVIDERS: EmbedProvider[] = ["youtube", "vimeo"];

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{4,12}$/;
/** Same constraint as the lessons.embed_id check in the database. */
const STORED_ID = /^[A-Za-z0-9_-]{4,64}$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

export type EmbedParseResult =
  | { ok: true; provider: EmbedProvider; id: string }
  | { ok: false; reason: "empty" | "not_https" | "invalid_url" | "provider" | "no_id" | "markup" };

export function parseEmbedUrl(input: string): EmbedParseResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (/[<>"']/.test(raw)) return { ok: false, reason: "markup" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password || (url.port && url.port !== "443")) return { ok: false, reason: "invalid_url" };
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return youtube(parts[0]);
  }
  if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === "watch") return youtube(url.searchParams.get("v"));
    if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) return youtube(parts[1]);
    return { ok: false, reason: "no_id" };
  }
  if (VIMEO_HOSTS.has(host)) {
    if (host === "player.vimeo.com") return parts[0] === "video" ? vimeo(parts[1]) : { ok: false, reason: "no_id" };
    // vimeo.com/123456, vimeo.com/channels/name/123456, vimeo.com/groups/name/videos/123456
    const numeric = [...parts].reverse().find((p) => /^[0-9]+$/.test(p));
    return vimeo(numeric);
  }
  return { ok: false, reason: "provider" };
}

function youtube(id: string | null | undefined): EmbedParseResult {
  return id && YOUTUBE_ID.test(id) ? { ok: true, provider: "youtube", id } : { ok: false, reason: "no_id" };
}

function vimeo(id: string | null | undefined): EmbedParseResult {
  return id && VIMEO_ID.test(id) ? { ok: true, provider: "vimeo", id } : { ok: false, reason: "no_id" };
}

/** True only for a provider on the allowlist and an id the database would accept. */
export function isAllowedEmbed(provider: unknown, id: unknown): provider is EmbedProvider {
  if (typeof id !== "string" || !STORED_ID.test(id)) return false;
  if (provider === "youtube") return YOUTUBE_ID.test(id);
  if (provider === "vimeo") return VIMEO_ID.test(id);
  return false;
}

/** Player URL from the fixed templates the Content Security Policy allows as frames. */
export function embedPlayerUrl(provider: EmbedProvider, id: string): string | null {
  if (!isAllowedEmbed(provider, id)) return null;
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`
    : `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1`;
}

/** Canonical watch link, for the "open on the provider's site" fallback. */
export function embedWatchUrl(provider: EmbedProvider, id: string): string | null {
  if (!isAllowedEmbed(provider, id)) return null;
  return provider === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : `https://vimeo.com/${encodeURIComponent(id)}`;
}
