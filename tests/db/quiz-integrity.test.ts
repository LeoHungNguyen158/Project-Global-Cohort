// AC09 / AC10: attempt integrity and answer confidentiality through the real API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeDb, db, EMAIL, offeringId, one, userId } from "./helpers";

let aaf: string;
let quizId: string;

async function freshQuiz(opts: { timeLimit?: number | null; attempts?: number; review?: string; closesInMinutes?: number } = {}) {
  const pg = await db();
  const mai = await userId(EMAIL.mai);
  const { rows } = await pg.query(
    `insert into public.quizzes (offering_id, title, available_from, closes_at, time_limit_minutes, attempt_limit, review_policy, created_by)
     values ($1, 'TEST quiz ' || gen_random_uuid(), now() - interval '1 hour', now() + make_interval(mins => $2), $3, $4, $5, $6) returning id`,
    [aaf, opts.closesInMinutes ?? 120, opts.timeLimit === undefined ? 10 : opts.timeLimit, opts.attempts ?? 1, opts.review ?? "after_close", mai],
  );
  const id = rows[0].id as string;
  const m = await as(EMAIL.mai);
  const v = (await m.from("quiz_versions").select("id").eq("quiz_id", id).single()).data!.id;
  const q1 = await m.rpc("upsert_question", {
    p_version: v, p_question: null, p_type: "single_choice", p_prompt: "Pick B", p_points: 1,
    p_choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }], p_correct: ["b"], p_explanation: "SECRET-EXPLANATION", p_position: 0,
  });
  expect(q1.error).toBeNull();
  const q2 = await m.rpc("upsert_question", {
    p_version: v, p_question: null, p_type: "multiple_select", p_prompt: "Pick A and C", p_points: 2,
    p_choices: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], p_correct: ["a", "c"], p_explanation: "", p_position: 1,
  });
  expect(q2.error).toBeNull();
  const pub = await m.rpc("publish_quiz_version", { p_version: v });
  expect(pub.error).toBeNull();
  return id;
}

beforeAll(async () => {
  aaf = await offeringId("AAF-F26");
  quizId = await freshQuiz({ attempts: 2 });
});
afterAll(async () => {
  await closeDb();
});

describe("attempt creation", () => {
  it("double click and parallel tabs never create extra attempts", async () => {
    const c = await as(EMAIL.p(6));
    const results = await Promise.all(Array.from({ length: 5 }, () => c.rpc("start_quiz_attempt", { p_quiz: quizId })));
    const ids = new Set(results.map((r) => r.data));
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(ids.size).toBe(1);
    const p6 = await userId(EMAIL.p(6));
    const count = await one<{ n: number }>("select count(*)::int n from public.quiz_attempts where quiz_id = $1 and user_id = $2", [quizId, p6]);
    expect(count.n).toBe(1);
  });

  it("attempt limit is enforced after submission and duplicate submits are idempotent", async () => {
    const c = await as(EMAIL.p(7));
    for (let i = 0; i < 2; i++) {
      const start = await c.rpc("start_quiz_attempt", { p_quiz: quizId });
      expect(start.error).toBeNull();
      const [s1, s2] = await Promise.all([
        c.rpc("submit_quiz_attempt", { p_attempt: start.data }),
        c.rpc("submit_quiz_attempt", { p_attempt: start.data }),
      ]);
      expect(s1.error).toBeNull();
      expect(s2.error).toBeNull();
      expect(s1.data.status).toBe(s2.data.status);
    }
    const third = await c.rpc("start_quiz_attempt", { p_quiz: quizId });
    expect(third.error?.message).toMatch(/No attempts remaining/);
  });
});

describe("answer confidentiality", () => {
  it("learner cannot read questions, keys or explanations directly", async () => {
    const c = await as(EMAIL.p(5));
    const qs = await c.from("questions").select("*");
    expect(qs.data).toEqual([]);
    const versions = await c.from("quiz_versions").select("*");
    expect(versions.data).toEqual([]);
    // The private schema is not exposed through the API at all.
    const keys = await c.schema("private" as "public").from("answer_keys").select("*");
    expect(keys.error).not.toBeNull();
    const authoring = await c.rpc("get_quiz_authoring", { p_version: (await one<{ id: string }>("select id from public.quiz_versions where quiz_id = $1", [quizId])).id });
    expect(authoring.error).not.toBeNull();
  });

  it("the attempt payload carries no correct answers or explanations", async () => {
    const c = await as(EMAIL.p(5));
    const start = await c.rpc("start_quiz_attempt", { p_quiz: quizId });
    const view = await c.rpc("get_attempt", { p_attempt: start.data });
    const raw = JSON.stringify(view.data);
    expect(raw).not.toMatch(/correct|SECRET-EXPLANATION|explanation|auto_points|earned/);
    expect(view.data.questions).toHaveLength(2);
    // Review is not available before close under after_close policy.
    await c.rpc("submit_quiz_attempt", { p_attempt: start.data });
    const review = await c.rpc("get_attempt_review", { p_attempt: start.data });
    expect(review.data.review_available).toBe(false);
    expect(JSON.stringify(review.data.questions)).not.toMatch(/SECRET-EXPLANATION/);
    for (const q of review.data.questions) expect(q.correct).toBeNull();
  });

  it("another learner cannot fetch someone else's attempt or review", async () => {
    const p5 = await userId(EMAIL.p(5));
    const attempt = await one<{ id: string }>("select id from public.quiz_attempts where quiz_id = $1 and user_id = $2", [quizId, p5]);
    const other = await as(EMAIL.p(4));
    expect((await other.rpc("get_attempt", { p_attempt: attempt.id })).error).not.toBeNull();
    expect((await other.rpc("get_attempt_review", { p_attempt: attempt.id })).error).not.toBeNull();
    expect((await other.rpc("save_attempt_answer", { p_attempt: attempt.id, p_question: attempt.id, p_response: {} })).error).not.toBeNull();
  });
});

describe("server-side timing", () => {
  it("answers after the server deadline are rejected and the attempt is finalized with saved answers", async () => {
    const qz = await freshQuiz({ timeLimit: 30 });
    const c = await as(EMAIL.p(3));
    const start = await c.rpc("start_quiz_attempt", { p_quiz: qz });
    const view = await c.rpc("get_attempt", { p_attempt: start.data });
    const single = view.data.questions.find((q: { type: string }) => q.type === "single_choice");
    const saved = await c.rpc("save_attempt_answer", { p_attempt: start.data, p_question: single.id, p_response: { choice: "b" } });
    expect(saved.error).toBeNull();
    // Simulate time passing on the server (a client clock change cannot do this).
    await (await db()).query("update public.quiz_attempts set started_at = now() - interval '2 hours', deadline_at = now() - interval '1 minute' where id = $1", [start.data]);
    const late = await c.rpc("save_attempt_answer", { p_attempt: start.data, p_question: single.id, p_response: { choice: "a" } });
    expect(late.error).toBeNull();
    expect(late.data).toMatchObject({ ok: false, reason: "expired" });
    const row = await one<{ status: string; finalized_reason: string }>("select status, finalized_reason from public.quiz_attempts where id = $1", [start.data]);
    expect(row.finalized_reason).toBe("expired");
    expect(row.status).toBe("graded");
    const answer = await one<{ response: { choice: string } }>("select response from public.attempt_answers where attempt_id = $1 and question_id = $2", [start.data, single.id]);
    expect(answer.response.choice).toBe("b");
    const score = await one<{ s: string }>("select sum(coalesce(manual_points, auto_points))::text s from private.attempt_results where attempt_id = $1", [start.data]);
    expect(Number(score.s)).toBe(1);
  });

  it("an unsubmitted attempt is finalized lazily when the learner returns after closing the tab", async () => {
    const qz = await freshQuiz({ timeLimit: 30 });
    const c = await as(EMAIL.p(2));
    const start = await c.rpc("start_quiz_attempt", { p_quiz: qz });
    await (await db()).query("update public.quiz_attempts set deadline_at = now() - interval '5 minutes' where id = $1", [start.data]);
    const overview = await c.rpc("quiz_overview", { p_quiz: qz });
    expect(overview.error).toBeNull();
    expect(overview.data.in_progress_attempt_id).toBeNull();
    expect(overview.data.attempts[0].finalized_reason).toBe("expired");
  });

  it("deadline is the earlier of time limit and closing time; accommodations extend only granted limits", async () => {
    const qz = await freshQuiz({ timeLimit: 60, closesInMinutes: 20 });
    const p8 = await userId(EMAIL.p(8));
    const c = await as(EMAIL.p(8));
    const overview = await c.rpc("quiz_overview", { p_quiz: qz });
    const projected = new Date(overview.data.deadline_if_started_now).getTime();
    const closes = new Date(overview.data.closes_at).getTime();
    expect(Math.abs(projected - closes)).toBeLessThan(1000);
    await (await db()).query(
      "insert into public.quiz_accommodations (quiz_id, user_id, extra_minutes, extended_closes_at) values ($1, $2, 30, now() + interval '3 hours')",
      [qz, p8],
    );
    const start = await c.rpc("start_quiz_attempt", { p_quiz: qz });
    const attempt = await one<{ minutes: number }>("select extract(epoch from deadline_at - started_at)/60 as minutes from public.quiz_attempts where id = $1", [start.data]);
    expect(Math.round(Number(attempt.minutes))).toBe(90);
  });

  it("multiple select is all-or-nothing and never negative", async () => {
    const qz = await freshQuiz({ timeLimit: null });
    const c = await as(EMAIL.p(1));
    const start = await c.rpc("start_quiz_attempt", { p_quiz: qz });
    const view = await c.rpc("get_attempt", { p_attempt: start.data });
    const multi = view.data.questions.find((q: { type: string }) => q.type === "multiple_select");
    const invalid = await c.rpc("save_attempt_answer", { p_attempt: start.data, p_question: multi.id, p_response: { choices: ["zzz"] } });
    expect(invalid.error).not.toBeNull();
    await c.rpc("save_attempt_answer", { p_attempt: start.data, p_question: multi.id, p_response: { choices: ["a", "b", "c"] } });
    await c.rpc("submit_quiz_attempt", { p_attempt: start.data });
    const r = await one<{ auto_points: string }>("select auto_points::text from private.attempt_results where attempt_id = $1 and question_id = $2", [start.data, multi.id]);
    expect(Number(r.auto_points)).toBe(0);
  });

  it("re-grading is idempotent", async () => {
    const pg = await db();
    const an = await userId(EMAIL.p(1));
    const quiz1 = await one<{ id: string }>("select id from public.quizzes where title like 'Quiz 1:%'");
    const attempt = await one<{ id: string }>("select id from public.quiz_attempts where quiz_id = $1 and user_id = $2", [quiz1.id, an]);
    const q4 = await one<{ question_id: string }>("select question_id from private.attempt_results where attempt_id = $1 and needs_manual", [attempt.id]);
    const m = await as(EMAIL.mai);
    for (let i = 0; i < 3; i++) {
      const r = await m.rpc("grade_attempt_question", { p_attempt: attempt.id, p_question: q4.question_id, p_points: 3, p_feedback: "Good point about compounding errors." });
      expect(r.error).toBeNull();
    }
    const g = await pg.query("select points from public.grades where user_id = $1 and grade_item_id = (select id from public.grade_items where quiz_id = $2)", [an, quiz1.id]);
    expect(g.rows).toHaveLength(1);
    expect(Number(g.rows[0].points)).toBe(90);
  });
});
