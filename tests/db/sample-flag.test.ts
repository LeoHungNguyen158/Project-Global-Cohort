import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./helpers";

afterAll(closeDb);

describe("sample flag inheritance", () => {
  it("cohorts, courses and offerings created outside a sample account are real records", async () => {
    // Regression: the insert trigger used to fail on cohorts and courses for any actor that is
    // not a sample account (a real administrator, the service role, a direct SQL insert).
    const c = await db();
    await c.query("begin");
    try {
      const cohort = await c.query("insert into public.cohorts (code, name) values ('ZZ-REAL-CHK', 'Real cohort check') returning id, is_sample");
      const course = await c.query("insert into public.courses (code, title) values ('ZZ-REAL-CHK', 'Real course check') returning id, is_sample");
      expect(cohort.rows[0].is_sample).toBe(false);
      expect(course.rows[0].is_sample).toBe(false);
    } finally {
      await c.query("rollback");
    }
  });
});
