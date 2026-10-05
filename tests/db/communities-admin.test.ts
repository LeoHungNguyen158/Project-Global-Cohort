// Community management (Administration → Communities) through the real API (PostgREST + RLS).
// Everything here is synthetic: two cohorts, four accounts on the sample domain and the
// communities this file creates, all with a unique run suffix and removed in afterAll.
// Seeded people, cohorts and communities are only used to sign in as the platform administrator.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { API_URL, as, closeDb, db, DOMAIN, EMAIL, PASSWORD } from "./helpers";

const S = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PEOPLE = {
  coord: { email: `cmt-coord-${S}@${DOMAIN}`, name: `Community Coordinator ${S}` },
  learnerA: { email: `cmt-la-${S}@${DOMAIN}`, name: `Community Learner A ${S}` },
  learnerB: { email: `cmt-lb-${S}@${DOMAIN}`, name: `Community Learner B ${S}` },
  outsider: { email: `cmt-out-${S}@${DOMAIN}`, name: `Community Outsider ${S}` },
};
type Who = keyof typeof PEOPLE;

const ids = {} as Record<Who, string>;
let cohortA = "", cohortB = "";
const communities: string[] = [];

function service() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is required to create the synthetic accounts.");
  return createClient(API_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Creates a community directly in the database (fixture only; the API paths are tested below). */
async function fixtureCommunity(name: string, cohort: string | null, policy: "open" | "invite"): Promise<string> {
  const { rows } = await (await db()).query<{ id: string }>(
    "insert into public.communities (name, cohort_id, join_policy, description) values ($1, $2, $3, 'Synthetic test community') returning id",
    [`${name} ${S}`, cohort, policy],
  );
  communities.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  const pg = await db();
  const svc = service();
  for (const [who, person] of Object.entries(PEOPLE) as [Who, (typeof PEOPLE)[Who]][]) {
    const { data, error } = await svc.auth.admin.createUser({
      email: person.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: person.name },
    });
    if (error) throw error;
    ids[who] = data.user.id;
  }
  // Cohorts are created as the (sample) platform administrator, like the Administration area does.
  const admin = await as(EMAIL.admin);
  const cohort = async (suffix: string) => {
    const { data, error } = await admin
      .from("cohorts")
      .insert({ code: `CMT-${S}-${suffix}`, name: `Community test cohort ${suffix} ${S}`, status: "active" })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  };
  cohortA = await cohort("A");
  cohortB = await cohort("B");
  await pg.query("insert into public.cohort_participation (cohort_id, user_id) values ($1, $2), ($3, $4)", [cohortA, ids.learnerA, cohortB, ids.learnerB]);
  await pg.query("insert into public.platform_role_grants (user_id, role) values ($1, 'coordinator')", [ids.coord]);
  await pg.query("insert into public.coordinator_scopes (user_id, cohort_id) values ($1, $2)", [ids.coord, cohortA]);
});

afterAll(async () => {
  const pg = await db();
  const synthetic = Object.values(ids);
  try {
    if (communities.length) await pg.query("delete from public.communities where id = any($1::uuid[])", [communities]);
    // Communities created through the API in this run (by name suffix), in case an assertion failed midway.
    await pg.query("delete from public.communities where name like $1", [`%${S}`]);
    const cohorts = [cohortA, cohortB].filter(Boolean);
    if (cohorts.length) {
      await pg.query("delete from public.cohort_participation where cohort_id = any($1::uuid[])", [cohorts]);
      await pg.query("delete from public.cohorts where id = any($1::uuid[])", [cohorts]);
      await pg.query("delete from public.audit_events where cohort_id = any($1::uuid[])", [cohorts]);
    }
    // The synthetic accounts' own audit rows reference their profiles; they are test artifacts.
    if (synthetic.length) await pg.query("delete from public.audit_events where actor_id = any($1::uuid[])", [synthetic]);
    const svc = service();
    for (const id of synthetic) await svc.auth.admin.deleteUser(id);
  } finally {
    await closeDb();
  }
});

describe("cohort administrators manage only their cohort's communities", () => {
  it("creates and edits a community in their own cohort only", async () => {
    const c = await as(PEOPLE.coord.email);
    const own = await c.from("communities").insert({ name: `Coordinator circle ${S}`, cohort_id: cohortA, join_policy: "invite" }).select("id").single();
    expect(own.error).toBeNull();
    communities.push(own.data!.id);
    const edit = await c.from("communities").update({ description: "Edited by the coordinator" }).eq("id", own.data!.id).select("id");
    expect(edit.data).toHaveLength(1);

    const other = await c.from("communities").insert({ name: `Other cohort ${S}`, cohort_id: cohortB, join_policy: "invite" });
    expect(other.error).not.toBeNull();
    const programWide = await c.from("communities").insert({ name: `Program wide ${S}`, cohort_id: null, join_policy: "open" });
    expect(programWide.error).not.toBeNull();

    const inB = await fixtureCommunity("Cohort B circle", cohortB, "invite");
    const editB = await c.from("communities").update({ description: "nope" }).eq("id", inB).select("id");
    expect(editB.data ?? []).toEqual([]);
    const moveToB = await c.from("communities").update({ cohort_id: cohortB }).eq("id", own.data!.id).select("id");
    expect(moveToB.error ?? (moveToB.data?.length === 0 ? "unchanged" : null)).toBeTruthy();
  });

  it("adds and removes members of their cohort's invitation-only community, and nobody else's", async () => {
    const c = await as(PEOPLE.coord.email);
    const commA = await fixtureCommunity("Cohort A invite", cohortA, "invite");
    const commB = await fixtureCommunity("Cohort B invite", cohortB, "invite");

    const people = await c.rpc("admin_community_people", { p_community: commA });
    expect(people.error).toBeNull();
    const candidate = (people.data as { kind: string; user_id: string; email: string | null }[]).find((p) => p.user_id === ids.learnerA);
    expect(candidate?.kind).toBe("candidate");
    expect(candidate?.email).toBeNull(); // email addresses are for platform administrators only
    expect((people.data as { user_id: string }[]).some((p) => p.user_id === ids.learnerB)).toBe(false);

    expect((await c.rpc("admin_add_community_member", { p_community: commA, p_user: ids.learnerA })).data).toBe("added");
    expect((await c.rpc("admin_add_community_member", { p_community: commA, p_user: ids.learnerA })).data).toBe("already_member");
    expect((await c.rpc("admin_add_community_member", { p_community: commA, p_user: ids.learnerB })).data).toBe("not_in_cohort");
    expect((await c.rpc("admin_add_community_member", { p_community: commA, p_user: ids.outsider })).data).toBe("not_in_cohort");

    expect((await c.rpc("admin_add_community_member", { p_community: commB, p_user: ids.learnerB })).error?.code).toBe("42501");
    expect((await c.rpc("admin_community_people", { p_community: commB })).error?.code).toBe("42501");
    expect((await c.rpc("admin_remove_community_member", { p_community: commB, p_user: ids.learnerB })).error?.code).toBe("42501");

    expect((await c.rpc("admin_remove_community_member", { p_community: commA, p_user: ids.learnerA })).data).toBe(true);
    expect((await c.rpc("admin_remove_community_member", { p_community: commA, p_user: ids.learnerA })).data).toBe(false);

    const { rows } = await (await db()).query<{ action: string; actor_id: string }>(
      "select action, actor_id from public.audit_events where target_table = 'community_members' and target_id = $1",
      [`${commA}:${ids.learnerA}`],
    );
    expect(rows.map((r) => r.action).sort()).toEqual(["community.add_member", "community.remove_member"]);
    expect(rows.every((r) => r.actor_id === ids.coord)).toBe(true);
  });
});

describe("learners", () => {
  it("cannot add other people, or themselves to an invitation-only community", async () => {
    const l = await as(PEOPLE.learnerA.email);
    const invite = await fixtureCommunity("Learner invite", cohortA, "invite");
    const open = await fixtureCommunity("Learner open", cohortA, "open");

    expect((await l.from("community_members").insert({ community_id: invite, user_id: ids.learnerA })).error).not.toBeNull();
    expect((await l.from("community_members").insert({ community_id: open, user_id: ids.coord })).error).not.toBeNull();
    expect((await l.rpc("admin_add_community_member", { p_community: invite, p_user: ids.learnerA })).error?.code).toBe("42501");
    expect((await l.rpc("admin_add_community_member", { p_community: open, p_user: ids.coord })).error?.code).toBe("42501");
    expect((await l.rpc("admin_community_people", { p_community: open })).error?.code).toBe("42501");

    // Joining an open community themselves still works; removing someone else does not.
    expect((await l.from("community_members").insert({ community_id: open, user_id: ids.learnerA })).error).toBeNull();
    await (await db()).query("insert into public.community_members (community_id, user_id) values ($1, $2)", [open, ids.coord]);
    const removeOther = await l.from("community_members").delete().eq("community_id", open).eq("user_id", ids.coord).select();
    expect(removeOther.data ?? []).toEqual([]);

    const { rows } = await (await db()).query("select user_id from public.community_members where community_id = $1 order by user_id", [invite]);
    expect(rows).toEqual([]);
  });

  it("cannot edit or create communities", async () => {
    const l = await as(PEOPLE.learnerA.email);
    const open = await fixtureCommunity("Learner edit", cohortA, "open");
    const edit = await l.from("communities").update({ join_policy: "invite" }).eq("id", open).select("id");
    expect(edit.data ?? []).toEqual([]);
    expect((await l.from("communities").insert({ name: `Learner made ${S}`, cohort_id: cohortA })).error).not.toBeNull();
  });
});

describe("platform administrators", () => {
  it("manage every community and add anyone eligible", async () => {
    const a = await as(EMAIL.admin);
    const programWide = await a.from("communities").insert({ name: `Program invite ${S}`, cohort_id: null, join_policy: "invite" }).select("id").single();
    expect(programWide.error).toBeNull();
    communities.push(programWide.data!.id);
    expect((await a.rpc("admin_add_community_member", { p_community: programWide.data!.id, p_user: ids.outsider })).data).toBe("added");

    const commB = await fixtureCommunity("Admin cohort B", cohortB, "invite");
    expect((await a.rpc("admin_add_community_member", { p_community: commB, p_user: ids.learnerB })).data).toBe("added");
    expect((await a.rpc("admin_add_community_member", { p_community: commB, p_user: ids.learnerA })).data).toBe("not_in_cohort");
    const people = await a.rpc("admin_community_people", { p_community: commB });
    expect(people.error).toBeNull();
    const member = (people.data as { kind: string; user_id: string; email: string | null }[]).find((p) => p.user_id === ids.learnerB);
    expect(member?.kind).toBe("member");
    expect(member?.email).toBe(PEOPLE.learnerB.email);

    // A community cannot move to a cohort its members do not belong to.
    const move = await a.from("communities").update({ cohort_id: cohortA }).eq("id", commB).select("id");
    expect(move.error?.hint).toBe("community_members_outside_cohort");
    expect((await a.rpc("admin_remove_community_member", { p_community: commB, p_user: ids.learnerB })).data).toBe(true);
    const moved = await a.from("communities").update({ cohort_id: cohortA }).eq("id", commB).select("id");
    expect(moved.error).toBeNull();
    expect(moved.data).toHaveLength(1);

    const { rows } = await (await db()).query<{ action: string }>(
      "select action from public.audit_events where target_table = 'communities' and target_id = $1",
      [programWide.data!.id],
    );
    expect(rows.map((r) => r.action)).toContain("insert");
  });
});

describe("community membership grants no cohort or course access", () => {
  it("a member of a program-wide or cohort community gains no cohort, offering or enrollment", async () => {
    const pg = await db();
    const programWide = await fixtureCommunity("No access lounge", null, "invite");
    const commB = await fixtureCommunity("No access B", cohortB, "invite");
    const a = await as(EMAIL.admin);
    expect((await a.rpc("admin_add_community_member", { p_community: programWide, p_user: ids.outsider })).data).toBe("added");
    expect((await a.rpc("admin_add_community_member", { p_community: commB, p_user: ids.learnerB })).data).toBe("added");

    const outsider = await as(PEOPLE.outsider.email);
    expect((await outsider.from("community_members").select("community_id").eq("community_id", programWide)).data).toHaveLength(1);
    expect((await outsider.from("course_offerings").select("id")).data).toEqual([]);
    expect((await outsider.from("cohorts").select("id")).data).toEqual([]);
    expect((await outsider.from("enrollments").select("offering_id")).data).toEqual([]);
    // A cohort's community stays invisible to people outside that cohort.
    expect((await outsider.from("communities").select("id").eq("id", commB)).data).toEqual([]);

    const learnerB = await as(PEOPLE.learnerB.email);
    expect((await learnerB.from("cohorts").select("id")).data!.map((c) => c.id)).toEqual([cohortB]);
    expect((await learnerB.from("course_offerings").select("id")).data).toEqual([]);

    for (const who of [ids.outsider, ids.learnerB]) {
      const { rows } = await pg.query(
        `select (select count(*) from public.enrollments where user_id = $1)::int as enrollments,
                (select count(*) from public.staff_assignments where user_id = $1)::int as staff,
                (select count(*) from public.cohort_participation where user_id = $1)::int as participation`,
        [who],
      );
      expect(rows[0]).toEqual({ enrollments: 0, staff: 0, participation: who === ids.learnerB ? 1 : 0 });
    }
  });
});
