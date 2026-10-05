import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { scopeKey, toMessageScope, type MessageScope, type MessageScopeRow, type ScopeRef } from "./scope";
import { sortRecipients, toRecipientRole, type Recipient } from "./recipients";
import type { MessageAttachment, ThreadMessage } from "./messages";
import { t } from "@/i18n";

// Data loading for the comms area. Every query runs as the signed-in user, so RLS and
// the RPCs' own checks decide what comes back; nothing here widens access.

export class DataError extends Error {}

/** Courses and cohorts where the viewer may send messages, with unread counts. */
export const loadMessageScopes = cache(async (): Promise<MessageScope[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_message_scopes");
  if (error) throw new DataError("Could not load message scopes");
  return ((data ?? []) as MessageScopeRow[]).map(toMessageScope);
});

/** Unread messages across all of the viewer's conversations (same number as the navigation badge). */
export async function loadUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_message_count");
  if (error) throw new DataError("Could not load unread messages");
  return Number(data ?? 0);
}

export type ThreadSummary = {
  id: string;
  subject: string;
  lastMessageAt: string;
  unread: number;
  participantNames: string[];
  participantCount: number;
  lastSender: string | null;
  preview: string | null;
};

type MyThreadRow = {
  thread_id: string;
  subject: string;
  last_message_at: string;
  unread: number | null;
  participant_names: string[] | null;
  last_sender: string | null;
  preview: string | null;
};

/** The viewer's conversations in one scope, newest activity first (at most 200). */
export async function loadScopeThreads(scope: ScopeRef): Promise<ThreadSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_threads", {
    p_offering: scope.type === "offering" ? scope.id : null,
    p_cohort: scope.type === "cohort" ? scope.id : null,
  });
  if (error) throw new DataError("Could not load conversations");
  return ((data ?? []) as MyThreadRow[]).map((r) => ({
    id: r.thread_id,
    subject: r.subject,
    lastMessageAt: r.last_message_at,
    unread: Number(r.unread ?? 0),
    participantNames: r.participant_names ?? [],
    participantCount: (r.participant_names ?? []).length,
    lastSender: r.last_sender,
    preview: r.preview,
  }));
}

/** Number of other participants per conversation (my_threads lists at most six names). */
export async function loadOtherParticipantCounts(threadIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (threadIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase.from("threads").select("id, thread_participants(count)").in("id", threadIds);
  for (const row of (data ?? []) as { id: string; thread_participants: { count: number }[] }[]) {
    out.set(row.id, Math.max(Number(row.thread_participants?.[0]?.count ?? 1) - 1, 0));
  }
  return out;
}

/** Scopes of every conversation the viewer belongs to (to list read-only ones). */
export async function loadMyThreadScopes(): Promise<ScopeRef[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("threads").select("offering_id, cohort_id").limit(2000);
  const seen = new Map<string, ScopeRef>();
  for (const r of (data ?? []) as { offering_id: string | null; cohort_id: string | null }[]) {
    const ref: ScopeRef | null = r.offering_id ? { type: "offering", id: r.offering_id } : r.cohort_id ? { type: "cohort", id: r.cohort_id } : null;
    if (ref) seen.set(`${ref.type}:${ref.id}`, ref);
  }
  return Array.from(seen.values());
}

/** Best available label for a scope the viewer can no longer message in. */
export async function loadScopeLabel(scope: ScopeRef): Promise<{ code: string; title: string; accent: string } | null> {
  const supabase = await createClient();
  if (scope.type === "offering") {
    const { data } = await supabase.from("course_offerings").select("code, accent_color, course_versions(title)").eq("id", scope.id).maybeSingle();
    if (!data) return null;
    const v = data.course_versions as unknown as { title: string } | null;
    return { code: data.code, title: v?.title ?? data.code, accent: data.accent_color };
  }
  const { data } = await supabase.from("cohorts").select("code, name").eq("id", scope.id).maybeSingle();
  return data ? { code: data.code, title: data.name, accent: "#475569" } : null;
}

export type ReadOnlyScope = ScopeRef & { code: string; title: string; accent: string; unread: number; threads: number };

/**
 * Courses and cohorts where the viewer still has conversations but can no longer send
 * messages (for example after an enrollment ended). They stay readable.
 */
export async function loadReadOnlyScopes(active: ScopeRef[]): Promise<ReadOnlyScope[]> {
  const activeKeys = new Set(active.map(scopeKey));
  const others = (await loadMyThreadScopes()).filter((s) => !activeKeys.has(scopeKey(s))).slice(0, 20);
  const rows = await Promise.all(
    others.map(async (s) => {
      const [label, threads] = await Promise.all([loadScopeLabel(s), loadScopeThreads(s)]);
      return {
        ...s,
        code: label?.code ?? "—",
        title: label?.title ?? t("msg.unknownScope"),
        accent: label?.accent ?? "#475569",
        unread: threads.reduce((sum, th) => sum + th.unread, 0),
        threads: threads.length,
      };
    }),
  );
  return rows.sort((a, b) => a.title.localeCompare(b.title, "en"));
}

/**
 * People the viewer may address in a scope (comms_recipients enforces the same rule
 * as create_thread). Returns null when the viewer cannot message in that scope.
 */
export async function loadRecipients(scope: ScopeRef): Promise<Recipient[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_recipients", {
    p_offering: scope.type === "offering" ? scope.id : null,
    p_cohort: scope.type === "cohort" ? scope.id : null,
  });
  if (error) {
    if (error.code === "42501") return null;
    throw new DataError("Could not load recipients");
  }
  return sortRecipients(
    ((data ?? []) as { user_id: string; display_name: string; scope_role: string }[]).map((r) => ({
      id: r.user_id,
      name: r.display_name || "Participant",
      role: toRecipientRole(r.scope_role),
    })),
  );
}

export type ThreadParticipant = { userId: string; name: string; lastReadAt: string | null };

export type ThreadDetail = {
  id: string;
  subject: string;
  offeringId: string | null;
  cohortId: string | null;
  participants: ThreadParticipant[];
};

/** A conversation the viewer participates in, or null (RLS hides all others). */
export const loadThread = cache(async (threadId: string): Promise<ThreadDetail | null> => {
  const supabase = await createClient();
  const { data: thread } = await supabase.from("threads").select("id, subject, offering_id, cohort_id").eq("id", threadId).maybeSingle();
  if (!thread) return null;
  const { data: parts } = await supabase
    .from("thread_participants")
    .select("user_id, last_read_at, profiles(display_name)")
    .eq("thread_id", threadId);
  const participants = ((parts ?? []) as unknown as { user_id: string; last_read_at: string | null; profiles: { display_name: string } | null }[])
    .map((p) => ({ userId: p.user_id, name: p.profiles?.display_name || "Participant", lastReadAt: p.last_read_at }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return { id: thread.id, subject: thread.subject, offeringId: thread.offering_id, cohortId: thread.cohort_id, participants };
});

type MessageRow = { id: string; sender_id: string; body: string; asset_ids: string[] | null; created_at: string };

/**
 * Messages of a conversation as the signed-in user. With `after`, only newer messages
 * (oldest first); otherwise the latest `limit` messages. Attachment metadata is read
 * through RLS (can_read_asset), so only files the viewer may open are described.
 */
export async function fetchThreadMessages(
  supabase: SupabaseClient,
  threadId: string,
  opts: { after?: string | null; limit?: number; ids?: string[]; names?: Map<string, string> } = {},
): Promise<{ messages: ThreadMessage[]; hasEarlier: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  let rows: MessageRow[] = [];
  let hasEarlier = false;
  const base = () => supabase.from("messages").select("id, sender_id, body, asset_ids, created_at").eq("thread_id", threadId);
  if (opts.ids) {
    const { data, error } = await base().in("id", opts.ids);
    if (error) throw new DataError("Could not load messages");
    rows = (data ?? []) as MessageRow[];
  } else if (opts.after) {
    const { data, error } = await base().gt("created_at", opts.after).order("created_at").order("id").limit(limit);
    if (error) throw new DataError("Could not load messages");
    rows = (data ?? []) as MessageRow[];
  } else {
    const { data, error } = await base().order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (error) throw new DataError("Could not load messages");
    const list = (data ?? []) as MessageRow[];
    hasEarlier = list.length > limit;
    rows = list.slice(0, limit).reverse();
  }

  let names = opts.names;
  if (!names) {
    const { data: parts } = await supabase.from("thread_participants").select("user_id, profiles(display_name)").eq("thread_id", threadId);
    names = new Map(
      ((parts ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[]).map((p) => [p.user_id, p.profiles?.display_name || "Participant"]),
    );
  }

  const assetIds = Array.from(new Set(rows.flatMap((r) => r.asset_ids ?? [])));
  const assets = new Map<string, MessageAttachment>();
  if (assetIds.length > 0) {
    const { data } = await supabase.from("content_assets").select("id, filename, size_bytes, declared_mime, status").in("id", assetIds);
    for (const a of (data ?? []) as { id: string; filename: string; size_bytes: number; declared_mime: string; status: string }[]) {
      if (a.status === "ready") assets.set(a.id, { id: a.id, filename: a.filename, size: Number(a.size_bytes), mime: a.declared_mime });
    }
  }

  const messages = rows.map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: names?.get(r.sender_id) ?? "Former participant",
    body: r.body,
    createdAt: r.created_at,
    attachments: (r.asset_ids ?? []).map((id) => assets.get(id)).filter((a): a is MessageAttachment => Boolean(a)),
  }));
  return { messages, hasEarlier };
}

export type CohortOverview = {
  offerings: {
    id: string;
    code: string;
    title: string;
    term_label: string;
    status: string;
    accent_color: string;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string;
    can_open: boolean;
  }[];
  staff: { user_id: string; name: string; roles: { role: "instructor" | "ta"; offering_code: string }[] }[];
  coordinators: { user_id: string; name: string }[];
  participants: { user_id: string; name: string }[];
  is_admin: boolean;
};

/** Directory data for a cohort page; null when the viewer is not a member. */
export async function loadCohortOverview(cohortId: string): Promise<CohortOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_cohort_overview", { p_cohort: cohortId });
  if (error) {
    if (error.code === "42501") return null;
    throw new DataError("Could not load the cohort");
  }
  const o = data as CohortOverview;
  const byName = <T extends { name: string }>(list: T[]) => [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return { ...o, staff: byName(o.staff), coordinators: byName(o.coordinators), participants: byName(o.participants) };
}

export type CommunitySummary = {
  community_id: string;
  cohort_id: string | null;
  cohort_name: string | null;
  name: string;
  description: string;
  join_policy: "open" | "invite";
  member_count: number;
  topic_count: number;
  is_member: boolean;
  can_manage: boolean;
};

export async function loadCommunities(communityId?: string): Promise<CommunitySummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_communities", communityId ? { p_community: communityId } : {});
  if (error) throw new DataError("Could not load communities");
  return ((data ?? []) as CommunitySummary[]).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

export async function loadCommunityMembers(communityId: string): Promise<{ user_id: string; display_name: string; joined_at: string }[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_community_members", { p_community: communityId });
  if (error) {
    if (error.code === "42501") return null;
    throw new DataError("Could not load members");
  }
  return ((data ?? []) as { user_id: string; display_name: string; joined_at: string }[]).sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "vi"),
  );
}

export type CohortRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  timezone: string;
  starts_on: string | null;
  ends_on: string | null;
  status: "active" | "upcoming" | "archived" | string;
};

const COHORT_COLUMNS = "id, code, name, description, timezone, starts_on, ends_on, status";

/** A cohort the viewer belongs to or administers (RLS: is_cohort_member), or null. */
export const loadCohort = cache(async (cohortId: string): Promise<CohortRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("cohorts").select(COHORT_COLUMNS).eq("id", cohortId).maybeSingle();
  return (data as CohortRow | null) ?? null;
});

export type MyCohort = CohortRow & { role: "admin" | "staff" | "participant" | "learner" };

/** Every cohort the viewer belongs to or administers, with the viewer's role in it. */
export async function loadMyCohorts(user: { id: string; isPlatformAdmin: boolean; coordinatorCohorts: string[]; staff: { offering_id: string }[] }): Promise<MyCohort[]> {
  const supabase = await createClient();
  const [cohortsRes, participationRes, offeringsRes] = await Promise.all([
    supabase.from("cohorts").select(COHORT_COLUMNS).order("starts_on", { ascending: false, nullsFirst: false }).limit(200),
    supabase.from("cohort_participation").select("cohort_id, status").eq("user_id", user.id),
    supabase.from("course_offerings").select("id, cohort_id").limit(1000),
  ]);
  if (cohortsRes.error) throw new DataError("Could not load cohorts");
  const participant = new Set(((participationRes.data ?? []) as { cohort_id: string; status: string }[]).filter((p) => p.status === "active").map((p) => p.cohort_id));
  const staffOfferings = new Set(user.staff.map((s) => s.offering_id));
  const staffCohorts = new Set(((offeringsRes.data ?? []) as { id: string; cohort_id: string }[]).filter((o) => staffOfferings.has(o.id)).map((o) => o.cohort_id));
  return ((cohortsRes.data ?? []) as CohortRow[]).map((c) => ({
    ...c,
    role: user.isPlatformAdmin || user.coordinatorCohorts.includes(c.id) ? "admin" : staffCohorts.has(c.id) ? "staff" : participant.has(c.id) ? "participant" : "learner",
  }));
}
