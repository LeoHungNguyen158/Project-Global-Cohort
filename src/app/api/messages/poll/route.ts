import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { isValidCursor } from "@/lib/comms/messages";
import { toMessageScope, type MessageScopeRow } from "@/lib/comms/scope";
import { fetchThreadMessages } from "@/lib/comms/queries";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

/**
 * Message polling for the signed-in user only (everything is read with their session,
 * so RLS applies).
 *
 *   GET /api/messages/poll                     -> { unread, serverTime }
 *   GET /api/messages/poll?scopes=1            -> adds per-scope { type, id, unread, threads }
 *   GET /api/messages/poll?thread=<id>&after=<createdAt>
 *                                              -> adds { thread: { id, messages } } with messages
 *                                                 newer than `after` (oldest first, max 100);
 *                                                 without `after`, the latest 50
 *
 * 401 when signed out, 400 for malformed parameters, 404 when the conversation does
 * not exist or the caller is not a participant.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const thread = params.get("thread");
  const after = params.get("after");
  const wantScopes = params.get("scopes") === "1";
  if ((thread !== null && !isUuid(thread)) || (after !== null && !isValidCursor(after)) || (after !== null && thread === null)) {
    return json({ error: "invalid_request" }, 400);
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "unauthenticated" }, 401);

  const [unreadRes, scopesRes] = await Promise.all([
    supabase.rpc("unread_message_count"),
    wantScopes ? supabase.rpc("my_message_scopes") : Promise.resolve(null),
  ]);
  if (unreadRes.error || scopesRes?.error) return json({ error: "unavailable" }, 503);

  const body: Record<string, unknown> = { unread: Number(unreadRes.data ?? 0), serverTime: new Date().toISOString() };
  if (scopesRes) {
    body.scopes = ((scopesRes.data ?? []) as MessageScopeRow[]).map(toMessageScope).map((s) => ({
      type: s.type,
      id: s.id,
      unread: s.unread,
      threads: s.threads,
    }));
  }

  if (thread) {
    const { data: visible } = await supabase.from("threads").select("id").eq("id", thread).maybeSingle();
    if (!visible) return json({ error: "not_found" }, 404);
    try {
      const { messages } = await fetchThreadMessages(supabase, thread, after ? { after, limit: 100 } : { limit: 50 });
      body.thread = { id: thread, messages };
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }
  return json(body);
}
