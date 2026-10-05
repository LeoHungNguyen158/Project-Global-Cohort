import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/activity",
  "/courses",
  "/cohorts",
  "/calendar",
  "/messages",
  "/grades",
  "/tools",
  "/profile",
  "/admin",
  "/invite",
];

function buildCsp(nonce: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabaseUrl}`,
    `media-src 'self' blob: ${supabaseUrl}`,
    `connect-src 'self' ${supabaseUrl}`,
    "font-src 'self'",
    `frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com ${supabaseUrl}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when Supabase itself is served over HTTPS: a local production build against the
    // http://127.0.0.1 stack would otherwise have its signed media and PDF links rewritten to
    // https and refused.
    ...(!isDev && supabaseUrl.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let signedIn = false;

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    });
    // Refreshes an expired access token and verifies the JWT. Authorization is still
    // decided per request by the database (RLS) and server code, not by this check.
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  if (!signedIn && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }
  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = signedIn ? "/activity" : "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  if (signedIn) {
    // Never let a shared cache store a personalized response.
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
