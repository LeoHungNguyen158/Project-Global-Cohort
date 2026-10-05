// AC07 (link issuance) / AC08 / AC11 / AC12 through the real API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeDb, db, EMAIL, offeringId, one, userId } from "./helpers";

let aaf: string, mass: string;
const lessonByTitle = async (title: string, offering: string) =>
  one<{ id: string; lineage_id: string }>(
    "select l.id, l.lineage_id from public.lessons l join public.course_offerings o on o.course_version_id = l.course_version_id where o.id = $1 and l.title = $2",
    [offering, title],
  );

beforeAll(async () => {
  aaf = await offeringId("AAF-F26");
  mass = await offeringId("MASS-F26");
});
afterAll(closeDb);

describe("prerequisites (AC08)", () => {
  it("a locked lesson, its API and its file link stay closed until the rule is met", async () => {
    const starter = await lessonByTitle("Starter code download", aaf);
    const asset = await one<{ object_path: string }>(
      "select a.object_path from public.lesson_assets la join public.content_assets a on a.id = la.asset_id where la.lesson_id = $1", [starter.id]);
    const binh = await as(EMAIL.p(2));
    const outline = await binh.rpc("offering_outline", { p_offering: aaf });
    const lessons = outline.data.modules.flatMap((m: { lessons: unknown[] }) => m.lessons) as { id: string; lock_reasons: { kind: string }[] }[];
    expect(lessons.find((l) => l.id === starter.id)!.lock_reasons[0].kind).toBe("lesson_complete");
    expect((await binh.from("lessons").select("body_html").eq("id", starter.id)).data).toEqual([]);
    expect((await binh.rpc("mark_lesson_progress", { p_offering: aaf, p_lesson: starter.id, p_position_seconds: 0, p_duration_seconds: null, p_complete: true })).error).not.toBeNull();
    const link = await binh.storage.from("course-content").createSignedUrl(asset.object_path, 60);
    expect(link.error).not.toBeNull();
    // An completed the prerequisite: same file is available.
    const an = await as(EMAIL.p(1));
    const ok = await an.storage.from("course-content").createSignedUrl(asset.object_path, 60);
    expect(ok.error).toBeNull();
    expect((await an.from("lessons").select("id").eq("id", starter.id)).data).toHaveLength(1);
  });

  it("rejects cyclic prerequisite rules", async () => {
    const m = await as(EMAIL.mai);
    const l3 = await lessonByTitle("Lecture: The agent loop", aaf);
    const l6 = await lessonByTitle("Starter code download", aaf);
    const { error } = await m.from("prerequisite_rules").insert({ offering_id: aaf, target_lesson_lineage: l3.lineage_id, kind: "lesson_complete", required_lesson_lineage: l6.lineage_id });
    expect(error?.message).toMatch(/cycle/);
  });

  it("staff override unlocks with an audit entry; learners cannot self-override", async () => {
    const binhId = await userId(EMAIL.p(2));
    const maiId = await userId(EMAIL.mai);
    const l7 = await lessonByTitle("Planning strategies", aaf);
    const b = await as(EMAIL.p(2));
    const self = await b.from("prerequisite_overrides").insert({ offering_id: aaf, user_id: binhId, target_lesson_lineage: l7.lineage_id, reason: "please", granted_by: binhId });
    expect(self.error).not.toBeNull();
    const m = await as(EMAIL.mai);
    const ins = await m.from("prerequisite_overrides").insert({ offering_id: aaf, user_id: binhId, target_lesson_lineage: l7.lineage_id, reason: "Approved accommodation (test)", granted_by: maiId }).select("id").single();
    expect(ins.error).toBeNull();
    try {
      expect((await b.from("lessons").select("id").eq("id", l7.id)).data).toHaveLength(1);
      const audit = await one<{ n: number }>("select count(*)::int n from public.audit_events where target_table = 'prerequisite_overrides' and target_id = $1", [ins.data!.id]);
      expect(audit.n).toBe(1);
    } finally {
      await (await db()).query("delete from public.prerequisite_overrides where id = $1", [ins.data!.id]);
    }
  });

  it("optional items do not block completion and progress persists", async () => {
    const an = await as(EMAIL.p(1));
    const progress = await an.rpc("course_progress", { p_offering: aaf });
    expect(progress.error).toBeNull();
    const required = await one<{ n: number }>(
      "select count(*)::int n from public.lessons l join public.course_offerings o on o.course_version_id = l.course_version_id where o.id = $1 and l.required", [aaf]);
    expect(progress.data.required_total).toBe(required.n);
  });

  it("video lessons with a playback rule need 90% of the duration", async () => {
    const video = await lessonByTitle("Lecture: The agent loop", aaf);
    const c = await as(EMAIL.p(7));
    await c.rpc("mark_lesson_progress", { p_offering: aaf, p_lesson: video.id, p_position_seconds: 5, p_duration_seconds: 20, p_complete: false });
    const early = await c.rpc("mark_lesson_progress", { p_offering: aaf, p_lesson: video.id, p_position_seconds: 5, p_duration_seconds: 20, p_complete: true });
    expect(early.error?.message).toMatch(/90%/);
    await c.rpc("mark_lesson_progress", { p_offering: aaf, p_lesson: video.id, p_position_seconds: 19, p_duration_seconds: 20, p_complete: false });
    const done = await c.rpc("mark_lesson_progress", { p_offering: aaf, p_lesson: video.id, p_position_seconds: 19, p_duration_seconds: 20, p_complete: true });
    expect(done.error).toBeNull();
    expect(done.data.completed_at).toBeTruthy();
  });
});

describe("grades and publication (AC11)", () => {
  it("a learner sees no draft grade; publication reveals exactly that result and notifies", async () => {
    const binhId = await userId(EMAIL.p(2));
    const b = await as(EMAIL.p(2));
    const projectItem = await one<{ id: string }>("select id from public.grade_items where title like 'Project:%' and offering_id = $1", [aaf]);
    const before = await b.from("released_grades").select("*").eq("grade_item_id", projectItem.id);
    expect(before.data).toEqual([]);
    const notes = await b.from("notifications").select("title").eq("kind", "grade");
    expect((notes.data ?? []).some((n) => n.title.includes("Project"))).toBe(false);

    const grade = await one<{ id: string }>("select id from public.grades where grade_item_id = $1 and user_id = $2", [projectItem.id, binhId]);
    const m = await as(EMAIL.mai);
    const pub = await m.rpc("publish_grades", { p_offering: aaf, p_grade_ids: [grade.id] });
    expect(pub.data).toBe(1);
    try {
      const after = await b.from("released_grades").select("points, status").eq("grade_item_id", projectItem.id);
      expect(after.data).toEqual([{ points: 78, status: "graded" }]);
      const n2 = await b.from("notifications").select("title, target_url").eq("kind", "grade");
      expect(n2.data!.some((n) => n.title.includes("Project") && n.target_url.startsWith(`/grades/${aaf}`))).toBe(true);
      const audit = await one<{ n: number }>("select count(*)::int n from public.audit_events where action = 'grades.publish' and offering_id = $1", [aaf]);
      expect(audit.n).toBeGreaterThan(0);
    } finally {
      await m.rpc("unpublish_grade", { p_grade: grade.id });
      await (await db()).query("delete from public.notifications where user_id = $1 and kind = 'grade' and title like 'Grade posted: Project%'", [binhId]);
    }
  });
});

describe("communication scope (AC12)", () => {
  it("recipient picker and thread creation are limited to the scope", async () => {
    const c = await as(EMAIL.p(3)); // AAF learner, not in MASS
    const members = await c.rpc("list_scope_members", { p_offering: mass, p_cohort: null });
    expect(members.error).not.toBeNull();
    const inScope = await c.rpc("list_scope_members", { p_offering: aaf, p_cohort: null });
    expect(inScope.error).toBeNull();
    for (const row of inScope.data) expect(Object.keys(row).sort()).toEqual(["display_name", "scope_role", "user_id"]);
    const outsider = await userId(EMAIL.p(12)); // MASS only
    const bad = await c.rpc("create_thread", {
      p_offering: aaf, p_cohort: null, p_recipients: [outsider], p_subject: "x", p_body: "y", p_assets: [], p_confirm_large: false, p_client_key: null,
    });
    expect(bad.error?.message).toMatch(/not members/);
  });

  it("stores a real thread and reply with unread counts; large sends need confirmation", async () => {
    const maiId = await userId(EMAIL.mai);
    const c = await as(EMAIL.p(3));
    const key = crypto.randomUUID();
    const t = await c.rpc("create_thread", {
      p_offering: aaf, p_cohort: null, p_recipients: [maiId], p_subject: "Test question", p_body: "Hello (test)", p_assets: [], p_confirm_large: false, p_client_key: key,
    });
    expect(t.error).toBeNull();
    const dup = await c.rpc("create_thread", {
      p_offering: aaf, p_cohort: null, p_recipients: [maiId], p_subject: "Test question", p_body: "Hello (test)", p_assets: [], p_confirm_large: false, p_client_key: key,
    });
    expect(dup.data).toBe(t.data);
    const m = await as(EMAIL.mai);
    const unread = await m.rpc("unread_message_count");
    expect(unread.data).toBeGreaterThan(0);
    await m.rpc("send_message", { p_thread: t.data, p_body: "Reply (test)", p_assets: [], p_client_key: null });
    const msgs = await c.from("messages").select("body").eq("thread_id", t.data).order("created_at");
    expect(msgs.data!.map((x) => x.body)).toEqual(["Hello (test)", "Reply (test)"]);
    const all = await c.rpc("list_scope_members", { p_offering: aaf, p_cohort: null });
    const ids = all.data.map((r: { user_id: string }) => r.user_id);
    const large = await c.rpc("create_thread", {
      p_offering: aaf, p_cohort: null, p_recipients: ids, p_subject: "Everyone", p_body: "Hi all", p_assets: [], p_confirm_large: false, p_client_key: null,
    });
    if (ids.length > 11) expect(large.error?.message).toMatch(/Confirm/);
    await (await db()).query("delete from public.threads where subject in ('Test question', 'Everyone')");
  });

  it("scheduled announcements stay hidden until server time passes", async () => {
    const b = await as(EMAIL.p(2));
    const { data } = await b.from("announcements").select("title").eq("offering_id", aaf);
    const titles = data!.map((a) => a.title);
    expect(titles).toContain("Welcome to Agentic AI Foundations");
    expect(titles).not.toContain("Office hours moved to Thursday");
    expect(titles).not.toContain("Week 5 preview (draft)");
  });

  it("a community membership never unlocks a course", async () => {
    const p2 = await as(EMAIL.p(2)); // community lounge member, not enrolled in MASS
    expect((await p2.from("community_members").select("community_id")).data!.length).toBeGreaterThan(0);
    expect((await p2.from("course_offerings").select("id").eq("id", mass)).data).toEqual([]);
  });
});

describe("uploads and storage (AC07)", () => {
  it("rejects disallowed types and oversize files before upload", async () => {
    const c = await as(EMAIL.p(1));
    const html = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "x.html", p_mime: "text/html", p_size: 10, p_offering: aaf, p_course_version: null });
    expect(html.error?.message).toMatch(/not accepted/);
    const svg = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "x.svg", p_mime: "image/svg+xml", p_size: 10, p_offering: aaf, p_course_version: null });
    expect(svg.error).not.toBeNull();
    const zip = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "x.zip", p_mime: "application/zip", p_size: 10, p_offering: aaf, p_course_version: null });
    expect(zip.error).not.toBeNull();
    const big = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "x.pdf", p_mime: "application/pdf", p_size: 10 * 1024 * 1024 * 1024, p_offering: aaf, p_course_version: null });
    expect(big.error?.message).toMatch(/too large/);
    const wrongScope = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "x.pdf", p_mime: "application/pdf", p_size: 100, p_offering: mass, p_course_version: null });
    expect(wrongScope.error).not.toBeNull();
    const lesson = await c.rpc("register_upload", { p_purpose: "lesson", p_filename: "x.pdf", p_mime: "application/pdf", p_size: 100, p_offering: null,
      p_course_version: (await one<{ id: string }>("select course_version_id id from public.course_offerings where id = $1", [aaf])).id });
    expect(lesson.error).not.toBeNull();
  });

  it("a learner's submission file is private even within the same course", async () => {
    const c = await as(EMAIL.p(1));
    const reg = await c.rpc("register_upload", { p_purpose: "submission", p_filename: "notes.txt", p_mime: "text/plain", p_size: 11, p_offering: aaf, p_course_version: null });
    expect(reg.error).toBeNull();
    const up = await c.storage.from(reg.data.bucket).upload(reg.data.object_path, new Blob(["hello world"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(up.error).toBeNull();
    // Uploading to a path not registered by this user is refused by storage policy.
    const other = await as(EMAIL.p(2));
    const hijack = await other.storage.from(reg.data.bucket).upload(reg.data.object_path, new Blob(["x"]), { upsert: true });
    expect(hijack.error).not.toBeNull();
    const peer = await other.storage.from(reg.data.bucket).createSignedUrl(reg.data.object_path, 60);
    expect(peer.error).not.toBeNull();
    const own = await c.storage.from(reg.data.bucket).createSignedUrl(reg.data.object_path, 60);
    expect(own.error).toBeNull();
    const rogue = await other.storage.from("submissions").upload(`submission/${crypto.randomUUID()}/${crypto.randomUUID()}`, new Blob(["x"]));
    expect(rogue.error).not.toBeNull();
    await (await db()).query("delete from public.content_assets where id = $1", [reg.data.asset_id]);
  });
});
