// Plain JavaScript (not next.config.ts) so Next.js loads it without compiling it first:
// on hosts where the native SWC binary cannot load (Hostinger's build image has a glibc
// older than 2.29), compiling a TypeScript config through the WASM fallback fails.

// Extra hosts allowed to invoke Server Actions, for deployments behind a reverse proxy
// that does not forward the public host (comma-separated, e.g. "lms.example.org").
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only honored over HTTPS; harmless on local http.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The Docker image (VPS route) builds a self-contained server; managed Node.js
  // hosting uses the default output with `npm run start`.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // Server Actions carry form fields only; files go directly to private storage.
  experimental: {
    serverActions: { bodySizeLimit: "2mb", ...(allowedOrigins.length ? { allowedOrigins } : {}) },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
