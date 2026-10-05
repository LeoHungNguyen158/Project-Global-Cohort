import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Administration journeys. Everything that changes state happens in a cohort, offering
// and courses this spec creates (unique codes), to participant09/participant10, or to
// synthetic accounts created here on the sample domain. Seeded cohorts, courses and
// offerings are only read. Email goes to Mailpit (local capture) and only to
// @sample.crewscaler.test addresses. afterAll removes what the run created.

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const NOT_AVAILABLE = { level: 1, name: "Page not available" } as const;
const S = uniqueSuffix();
const COHORT_CODE = `ADM-E2E-${S}`;
const OFFERING_CODE = `ADM-E2E-${S}-OFF`;
const COURSE_CODE = `ADM-E2E-${S}-C`;
const INVITEE = sampleEmail(`adm-inv-${S}`);
const IMPORT_OK = sampleEmail(`adm-imp-${S}`);
const COORDINATOR = { email: sampleEmail(`adm-coord-${S}`), name: `E2E Coordinator ${S}` };
const LEARNER_A = { email: sampleEmail(`adm-la-${S}`), name: `E2E Learner A ${S}` };
const LEARNER_B = { email: sampleEmail(`adm-lb-${S}`), name: `E2E Learner B ${S}` };

function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for the administration fixtures.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signed-in client for a sample account, for steps a person would do elsewhere in the app. */
async function supabaseAs(email: string): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return client;
}

async function findUserId(db: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function signedIn(browser: Browser, who: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

type MailSummary = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages?: MailSummary[] };
  return body.messages ?? [];
}

/** Waits until `count` messages reached the address, then makes sure no extra one follows. */
async function expectMailCount(address: string, count: number): Promise<MailSummary[]> {
  await expect.poll(async () => (await mailsTo(address)).length, { timeout: 30_000, message: `emails to ${address}` }).toBeGreaterThanOrEqual(count);
  await new Promise((r) => setTimeout(r, 1500));
  const messages = await mailsTo(address);
  expect(messages, `emails to ${address}`).toHaveLength(count);
  return messages;
}

async function confirmLink(messageId: string): Promise<string> {
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messageId}`)).json()) as { HTML: string; Text: string };
  const match = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML) ?? /(https?:\/\/\S*\/auth\/confirm\S*)/.exec(msg.Text);
  if (!match) throw new Error("The email has no /auth/confirm link");
  return match[1].replaceAll("&amp;", "&");
}

/** Outcome announced at page level after row actions (the admin flash region). */
function flash(page: Page): Locator {
  return page.getByTestId("admin-flash");
}

async function confirmIn(page: Page, confirmLabel: string, fill?: (dialog: Locator) => Promise<void>) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (fill) await fill(dialog);
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Opens a page and waits until it is idle (hydrated), so forms run their client-side handlers. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const state: {
  cohortId?: string;
  offeringId?: string;
  courseIds: string[];
  assetPaths: { id: string; bucket: string; path: string }[];
  programNameBefore?: string | null;
  vttAllowedBefore?: boolean;
} = { courseIds: [], assetPaths: [] };

test.describe("administration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const db = service();
    for (const person of [COORDINATOR, LEARNER_A, LEARNER_B]) {
      const { error } = await db.auth.admin.createUser({
        email: person.email,
        password: process.env.SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: person.name },
      });
      if (error) throw error;
    }
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    const db = service();
    const problems: string[] = [];
    const run = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) problems.push(`${label}: ${error.message}`);
    };
    // participant10 must end active even when the suspension test failed midway.
    const p10 = await findUserId(db, sampleEmail("participant10"));
    if (p10) {
      const { data } = await db.from("profiles").select("suspended_at").eq("id", p10).single();
      if (data?.suspended_at) {
        const admin = await supabaseAs(sampleEmail("admin"));
        await run("reactivate participant10", admin.rpc("admin_set_account_suspension", { p_user: p10, p_suspend: false, p_reason: "End of administration test" }));
      }
    }
    if (state.programNameBefore !== undefined) {
      const admin = await supabaseAs(sampleEmail("admin"));
      const { data: rows } = await db.from("platform_settings").select("key, value");
      const get = (k: string) => (rows ?? []).find((r) => r.key === k)?.value ?? "";
      if (get("program_name") !== (state.programNameBefore ?? "")) {
        await run(
          "restore settings",
          admin.rpc("admin_update_settings", {
            p_program_name: state.programNameBefore ?? "",
            p_support_email: get("support_email"),
            p_support_url: get("support_url"),
            p_public_catalog: get("public_catalog") === "true",
          }),
        );
      }
    }
    if (state.vttAllowedBefore === false) {
      await run("upload limit", db.from("upload_limits").delete().eq("purpose", "message").eq("mime", "text/vtt"));
    }
    for (const a of state.assetPaths) {
      await db.storage.from(a.bucket).remove([a.path]);
      await run("asset", db.from("content_assets").delete().eq("id", a.id));
    }
    const addresses = [INVITEE, IMPORT_OK, COORDINATOR.email, LEARNER_A.email, LEARNER_B.email];
    await run("invitations by address", db.from("invitations").delete().in("email", addresses));
    if (state.offeringId) {
      const id = state.offeringId;
      await run("requests", db.from("access_requests").delete().eq("offering_id", id));
      await run("offering invitations", db.from("invitations").delete().eq("offering_id", id));
      await run("enrollments", db.from("enrollments").delete().eq("offering_id", id));
      await run("staff", db.from("staff_assignments").delete().eq("offering_id", id));
      await run("offering", db.from("course_offerings").delete().eq("id", id));
    }
    if (state.cohortId) {
      const id = state.cohortId;
      await run("cohort invitations", db.from("invitations").delete().eq("cohort_id", id));
      await run("participation", db.from("cohort_participation").delete().eq("cohort_id", id));
      await run("cohort", db.from("cohorts").delete().eq("id", id));
    }
    // Course versions can only be purged by the sample-data purge, so test courses are
    // archived (they are flagged as sample data and removed by `npm run purge-sample`).
    for (const courseId of state.courseIds) {
      await run("course", db.from("courses").update({ archived_at: new Date().toISOString() }).eq("id", courseId).is("archived_at", null));
    }
    for (const email of addresses) {
      const id = await findUserId(db, email);
      if (id) await run(`delete ${email}`, db.auth.admin.deleteUser(id));
    }
    expect(problems, "cleanup").toEqual([]);
  });

  test("people without an administration role get Page not available, and the admin APIs answer 404", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: offering } = await db.from("course_offerings").select("id").eq("code", "AAF-F26").single();
    for (const who of ["participant09", "linh.pham"]) {
      const { context, page } = await signedIn(browser, who);
      for (const path of ["/admin", "/admin/users", "/admin/invitations", "/admin/settings", `/admin/offerings/${offering?.id}`]) {
        await open(page, path);
        await expect(page.getByRole("heading", NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
        await expect(page.getByRole("navigation", { name: "Administration sections" })).toHaveCount(0);
      }
      // No Administration link in the sidebar either.
      await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
      for (const path of ["/api/admin/import/template", `/api/admin/reports/completion/${offering?.id}`, "/api/admin/uploads/00000000-0000-4000-8000-000000000000"]) {
        expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
      }
      await context.close();
    }
  });

  test("an administrator creates a cohort and an offering, then releases the offering", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "admin");
    await open(page, "/admin/cohorts");
    await page.getByText("Create a cohort").click();
    await page.locator("#new-cohort-code").fill(COHORT_CODE);
    await page.locator("#new-cohort-name").fill(`Administration test cohort ${S}`);
    await page.locator("#new-cohort-timezone").selectOption("Asia/Ho_Chi_Minh");
    await page.getByRole("button", { name: "Create cohort" }).click();
    await page.waitForURL(/\/admin\/cohorts\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
    state.cohortId = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByText("Cohort created.")).toBeVisible();

    const db = service();
    const { data: version } = await db
      .from("course_versions")
      .select("id, courses!inner(code)")
      .eq("courses.code", "AAF")
      .eq("status", "published")
      .order("version_no", { ascending: false })
      .limit(1)
      .single();
    expect(version?.id).toBeTruthy();

    await page.getByRole("link", { name: "New offering" }).click();
    await page.waitForURL(/\/admin\/offerings\/new\?cohort=/);
    await page.locator("#new-version").selectOption(version!.id);
    await expect(page.locator("#new-cohort")).toHaveValue(state.cohortId!);
    await expect(page.locator("#new-offering-tz")).toHaveValue("Asia/Ho_Chi_Minh");
    await page.locator("#new-offering-code").fill(OFFERING_CODE);
    await page.locator("#new-offering-term").fill("Test term");
    await page.locator("#new-offering-starts").fill("2026-11-02T09:00");
    await page.locator("#new-offering-ends").fill("2026-12-18T17:00");
    await page.getByRole("button", { name: "Create offering" }).click();
    await page.waitForURL(/\/admin\/offerings\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
    state.offeringId = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByText("Offering created as a draft.")).toBeVisible();
    const { data: created } = await db.from("course_offerings").select("status, starts_at, timezone").eq("id", state.offeringId!).single();
    // 09:00 in Ho Chi Minh City (UTC+7) is 02:00 UTC.
    expect(created).toMatchObject({ status: "draft", timezone: "Asia/Ho_Chi_Minh" });
    expect(new Date(created!.starts_at as string).toISOString()).toBe("2026-11-02T02:00:00.000Z");

    await page.getByRole("button", { name: "Release to learners" }).click();
    await confirmIn(page, "Release to learners");
    await expect(flash(page)).toContainText("Released.");
    await expect(page.getByRole("button", { name: "Complete offering" })).toBeVisible();
    const { data: released } = await db.from("course_offerings").select("status").eq("id", state.offeringId!).single();
    expect(released?.status).toBe("published");
  });

  test("an invitation email arrives once with a link to this app, and revoking it switches the link off", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(page, "admin");
    await open(page, `/admin/invitations?cohort=${state.cohortId}`);
    await page.locator("#invite-email").fill(INVITEE);
    await page.locator("#invite-name").fill("Lê Thị Thử");
    await expect(page.locator("#invite-cohort")).toHaveValue(state.cohortId!);
    await page.locator("#invite-offering").selectOption(state.offeringId!);
    await page.getByRole("button", { name: "Create invitation and send" }).click();
    const form = page.getByRole("form", { name: "New invitation" });
    await expect(form.getByText(`Invitation created for ${INVITEE}.`)).toBeVisible({ timeout: 30_000 });
    await expect(form.getByText("The email service accepted the invitation email for delivery.")).toBeVisible();

    const [mail] = await expectMailCount(INVITEE, 1);
    const firstLink = await confirmLink(mail.ID);
    const link = new URL(firstLink);
    expect(link.origin).toBe(new URL(baseURL ?? "http://localhost:3000").origin);
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("type")).toBe("invite");

    const db = service();
    const { data: row } = await db.from("invitations").select("id, email_status, cohort_id, offering_id").eq("email", INVITEE).single();
    expect(row).toMatchObject({ email_status: "accepted_by_provider", cohort_id: state.cohortId, offering_id: state.offeringId });

    // Resend: a second email, again with a link to this app.
    await open(page, `/admin/invitations?q=${encodeURIComponent(INVITEE)}`);
    await page.getByRole("button", { name: `Resend invitation to ${INVITEE}` }).click();
    await expect(flash(page)).toContainText(`Invitation for ${INVITEE} sent again.`, { timeout: 30_000 });
    const both = await expectMailCount(INVITEE, 2);
    const links = await Promise.all(both.map((m) => confirmLink(m.ID)));

    await page.getByRole("button", { name: `Revoke the invitation for ${INVITEE}` }).click();
    await confirmIn(page, "Revoke invitation", (d) => d.getByLabel("Note (optional)").fill("Sent by the administration test"));
    await expect(flash(page)).toContainText(`Invitation for ${INVITEE} revoked. The link in the invitation email no longer works.`);
    const { data: revoked } = await db.from("invitations").select("revoked_at").eq("id", row!.id).single();
    expect(revoked?.revoked_at).toBeTruthy();

    for (const l of links) {
      const anon = await browser.newContext();
      const visitor = await anon.newPage();
      await visitor.goto(l);
      await visitor.waitForURL(/\/login/, { timeout: 30_000 });
      expect(new URL(visitor.url()).searchParams.get("error")).toBe("link");
      await visitor.goto("/invite/accept");
      await visitor.waitForURL(/\/login/);
      await anon.close();
    }
  });

  test("a CSV dry run lists row problems and creates nothing until confirmed", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const others = [sampleEmail(`adm-imp2-${S}`), sampleEmail(`adm-imp3-${S}`)];
    const csv = [
      "email,display_name,role,cohort_code,offering_code",
      `${IMPORT_OK},"Trần, Thị ""Hoa""",participant,${COHORT_CODE},`,
      `not-an-email,Bad Address,participant,${COHORT_CODE},`,
      `${IMPORT_OK.toUpperCase()},Duplicate Row,participant,${COHORT_CODE},`,
      `${sampleEmail("participant01")},Nguyễn Văn An,participant,,AAF-F26`,
      `${others[0]},Unknown Cohort,participant,NOPE-${S},`,
      `${others[1]},Wrong Role,owner,${COHORT_CODE},`,
    ].join("\r\n");

    await signIn(page, "admin");
    await open(page, "/admin/import");
    await expect(page.getByRole("link", { name: "Download template", exact: true })).toHaveAttribute("href", "/api/admin/import/template");
    const template = await page.request.get("/api/admin/import/template");
    expect(template.status()).toBe(200);
    expect(template.headers()["content-disposition"]).toContain("attachment");
    expect(await template.text()).toContain("email,display_name,role,cohort_code,offering_code");

    await page.getByLabel("Or paste the rows").fill(csv);
    await page.getByRole("button", { name: "Check rows" }).click();
    await expect(page.getByText("Dry run result: nothing was created")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("6 row(s) checked: 1 ready, 5 with problems.")).toBeVisible();
    const preview = page.getByRole("table", { name: "Rows checked in the dry run" });
    for (const text of [
      "This is not a valid email address.",
      "Same address as line 2.",
      "Already enrolled in this offering.",
      "No cohort with this code in your administration scope.",
      "Unknown role. Use participant, instructor or ta.",
    ]) {
      await expect(preview.getByText(text)).toBeVisible();
    }
    // The dry run created nothing and sent nothing.
    const { count: before } = await db.from("invitations").select("id", { count: "exact", head: true }).in("email", [IMPORT_OK, ...others]);
    expect(before).toBe(0);
    expect(await mailsTo(IMPORT_OK)).toHaveLength(0);

    await page.getByRole("button", { name: "Create 1 invitation(s)…" }).click();
    await confirmIn(page, "Create and send");
    await expect(page.getByText("1 invitation(s) created.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Invitation emails accepted by the email service: 1")).toBeVisible();
    await expect(page.getByText("Skipped because of problems: 5")).toBeVisible();
    const { data: createdRows } = await db.from("invitations").select("email, cohort_id").in("email", [IMPORT_OK, ...others]);
    expect(createdRows).toEqual([{ email: IMPORT_OK, cohort_id: state.cohortId }]);
    await expectMailCount(IMPORT_OK, 1);
  });

  test("staff and enrollments: withdrawing an enrollment ends course access at once", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const p09 = await findUserId(db, sampleEmail("participant09"));
    const coordId = await findUserId(db, COORDINATOR.email);
    await signIn(page, "admin");
    await open(page, `/admin/offerings/${state.offeringId}`);

    // A teaching assistant with explicit permissions, edited and removed again.
    await page.locator("#add-staff-email").fill(COORDINATOR.email);
    await page.locator("#add-staff-role").selectOption("ta");
    await page.getByRole("button", { name: "Add staff member" }).click();
    await expect(page.getByText(`${COORDINATOR.name} added to the staff.`)).toBeVisible({ timeout: 30_000 });
    const staffForm = page.getByRole("form", { name: `Role and permissions for ${COORDINATOR.name}` });
    await staffForm.getByLabel("Edit content").check();
    await staffForm.getByRole("button", { name: `Save role and permissions for ${COORDINATOR.name}` }).click();
    await expect(flash(page)).toContainText("Role and permissions saved.");
    const { data: staff } = await db.from("staff_assignments").select("role, can_author, can_grade, can_publish_grades").eq("offering_id", state.offeringId!).eq("user_id", coordId!).single();
    expect(staff).toEqual({ role: "ta", can_author: true, can_grade: true, can_publish_grades: false });
    await page.getByRole("button", { name: `Remove ${COORDINATOR.name} from staff` }).click();
    await confirmIn(page, "Remove");
    await expect(flash(page)).toContainText("Staff member removed.");
    const { count: staffLeft } = await db.from("staff_assignments").select("user_id", { count: "exact", head: true }).eq("offering_id", state.offeringId!);
    expect(staffLeft).toBe(0);

    // Enroll participant09 (existing account); they can open the released course.
    await page.locator("#add-learner-email").fill(sampleEmail("participant09"));
    await page.getByRole("button", { name: "Enroll", exact: true }).click();
    await expect(page.getByText("Đặng Quốc Huy is enrolled and can open the course now.")).toBeVisible({ timeout: 30_000 });
    const learner = await signedIn(browser, "participant09");
    await learner.page.goto(`/courses/${state.offeringId}`);
    await expect(learner.page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(learner.page.getByRole("heading", NOT_AVAILABLE)).toHaveCount(0);

    await page.reload({ waitUntil: "networkidle" });
    const row = page.getByRole("form", { name: "Enrollment status for Đặng Quốc Huy" });
    await row.getByLabel("Status", { exact: true }).selectOption("withdrawn");
    await row.getByRole("button", { name: "Save enrollment status for Đặng Quốc Huy" }).click();
    await expect(flash(page)).toContainText("Enrollment withdrawn. Course access ended immediately.");
    const { data: enrollment } = await db.from("enrollments").select("status, source").eq("offering_id", state.offeringId!).eq("user_id", p09!).single();
    expect(enrollment).toEqual({ status: "withdrawn", source: "admin" });

    await learner.page.reload();
    await expect(learner.page.getByRole("heading", NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
    await learner.context.close();
  });

  test("access requests are approved (enrolling the person) or declined with a note", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    await signIn(page, "admin");
    await open(page, `/admin/offerings/${state.offeringId}`);
    const details = page.getByRole("form", { name: "Details" });
    await details.getByLabel("List this offering in the catalog once it is released").check();
    await details.getByLabel("Access requests").selectOption("open_for_requests");
    await details.getByRole("button", { name: "Save changes" }).click();
    await expect(details.getByText("Offering details saved.")).toBeVisible({ timeout: 30_000 });

    for (const person of [LEARNER_A, LEARNER_B]) {
      const client = await supabaseAs(person.email);
      const { error } = await client.rpc("request_access", { p_offering: state.offeringId, p_message: `Please add me (${person.name})` });
      expect(error).toBeNull();
    }

    await open(page, "/admin/access-requests");
    await expect(page.getByText(`${LEARNER_A.name} asked to join ${OFFERING_CODE}`)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: `Approve the request from ${LEARNER_A.name}` }).click();
    await confirmIn(page, "Approve", (d) => d.getByLabel("Note (optional)").fill("Welcome aboard"));
    await expect(flash(page)).toContainText("Request approved. The person is enrolled and was notified.");
    await page.getByRole("button", { name: `Decline the request from ${LEARNER_B.name}` }).click();
    await confirmIn(page, "Decline", (d) => d.getByLabel("Note (optional)").fill("This offering is full"));
    await expect(flash(page)).toContainText("Request declined. The person was notified.");

    const a = await findUserId(db, LEARNER_A.email);
    const b = await findUserId(db, LEARNER_B.email);
    const { data: enrollment } = await db.from("enrollments").select("status, source").eq("offering_id", state.offeringId!).eq("user_id", a!).single();
    expect(enrollment).toEqual({ status: "active", source: "access_request" });
    const { data: declined } = await db.from("access_requests").select("status, review_note").eq("offering_id", state.offeringId!).eq("user_id", b!).single();
    expect(declined).toEqual({ status: "declined", review_note: "This offering is full" });
    const { count: bEnrolled } = await db.from("enrollments").select("id", { count: "exact", head: true }).eq("offering_id", state.offeringId!).eq("user_id", b!);
    expect(bEnrolled).toBe(0);
  });

  test("platform administrator role is granted and removed from Users, and the audit log records it", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const coordId = await findUserId(db, COORDINATOR.email);
    const adminId = await findUserId(db, sampleEmail("admin"));
    await signIn(page, "admin");

    // Administrators cannot remove their own role (the last administrator is protected by the database too).
    await open(page, `/admin/users/${adminId}`);
    await expect(page.getByText("You cannot remove your own administrator role.")).toBeVisible();

    await open(page, `/admin/users/${coordId}`);
    await page.getByRole("button", { name: "Grant role: Platform administrator" }).click();
    await confirmIn(page, "Grant role");
    await expect(flash(page)).toContainText("Platform administrator role granted.");
    await page.getByRole("button", { name: "Remove role: Platform administrator" }).click();
    await confirmIn(page, "Remove role");
    await expect(flash(page)).toContainText("Platform administrator role removed.");
    const { data: grants } = await db.from("platform_role_grants").select("role, revoked_at").eq("user_id", coordId!);
    expect(grants).toEqual([expect.objectContaining({ role: "platform_admin", revoked_at: expect.any(String) })]);

    await open(page, "/admin/audit?target=platform_role_grants");
    const entries = page.getByRole("list", { name: "Audit entries" }).getByRole("listitem");
    await expect(entries.filter({ hasText: "insert" }).first()).toBeVisible();
    await expect(entries.filter({ hasText: "update" }).first()).toBeVisible();
  });

  test("a cohort coordinator manages only their own cohort", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: fall } = await db.from("cohorts").select("id").eq("code", "GC-FALL-2026").single();
    const { data: seeded } = await db.from("course_offerings").select("id").eq("code", "AAF-F26").single();

    await signIn(page, "admin");
    await open(page, `/admin/cohorts/${state.cohortId}`);
    await page.getByLabel("Add a coordinator by email").fill(COORDINATOR.email);
    await page.getByRole("button", { name: "Add coordinator" }).click();
    await expect(page.getByText(`${COORDINATOR.name} now coordinates this cohort.`)).toBeVisible({ timeout: 30_000 });

    const coordinator = await signedIn(browser, COORDINATOR.email);
    const c = coordinator.page;
    await open(c, "/admin");
    await expect(c.getByText("Cohort coordinator: you manage the 1 cohort(s) assigned to you and their offerings.")).toBeVisible({ timeout: 30_000 });
    const nav = c.getByRole("navigation", { name: "Administration sections" });
    await expect(nav.getByRole("link", { name: "Cohorts" })).toBeVisible();
    for (const hidden of ["Users", "Courses", "Uploads", "Settings"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);

    await open(c, "/admin/cohorts");
    await expect(c.getByRole("link", { name: `Administration test cohort ${S}` })).toBeVisible();
    await expect(c.getByText("GC-FALL-2026")).toHaveCount(0);
    await open(c, `/admin/offerings/${state.offeringId}`);
    await expect(c.getByRole("heading", { level: 2, name: new RegExp(OFFERING_CODE) })).toBeVisible();
    // People's names are shown, but email addresses are for platform administrators only.
    await expect(c.locator("main").getByText(LEARNER_A.name)).toBeVisible();
    await expect(c.locator("main")).not.toContainText("@sample.crewscaler.test");
    await open(c, `/admin/cohorts/${state.cohortId}`);
    await expect(c.locator("main").getByText(COORDINATOR.name)).toBeVisible();
    await expect(c.locator("main")).not.toContainText("@sample.crewscaler.test");
    await open(c, "/admin/access-requests?status=all");
    await expect(c.getByText(`${LEARNER_A.name} asked to join ${OFFERING_CODE}`)).toBeVisible();
    await expect(c.locator("main")).not.toContainText("@sample.crewscaler.test");

    for (const path of [`/admin/cohorts/${fall!.id}`, `/admin/offerings/${seeded!.id}`, "/admin/users", "/admin/courses", "/admin/uploads", "/admin/settings"]) {
      await open(c, path);
      await expect(c.getByRole("heading", NOT_AVAILABLE), path).toBeVisible({ timeout: 30_000 });
    }
    // Other cohorts are not offered anywhere, and their data stays out of reports and exports.
    await open(c, "/admin/invitations");
    await expect(c.locator("#invite-cohort option", { hasText: "GC-FALL-2026" })).toHaveCount(0);
    await open(c, "/admin/reports");
    await expect(c.locator("#report-offering option", { hasText: "AAF-F26" })).toHaveCount(0);
    expect((await c.request.get(`/api/admin/reports/completion/${seeded!.id}`)).status()).toBe(404);
    const own = await c.request.get(`/api/admin/reports/completion/${state.offeringId}`);
    expect(own.status()).toBe(200);
    await open(c, "/admin/audit");
    await expect(c.getByRole("list", { name: "Audit entries" })).toBeVisible();
    await expect(c.getByText("Cohort GC-FALL-2026")).toHaveCount(0);
    await expect(c.getByText("Offering AAF-F26")).toHaveCount(0);
    await coordinator.context.close();
  });

  test("suspending participant10 ends access on the next request; reactivating restores it", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const p10 = await findUserId(db, sampleEmail("participant10"));
    const learner = await signedIn(browser, "participant10");
    await learner.page.goto("/courses");
    await expect(learner.page.getByRole("heading", { level: 1 })).toBeVisible();

    await signIn(page, "admin");
    await open(page, `/admin/users/${p10}`);
    await page.getByRole("button", { name: "Suspend account" }).click();
    await confirmIn(page, "Suspend account", (d) => d.getByLabel("Reason").fill("Administration test: suspension check"));
    await expect(flash(page)).toContainText("Account suspended. It stops working on the person's next request.");

    // Next request from the existing session: signed out with an explanation.
    await learner.page.goto("/courses");
    await learner.page.waitForURL(/\/login\?error=inactive/, { timeout: 30_000 });
    await expect(learner.page.getByText("Your account is not active. Contact your program administrator.")).toBeVisible();
    // Signing in again is refused while suspended.
    await learner.page.goto("/login");
    await learner.page.getByLabel("Email address").fill(sampleEmail("participant10"));
    await learner.page.getByLabel("Password").fill(process.env.SEED_PASSWORD ?? "");
    await learner.page.getByRole("button", { name: "Sign in" }).click();
    await expect(learner.page.getByText("Your account is not active. Contact your program administrator.")).toBeVisible();
    await expect(learner.page).toHaveURL(/\/login/);

    await page.getByRole("button", { name: "Reactivate account" }).click();
    await confirmIn(page, "Reactivate account", (d) => d.getByLabel("Reason").fill("Administration test: access restored"));
    await expect(flash(page)).toContainText("Account reactivated. The person can sign in again.");
    const { data: profile } = await db.from("profiles").select("suspended_at").eq("id", p10!).single();
    expect(profile?.suspended_at).toBeNull();
    await learner.context.close();

    const again = await signedIn(browser, "participant10");
    await again.page.goto("/courses");
    await expect(again.page).toHaveURL(/\/courses$/);
    await expect(again.page.getByRole("heading", NOT_AVAILABLE)).toHaveCount(0);
    await again.context.close();
  });

  test("quarantined uploads are downloaded for review, then released or rejected", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const owner = await findUserId(db, COORDINATOR.email);
    const files = [1, 2].map((n) => ({ name: `review-${S}-${n}.txt`, path: `admin-e2e/${S}/review-${n}.txt`, body: `Administration review file ${n} (${S})\n` }));
    const ids: string[] = [];
    for (const f of files) {
      const { error: upErr } = await db.storage.from("message-attachments").upload(f.path, Buffer.from(f.body), { contentType: "text/plain" });
      expect(upErr).toBeNull();
      const { data, error } = await db
        .from("content_assets")
        .insert({
          owner_id: owner,
          purpose: "message",
          bucket: "message-attachments",
          object_path: f.path,
          filename: f.name,
          declared_mime: "text/plain",
          detected_mime: "text/plain",
          size_bytes: Buffer.byteLength(f.body),
          status: "quarantined",
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      ids.push(data!.id as string);
      state.assetPaths.push({ id: data!.id as string, bucket: "message-attachments", path: f.path });
    }

    await signIn(page, "admin");
    await open(page, "/admin/uploads");
    await expect(page.getByText("Upload review mode:")).toBeVisible();
    await expect(page.getByText("No malware scanner is connected.", { exact: false })).toBeVisible();
    for (const f of files) await expect(page.getByText(f.name, { exact: true })).toBeVisible();

    const download = await page.request.get(`/api/admin/uploads/${ids[0]}`, { maxRedirects: 0 });
    expect(download.status()).toBe(302);
    const signed = download.headers()["location"];
    expect(signed).toContain("/storage/v1/object/sign/message-attachments/");
    expect(await (await fetch(signed)).text()).toBe(files[0].body);

    await page.getByRole("button", { name: `Release ${files[0].name}` }).click();
    await confirmIn(page, "Release");
    await expect(flash(page)).toContainText("File released.");
    await page.getByRole("button", { name: `Reject ${files[1].name}` }).click();
    await confirmIn(page, "Reject", (d) => d.getByLabel("Reason").fill("Not related to the course"));
    await expect(flash(page)).toContainText("File rejected and deleted from storage.");

    const { data: rows } = await db.from("content_assets").select("id, status, rejection_reason").in("id", ids);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(byId.get(ids[0])).toMatchObject({ status: "ready" });
    expect(byId.get(ids[1])).toMatchObject({ status: "rejected", rejection_reason: "Not related to the course" });
    const { error: gone } = await db.storage.from("message-attachments").download(files[1].path);
    expect(gone).not.toBeNull();
    // Reviewed files leave the queue, and the download route closes for them.
    expect((await page.request.get(`/api/admin/uploads/${ids[0]}`, { maxRedirects: 0 })).status()).toBe(404);
  });

  test("settings are validated, saved and shown; upload types can be allowed and removed", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: settings } = await db.from("platform_settings").select("key, value");
    state.programNameBefore = (settings ?? []).find((s) => s.key === "program_name")?.value ?? "";
    const { count: vtt } = await db.from("upload_limits").select("mime", { count: "exact", head: true }).eq("purpose", "message").eq("mime", "text/vtt");
    state.vttAllowedBefore = (vtt ?? 0) > 0;

    await signIn(page, "admin");
    await open(page, "/admin/settings");
    const general = page.getByRole("form", { name: "Program and support" });
    const supportUrl = await general.getByLabel("Support page link").inputValue();
    await general.getByLabel("Support page link").fill("http://insecure.example.org/help");
    await general.getByRole("button", { name: "Save changes" }).click();
    await expect(general.getByText("The support link must be a complete https:// address, or empty.")).toBeVisible({ timeout: 30_000 });
    await general.getByLabel("Support page link").fill(supportUrl);

    const programName = `Administration test program ${S}`;
    await general.getByLabel("Program name").fill(programName);
    await general.getByRole("button", { name: "Save changes" }).click();
    await expect(general.getByText("Settings saved (1 changed).")).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(programName, { exact: true })).toBeVisible();
    await general.getByLabel("Program name").fill(state.programNameBefore ?? "");
    await general.getByRole("button", { name: "Save changes" }).click();
    await expect(general.getByText("Settings saved (1 changed).")).toBeVisible({ timeout: 30_000 });

    if (!state.vttAllowedBefore) {
      const panel = page.getByRole("region", { name: "Message attachments" });
      await panel.getByLabel("Allow another type").selectOption("text/vtt");
      await panel.getByLabel("Max size (MB)").last().fill("0");
      await panel.getByRole("button", { name: "Allow type" }).click();
      await expect(panel.getByText("Enter a size in MB, for example 10 or 2.5.")).toBeVisible({ timeout: 30_000 });
      await panel.getByLabel("Max size (MB)").last().fill("1.5");
      await panel.getByRole("button", { name: "Allow type" }).click();
      await expect(panel.getByText("Upload limit saved.")).toBeVisible({ timeout: 30_000 });
      const { data: limit } = await db.from("upload_limits").select("max_bytes").eq("purpose", "message").eq("mime", "text/vtt").single();
      expect(limit?.max_bytes).toBe(1572864);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("region", { name: "Message attachments" }).getByRole("button", { name: "Stop allowing WebVTT captions" }).click();
      await confirmIn(page, "Stop allowing");
      await expect(flash(page)).toContainText("File type no longer allowed for new uploads.");
      const { count: after } = await db.from("upload_limits").select("mime", { count: "exact", head: true }).eq("purpose", "message").eq("mime", "text/vtt");
      expect(after).toBe(0);
    }
    const { data: audit } = await db.from("audit_events").select("action").in("action", ["settings.update", "upload_limit.set", "upload_limit.remove"]).gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    expect((audit ?? []).map((a) => a.action)).toEqual(expect.arrayContaining(["settings.update"]));
  });

  test("completion report and CSV export, and the audit log filters", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "admin");
    await open(page, `/admin/reports?offering=${state.offeringId}`);
    const table = page.getByRole("table", { name: `Completion report for ${OFFERING_CODE}` });
    await expect(table.getByRole("row", { name: /Đặng Quốc Huy/ })).toContainText("Withdrawn");
    await expect(table.getByRole("row", { name: new RegExp(LEARNER_A.name) })).toContainText("Active");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^completion-${OFFERING_CODE}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Learner,Enrollment status,Required lessons completed,Required lessons,Progress (%),Finished all required lessons (UTC)");
    expect(csv).toContain(`Đặng Quốc Huy,withdrawn,`);
    expect(csv).toContain(`${LEARNER_A.name},active,`);
    expect(csv).not.toContain("@");

    const today = new Date().toISOString().slice(0, 10);
    await open(page, `/admin/audit?action=offering.publish`);
    await expect(page.getByRole("list", { name: "Audit entries" }).getByText(`Offering ${OFFERING_CODE}`)).toBeVisible();
    await open(page, "/admin/audit");
    await page.getByLabel("Who").fill("Avery Morgan");
    await page.getByLabel("Record type").selectOption("course_offerings");
    await page.getByLabel("From").fill("2026-01-01");
    await page.getByLabel("To (inclusive)").fill("2026-12-31");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/target=course_offerings/);
    const entries = page.getByRole("list", { name: "Audit entries" }).getByRole("listitem");
    await expect(entries.first()).toContainText("Avery Morgan");
    await expect(entries.filter({ hasText: `Offering ${OFFERING_CODE}` }).first()).toBeVisible();
    await entries.first().getByText("Details").click();
    await expect(entries.first().locator("pre")).toBeVisible();
    // An inverted range is explained instead of silently showing nothing.
    await open(page, `/admin/audit?from=${today}&to=2026-01-01`);
    await expect(page.getByText("The end date is before the start date.")).toBeVisible();
  });

  test("courses are created with a draft, renamed, duplicated and archived (never deleted)", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "admin");
    await open(page, "/admin/courses");
    await page.locator("#course-code").fill(COURSE_CODE);
    await page.locator("#course-title").fill(`Administration test course ${S}`);
    await page.getByRole("button", { name: "Create course" }).click();
    await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
    const courseId = new URL(page.url()).pathname.split("/").pop()!;
    state.courseIds.push(courseId);
    await expect(page.getByText("Course created with an empty draft version 1.")).toBeVisible();

    await page.locator("#rename-title").fill(`Administration test course ${S} (renamed)`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Course title saved.")).toBeVisible({ timeout: 30_000 });

    await page.locator("#dup-code").fill(`${COURSE_CODE}-COPY`);
    await page.locator("#dup-title").fill(`Administration test course ${S} copy`);
    await page.getByRole("button", { name: "Duplicate course" }).click();
    await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}\?duplicated=1$/, { timeout: 30_000 });
    const copyId = new URL(page.url()).pathname.split("/").pop()!;
    state.courseIds.push(copyId);
    expect(copyId).not.toBe(courseId);
    await expect(page.getByText("Course duplicated.", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Archive course" }).click();
    await confirmIn(page, "Archive course");
    await expect(flash(page)).toContainText("Course archived.");
    await expect(page.getByRole("button", { name: "Restore course" })).toBeVisible();
    const db = service();
    const { data: rows } = await db.from("courses").select("id, archived_at").in("id", [courseId, copyId]);
    expect(rows).toHaveLength(2);
    expect(rows!.find((r) => r.id === copyId)?.archived_at).toBeTruthy();
    // Archived courses are not offered for new offerings.
    await open(page, "/admin/offerings/new");
    await expect(page.locator(`#new-version optgroup[label^="${COURSE_CODE}-COPY "]`)).toHaveCount(0);
    await expect(page.locator(`#new-version optgroup[label^="${COURSE_CODE} "]`)).toHaveCount(1);
  });
});

test.describe("administration layout", () => {
  test("administration pages fit 390, 768 and 1440 px and pass axe @responsive", async ({ page }) => {
    test.setTimeout(300_000);
    const db = service();
    const { data: fall } = await db.from("cohorts").select("id").eq("code", "GC-FALL-2026").single();
    const { data: offering } = await db.from("course_offerings").select("id, course_id").eq("code", "AAF-F26").single();
    const p09 = await findUserId(db, sampleEmail("participant09"));
    await signIn(page, "admin");
    const paths = [
      "/admin",
      "/admin/users",
      `/admin/users/${p09}`,
      "/admin/invitations",
      "/admin/import",
      "/admin/access-requests",
      "/admin/cohorts",
      `/admin/cohorts/${fall!.id}`,
      "/admin/courses",
      `/admin/courses/${offering!.course_id}`,
      "/admin/offerings",
      "/admin/offerings/new",
      `/admin/offerings/${offering!.id}`,
      `/admin/reports?offering=${offering!.id}`,
      "/admin/audit",
      "/admin/uploads",
      "/admin/settings",
    ];
    for (const path of paths) {
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1, name: "Administration" }), path).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
  });
});
