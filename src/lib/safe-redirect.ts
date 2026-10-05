/** Accept only same-origin relative paths for post-login redirects (prevents open redirects). */
export function safeNextPath(raw: string | null | undefined, fallback = "/activity"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("\n") || raw.includes("\r")) {
    return fallback;
  }
  try {
    const url = new URL(raw, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
