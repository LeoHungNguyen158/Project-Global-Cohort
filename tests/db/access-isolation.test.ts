// AC03 / AC04 / AC15: permission isolation through the real API (PostgREST + RLS).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, as, closeDb, db, EMAIL, offeringId, one, userId } from "./helpers";

let aaf: string, mass: string;
let an: string, binh: string, daniel: string;

beforeAll(async () => {
  aaf = await offeringId("AAF-F26");
  mass = await offeringId("MASS-F26");
  an = await userId(EMAIL.p(1));
  binh = await userId(EMAIL.p(2));
  daniel = await userId(EMAIL.daniel);
});
afterAll(closeDb);

describe("signed-out visitors", () => {
  it("cannot read any table", async () => {
    const c = anon();
    for (const table of ["profiles", "course_offerings", "grades", "released_grades", "submissions", "messages", "enrollments", "questions"]) {
      const { data, error } = await c.from(table).select("*").limit(1);
      expect(error ?? (data && data.length === 0 ? "empty" : null), table).toBeTruthy();
    }
  });
  it("sees only the limited catalog projection", async () => {
    const { data, error } = await anon().rpc("catalog_list");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(Object.keys(row).sort()).toEqual(
        ["audience", "catalog_state", "cohort_name", "course_code", "ends_at", "expected_effort", "my_state", "offering_code", "offering_id", "starts_at", "summary", "term_label", "timezone", "title"].sort(),
      );
      expect(row.my_state).toBe("signed_out");
    }
    expect(data!.some((r: { offering_code: string }) => r.offering_code === "AIGE-SUM26")).toBe(false);
  });
  it("cannot call privileged RPCs", async () => {
    const { error } = await anon().rpc("admin_list_users", { p_search: "" });
    expect(error).not.toBeNull();
  });
});

describe("learner A vs learner B in the same offering", () => {
  it("B cannot read A's released grades, submissions or quiz attempts", async () => {
    const b = await as(EMAIL.p(2));
    const grades = await b.from("released_grades").select("*").eq("user_id", an);
    expect(grades.data).toEqual([]);
    const subs = await b.from("submissions").select("*").eq("user_id", an);
    expect(subs.data).toEqual([]);
    const versions = await b.from("submission_versions").select("*, submissions!inner(user_id)").eq("submissions.user_id", an);
    expect(versions.data ?? []).toEqual([]);
    const attempts = await b.from("quiz_attempts").select("*").eq("user_id", an);
    expect(attempts.data).toEqual([]);
    const answers = await b.from("attempt_answers").select("*");
    for (const a of answers.data ?? []) {
      const owner = await one<{ user_id: string }>("select user_id from public.quiz_attempts where id = $1", [a.attempt_id]);
      expect(owner.user_id).toBe(binh);
    }
  });
  it("learners never read staff working grades", async () => {
    const a = await as(EMAIL.p(1));
    const { data } = await a.from("grades").select("*");
    expect(data).toEqual([]);
  });
  it("A cannot read a message thread they are not part of", async () => {
    const c = await as(EMAIL.p(3)); // enrolled in AAF but not in the Mai -> An/Bình thread
    const { data } = await c.from("threads").select("id, subject").eq("subject", "Feedback on your project plans");
    expect(data).toEqual([]);
    const msgs = await c.from("messages").select("body").ilike("body", "%revise the evaluation%");
    expect(msgs.data).toEqual([]);
  });
  it("profiles expose no email and only to people who share a scope", async () => {
    const c = await as(EMAIL.p(1));
    const { data } = await c.from("profiles").select("*").limit(50);
    for (const p of data ?? []) expect(Object.keys(p)).not.toContain("email");
    const p12 = await userId(EMAIL.p(12)); // shares the fall cohort
    expect((data ?? []).some((p) => p.id === p12)).toBe(true);
  });
  it("learners cannot change grades, roles, enrollments or other people's records", async () => {
    const a = await as(EMAIL.p(1));
    const g = await a.from("released_grades").update({ points: 100 }).eq("user_id", an).select();
    expect(g.error ?? (g.data?.length === 0 ? "no rows" : null)).toBeTruthy();
    const ins = await a.from("platform_role_grants").insert({ user_id: an, role: "platform_admin" });
    expect(ins.error).not.toBeNull();
    const enr = await a.from("enrollments").insert({ offering_id: mass, user_id: an });
    expect(enr.error).not.toBeNull();
    const staff = await a.from("staff_assignments").insert({ offering_id: aaf, user_id: an, role: "instructor" });
    expect(staff.error).not.toBeNull();
    const prof = await a.from("profiles").update({ display_name: "hacked" }).eq("id", binh).select();
    expect(prof.data ?? []).toEqual([]);
    const susp = await a.from("profiles").update({ suspended_at: null }).eq("id", an);
    expect(susp.error).not.toBeNull();
    const setGrade = await a.rpc("set_grade", { p_item: (await one<{ id: string }>("select id from public.grade_items where offering_id = $1 limit 1", [aaf])).id, p_user: an, p_status: "graded", p_points: 1, p_feedback: "" });
    expect(setGrade.error).not.toBeNull();
    const pub = await a.rpc("publish_grades", { p_offering: aaf, p_grade_ids: [] });
    expect(pub.error).not.toBeNull();
  });
  it("a learner cannot read an offering they are not enrolled in", async () => {
    const a = await as(EMAIL.p(1));
    const { data } = await a.from("course_offerings").select("id").eq("id", mass);
    expect(data).toEqual([]);
    const outline = await a.rpc("offering_outline", { p_offering: mass });
    expect(outline.error).not.toBeNull();
  });
});

describe("mixed role (AC04): instructor in MASS, learner in AAF", () => {
  it("sees MASS working grades and roster but no AAF working grades", async () => {
    const d = await as(EMAIL.daniel);
    const massEnroll = await d.from("enrollments").select("user_id").eq("offering_id", mass);
    expect(massEnroll.data!.length).toBeGreaterThan(0);
    const aafEnroll = await d.from("enrollments").select("user_id").eq("offering_id", aaf);
    expect(aafEnroll.data!.map((r) => r.user_id)).toEqual([daniel]);
    const aafGrades = await d.from("grades").select("id").eq("offering_id", aaf);
    expect(aafGrades.data).toEqual([]);
  });
  it("cannot author, grade or publish in AAF", async () => {
    const d = await as(EMAIL.daniel);
    const q = await d.from("quizzes").update({ title: "x" }).eq("offering_id", aaf).select();
    expect(q.data ?? []).toEqual([]);
    const item = await one<{ id: string }>("select id from public.grade_items where offering_id = $1 and kind = 'participation'", [aaf]);
    const g = await d.rpc("set_grade", { p_item: item.id, p_user: an, p_status: "graded", p_points: 1, p_feedback: "" });
    expect(g.error).not.toBeNull();
    const ann = await d.from("announcements").insert({ offering_id: aaf, title: "x", status: "published" });
    expect(ann.error).not.toBeNull();
  });
  it("altered offeringId in an RPC does not escalate", async () => {
    const d = await as(EMAIL.daniel);
    const summary = await d.rpc("staff_offering_summary", { p_offering: aaf });
    expect(summary.error).not.toBeNull();
    const ok = await d.rpc("staff_offering_summary", { p_offering: mass });
    expect(ok.error).toBeNull();
  });
});

describe("TA permissions", () => {
  it("TA can grade but not publish grades", async () => {
    const l = await as(EMAIL.linh);
    const item = await one<{ id: string }>("select id from public.grade_items where offering_id = $1 and kind = 'participation'", [aaf]);
    const p7 = await userId(EMAIL.p(7));
    const g = await l.rpc("set_grade", { p_item: item.id, p_user: p7, p_status: "graded", p_points: 6, p_feedback: "" });
    expect(g.error).toBeNull();
    const grade = await one<{ id: string }>("select id from public.grades where grade_item_id = $1 and user_id = $2", [item.id, p7]);
    const pub = await l.rpc("publish_grades", { p_offering: aaf, p_grade_ids: [grade.id] });
    expect(pub.error).not.toBeNull();
    const roles = await l.from("platform_role_grants").insert({ user_id: p7, role: "coordinator" });
    expect(roles.error).not.toBeNull();
  });
});

describe("cohort-scoped coordinator", () => {
  it("coordinator of the spring cohort cannot administer the fall cohort", async () => {
    const pg = await db();
    const linhId = await userId(EMAIL.linh);
    const spring = await one<{ id: string }>("select id from public.cohorts where code = 'GC-SPRING-2027'");
    const fall = await one<{ id: string }>("select id from public.cohorts where code = 'GC-FALL-2026'");
    await pg.query("insert into public.platform_role_grants (user_id, role) values ($1, 'coordinator') on conflict do nothing", [linhId]);
    await pg.query("insert into public.coordinator_scopes (user_id, cohort_id) values ($1, $2) on conflict do nothing", [linhId, spring.id]);
    try {
      const l = await as(EMAIL.linh);
      const okUpdate = await l.from("cohorts").update({ description: "Updated by coordinator (test)" }).eq("id", spring.id).select();
      expect(okUpdate.data?.length).toBe(1);
      const badUpdate = await l.from("cohorts").update({ description: "nope" }).eq("id", fall.id).select();
      expect(badUpdate.data ?? []).toEqual([]);
      const badInvite = await l.from("invitations").insert({ email: "x@sample.crewscaler.test", role: "participant", cohort_id: fall.id });
      expect(badInvite.error).not.toBeNull();
      const badEnroll = await l.from("enrollments").insert({ offering_id: aaf, user_id: linhId });
      expect(badEnroll.error).not.toBeNull();
    } finally {
      await pg.query("delete from public.coordinator_scopes where user_id = $1", [linhId]);
      await pg.query("update public.platform_role_grants set revoked_at = now() where user_id = $1 and role = 'coordinator' and revoked_at is null", [linhId]);
      await pg.query("update public.cohorts set description = 'Sample upcoming cohort.' where id = $1", [spring.id]);
    }
  });
});

describe("revocation takes effect on the next request (AC15)", () => {
  it("withdrawn enrollment loses access without signing out", async () => {
    const pg = await db();
    const p8 = await userId(EMAIL.p(8));
    const c = await as(EMAIL.p(8));
    const before = await c.from("course_offerings").select("id").eq("id", aaf);
    expect(before.data!.length).toBe(1);
    await pg.query("update public.enrollments set status = 'withdrawn' where offering_id = $1 and user_id = $2", [aaf, p8]);
    try {
      const after = await c.from("course_offerings").select("id").eq("id", aaf);
      expect(after.data).toEqual([]);
      const ann = await c.from("announcements").select("id").eq("offering_id", aaf);
      expect(ann.data).toEqual([]);
    } finally {
      await pg.query("update public.enrollments set status = 'active' where offering_id = $1 and user_id = $2", [aaf, p8]);
    }
  });
  it("suspended accounts lose access immediately", async () => {
    const pg = await db();
    const p7 = await userId(EMAIL.p(7));
    const c = await as(EMAIL.p(7));
    await pg.query("update public.profiles set suspended_at = now() where id = $1", [p7]);
    try {
      const after = await c.from("course_offerings").select("id");
      expect(after.data).toEqual([]);
      const rpc = await c.rpc("my_message_scopes");
      expect(rpc.error).not.toBeNull();
    } finally {
      await pg.query("update public.profiles set suspended_at = null where id = $1", [p7]);
    }
  });
});
