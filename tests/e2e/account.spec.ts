import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Account and resources journeys: catalog, Tools, profile, invitations, Help and the
// policy drafts. Only participant11 and participant12 are changed (profile, access
// requests, invitations to them). Fixtures are created with the service-role client,
// named with a unique suffix, and removed afterwards. Nothing here sends email.

const SPRING_COHORT = "GC-SPRING-2027";

function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for the account fixtures.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function userId(db: SupabaseClient, localPart: string): Promise<string> {
  const email = sampleEmail(localPart);
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`No account for ${email}`);
}

async function cohortId(db: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await db.from("cohorts").select("id").eq("code", code).single();
  if (error) throw error;
  return data.id as string;
}

async function signedIn(browser: Browser, who: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

/** Signed-in Supabase client for a sample account, to prove the database itself refuses. */
async function supabaseAs(who: string): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: sampleEmail(who), password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return client;
}

test.describe("public pages", () => {
  test("a signed-out visitor sees the public catalog, Help and the policy drafts @responsive", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: settings } = await db.from("platform_settings").select("key, value");
    const setting = (key: string) => (settings ?? []).find((s) => s.key === key)?.value?.trim() ?? "";

    await page.goto("/catalog");
    await expect(page.getByRole("heading", { level: 1, name: "Course Catalog" })).toBeVisible({ timeout: 30_000 });
    if (setting("public_catalog") === "true") {
      await expect(page.getByTestId("catalog-entry").first()).toBeVisible();
      // Visitors are sent to sign in; requesting needs an account.
      await expect(page.getByRole("button", { name: /^Request access/ })).toHaveCount(0);
      const open = page.getByTestId("catalog-entry").filter({ has: page.getByText("Open for requests", { exact: true }) });
      if ((await open.count()) > 0) {
        await expect(open.first().getByRole("link", { name: "Sign in to request access" })).toHaveAttribute("href", "/login?next=%2Fcatalog");
      }
      await page.getByLabel("Search the catalog").fill("no course is called this");
      await page.getByLabel("Search the catalog").press("Enter");
      await expect(page.getByText("No offerings match your search and filters.")).toBeVisible();
    } else {
      await expect(page.getByText("Sign in to browse the catalog")).toBeVisible();
    }
    await expect(page.locator("main")).not.toContainText(/payment|price|purchase|checkout/i);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible({ timeout: 30_000 });
    for (const heading of [
      "Signing in and passwords",
      "Finding and navigating a course",
      "Handing in work and uploading files",
      "Taking and resuming a quiz",
      "Reading your grades",
      "Getting support",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    const email = setting("support_email");
    const url = setting("support_url");
    if (email || url) {
      await expect(page.getByTestId("support-contact")).toBeVisible();
      if (email) await expect(page.getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
    } else {
      // Never an invented address: the missing setting is stated as a setup item.
      await expect(page.getByText("Support contact not configured yet")).toBeVisible();
      await expect(page.locator("main a[href^='mailto:']")).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    for (const [path, title] of [
      ["/privacy", "Privacy notice"],
      ["/terms", "Terms of use"],
      ["/accessibility", "Accessibility statement"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Draft for owner review")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
    await expect(page.getByText(/WCAG\)? 2\.2 at Level AA/).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Report a barrier" })).toBeVisible();
  });
});

test.describe("profile", () => {
  test("participant11 saves a Vietnamese display name and time zone, sees both after reload, then restores them", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const uid = await userId(db, "participant11");
    const { data: original, error } = await db.from("profiles").select("display_name, timezone").eq("id", uid).single();
    if (error) throw error;
    const newName = "Nguyễn Thị Hồng Nhung";
    const newTz = original.timezone === "Asia/Ho_Chi_Minh" ? "Europe/Kyiv" : "Asia/Ho_Chi_Minh";

    const { context, page } = await signedIn(browser, "participant11");
    try {
      await page.goto("/profile");
      await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible({ timeout: 30_000 });
      // The email is shown to its owner, with a note that it stays private.
      await expect(page.getByTestId("account-email")).toHaveText(sampleEmail("participant11"));
      await expect(page.locator("main")).not.toContainText(/membership/i);

      const name = page.getByLabel(/^Display name/);
      const zone = page.getByLabel("Time zone", { exact: true });
      await expect(name).toHaveValue(original.display_name);
      await expect(zone).toHaveValue(original.timezone);

      await name.fill(newName);
      await page.getByLabel("Find a time zone").fill(newTz === "Asia/Ho_Chi_Minh" ? "Hà Nội" : "Kyiv");
      await expect(zone.locator(`option[value="${newTz}"]`)).toHaveCount(1);
      await zone.selectOption(newTz);
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Your details were saved.")).toBeVisible({ timeout: 20_000 });

      await page.reload();
      await expect(name).toHaveValue(newName);
      await expect(zone).toHaveValue(newTz);
      await expect(zone.locator("option:checked")).toHaveText(newTz === "Asia/Ho_Chi_Minh" ? "(UTC+07:00) Asia/Ho Chi Minh" : /Europe\/Kyiv/);
      const { data: saved } = await db.from("profiles").select("display_name, timezone").eq("id", uid).single();
      expect(saved).toEqual({ display_name: newName.normalize("NFC"), timezone: newTz });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      // A blank name is refused and nothing changes.
      await name.fill("   ");
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Enter a display name.")).toBeVisible({ timeout: 20_000 });

      // Restore the original values through the same form.
      await name.fill(original.display_name);
      await page.getByLabel("Find a time zone").fill("");
      await zone.selectOption(original.timezone);
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByText("Your details were saved.")).toBeVisible({ timeout: 20_000 });
      await page.reload();
      await expect(name).toHaveValue(original.display_name);
      await expect(zone).toHaveValue(original.timezone);
    } finally {
      await db.from("profiles").update({ display_name: original.display_name, timezone: original.timezone }).eq("id", uid);
      await context.close();
    }
  });
});

test.describe("catalog access requests", () => {
  let offeringId = "";
  let code = "";
  let title = "";

  test.beforeAll(async () => {
    // participant11 is enrolled in every open sample offering, so the request is made
    // against a fresh fixture offering that reuses a published sample course version.
    const db = service();
    const { data: course, error: courseError } = await db.from("courses").select("id, title").eq("code", "AIGE").single();
    if (courseError) throw courseError;
    const { data: version, error: versionError } = await db
      .from("course_versions")
      .select("id, title")
      .eq("course_id", course.id)
      .eq("status", "published")
      .order("version_no", { ascending: false })
      .limit(1)
      .single();
    if (versionError) throw versionError;
    code = `ACCT-${uniqueSuffix()}`.toUpperCase();
    title = version.title as string;
    const { data, error } = await db
      .from("course_offerings")
      .insert({
        course_id: course.id,
        course_version_id: version.id,
        cohort_id: await cohortId(db, SPRING_COHORT),
        code,
        term_label: "Account fixture term",
        starts_at: "2027-03-01T14:00:00Z",
        ends_at: "2027-05-28T14:00:00Z",
        timezone: "Asia/Ho_Chi_Minh",
        status: "published",
        catalog_visible: true,
        catalog_state: "open_for_requests",
      })
      .select("id")
      .single();
    if (error) throw error;
    offeringId = data.id as string;
  });

  test.afterAll(async () => {
    if (!offeringId) return;
    const db = service();
    await db.from("access_requests").delete().eq("offering_id", offeringId);
    await db.from("course_offerings").delete().eq("id", offeringId);
  });

  test("participant11 requests access, sees it pending, cannot request twice, and withdraws", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const uid = await userId(db, "participant11");
    const { context, page } = await signedIn(browser, "participant11");
    try {
      await page.goto(`/catalog?q=${code}`);
      const entry = page.getByTestId("catalog-entry").filter({ hasText: code });
      await expect(entry).toHaveCount(1);
      await expect(entry.getByText("Open for requests")).toBeVisible();
      // A second tab opened now still offers the request after the first tab sends it.
      const stale = await context.newPage();
      await stale.goto(`/catalog?q=${code}`);

      await entry.getByRole("button", { name: `Request access to ${title}` }).click();
      const dialog = page.getByRole("dialog", { name: `Request access to ${title}` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("does not enroll you");
      await expect(dialog).not.toContainText(/payment|price|purchase/i);
      await dialog.getByLabel(/^Message to program staff/).fill("Xin chào, tôi muốn tham gia khóa học này.");
      await expectNoAxeViolations(page);
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(entry.getByText("Request pending")).toBeVisible({ timeout: 20_000 });
      await expect(entry.getByText("Request sent to program staff. You are not enrolled until it is approved.")).toBeVisible();
      await expect(entry.getByRole("button", { name: /^Request access/ })).toHaveCount(0);

      const pending = await db.from("access_requests").select("id, status, message").eq("offering_id", offeringId).eq("user_id", uid);
      expect(pending.data).toHaveLength(1);
      expect(pending.data?.[0]).toMatchObject({ status: "pending", message: "Xin chào, tôi muốn tham gia khóa học này." });
      const enrolled = await db.from("enrollments").select("user_id").eq("offering_id", offeringId).eq("user_id", uid);
      expect(enrolled.data).toHaveLength(0);

      // The stale tab tries again: the server refuses a second pending request.
      const staleEntry = stale.getByTestId("catalog-entry").filter({ hasText: code });
      await staleEntry.getByRole("button", { name: `Request access to ${title}` }).click();
      const staleDialog = stale.getByRole("dialog", { name: `Request access to ${title}` });
      await staleDialog.getByRole("button", { name: "Send request" }).click();
      await expect(staleDialog.getByText("You already have a pending request for this offering.", { exact: false })).toBeVisible({ timeout: 20_000 });
      const stillOne = await db.from("access_requests").select("id").eq("offering_id", offeringId).eq("user_id", uid).eq("status", "pending");
      expect(stillOne.data).toHaveLength(1);
      await stale.close();

      // Withdraw the request; the entry offers a new request again.
      await entry.getByRole("button", { name: `Withdraw request for ${title}` }).click();
      const confirm = page.getByRole("dialog", { name: "Withdraw your request?" });
      await confirm.getByRole("button", { name: "Withdraw request" }).click();
      await expect(entry.getByText("Request withdrawn.")).toBeVisible({ timeout: 20_000 });
      await expect(entry.getByText("Open for requests")).toBeVisible();
      const after = await db.from("access_requests").select("status").eq("offering_id", offeringId).eq("user_id", uid);
      expect(after.data?.map((r) => r.status)).toEqual(["withdrawn"]);
      await expectNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });
});

test.describe("tools", () => {
  test("staff manage a course resource; learners see it only while published and cannot create one", async ({ browser }) => {
    test.setTimeout(240_000);
    const db = service();
    const suffix = uniqueSuffix();
    const title = `Account check resource ${suffix}`;
    const forged = `Account forged resource ${suffix}`;
    const { data: aaf, error } = await db.from("course_offerings").select("id").eq("code", "AAF-S27").single();
    if (error) throw error;

    const staff = await signedIn(browser, "mai.tran");
    const learner = await signedIn(browser, "participant11");
    try {
      await test.step("the learner has no authoring controls", async () => {
        await learner.page.goto("/tools");
        await expect(learner.page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible({ timeout: 30_000 });
        await expect(learner.page.getByTestId("tool-entry").first()).toBeVisible();
        await expect(learner.page.getByRole("link", { name: "Add resource" })).toHaveCount(0);
        await expect(learner.page.getByRole("link", { name: /^Edit / })).toHaveCount(0);
        await expect(learner.page.getByRole("button", { name: /^Archive/ })).toHaveCount(0);
        await expectNoAxeViolations(learner.page);
        await learner.page.goto("/tools/new");
        await expect(learner.page.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible({ timeout: 30_000 });
        await expect(learner.page.getByLabel(/^Title/)).toHaveCount(0);
      });

      await test.step("staff create a published course resource with an https link and Markdown details", async () => {
        await staff.page.goto("/tools");
        await staff.page.getByRole("link", { name: "Add resource" }).click();
        await expect(staff.page.getByRole("heading", { level: 1, name: "Add a resource" })).toBeVisible({ timeout: 30_000 });
        const scope = staff.page.getByLabel(/^Who can see it/);
        // Only courses the instructor teaches are offered: no platform-wide or cohort
        // scopes, and not MASS-F26, which she does not teach.
        await expect(scope.locator("option", { hasText: "AAF-S27" })).toHaveCount(1);
        const options = await scope.locator("option").allInnerTexts();
        expect(options.filter((o) => /MASS-F26|^Platform-wide|^Cohort:/.test(o))).toEqual([]);
        await scope.selectOption(`offering:${aaf.id}`);
        await staff.page.getByLabel(/^Category/).selectOption("setup");
        await staff.page.getByLabel(/^Title/).fill(title);
        await staff.page.getByLabel("Short description").fill("Check your browser and microphone before the first session.");
        await staff.page.getByLabel("Link", { exact: true }).fill("http://example.org/setup");
        await staff.page.getByLabel("Details", { exact: true }).fill("Install **the latest browser** first.\n\n- Test audio\n- Test video\n\n<script>alert('x')</script>");
        await staff.page.getByRole("button", { name: "Save resource" }).click();
        await expect(staff.page.getByText("Links must be full web addresses starting with https://", { exact: false })).toBeVisible({ timeout: 20_000 });
        await expect(staff.page.getByLabel(/^Title/)).toHaveValue(title);
        await staff.page.getByLabel("Link", { exact: true }).fill("https://example.org/setup");
        await staff.page.getByRole("button", { name: "Save resource" }).click();
        await expect(staff.page).toHaveURL(/\/tools\?notice=saved&tool=/, { timeout: 30_000 });
        await expect(staff.page.getByText("Resource saved.")).toBeVisible();
        const item = staff.page.getByTestId("tool-entry").filter({ hasText: title });
        await expect(item).toHaveAttribute("data-state", "published");
        await expect(item.getByRole("link", { name: `${title} (opens in a new tab)` })).toHaveAttribute("href", "https://example.org/setup");
        await item.locator("summary").click();
        await expect(item.locator(".rich-text strong")).toHaveText("the latest browser");
        await expect(item.locator(".rich-text script")).toHaveCount(0);
        const { data: row } = await db.from("tool_resources").select("body_html, published").eq("title", title).single();
        expect(row?.body_html).not.toContain("<script");
        expect(row?.published).toBe(true);
        await expectNoAxeViolations(staff.page);
      });

      await test.step("the learner in that course sees the published resource", async () => {
        await learner.page.goto("/tools?category=setup");
        const item = learner.page.getByTestId("tool-entry").filter({ hasText: title });
        await expect(item).toBeVisible();
        await expect(item).toContainText("Course: AAF-S27");
        await expect(item.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
      });

      await test.step("a draft is hidden from the learner", async () => {
        const item = staff.page.getByTestId("tool-entry").filter({ hasText: title });
        await item.getByRole("link", { name: `Edit ${title}` }).click();
        await expect(staff.page.getByRole("heading", { level: 1, name: "Edit resource" })).toBeVisible({ timeout: 30_000 });
        await staff.page.getByLabel(/^Published/).uncheck();
        await staff.page.getByRole("button", { name: "Save resource" }).click();
        await expect(staff.page).toHaveURL(/notice=saved/, { timeout: 30_000 });
        await expect(staff.page.getByTestId("tool-entry").filter({ hasText: title })).toHaveAttribute("data-state", "draft");
        await learner.page.reload();
        await expect(learner.page.getByTestId("tool-entry").filter({ hasText: title })).toHaveCount(0);
      });

      await test.step("staff archive and restore it as a draft", async () => {
        const item = staff.page.getByTestId("tool-entry").filter({ hasText: title });
        await item.getByRole("button", { name: `Archive ${title}` }).click();
        await staff.page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
        await expect(staff.page).toHaveURL(/notice=archived/, { timeout: 30_000 });
        await expect(staff.page.getByText("Resource archived. Participants can no longer see it.")).toBeVisible();
        const archived = staff.page.getByTestId("tool-archived").getByTestId("tool-entry").filter({ hasText: title });
        await expect(archived).toHaveAttribute("data-state", "archived");
        await archived.getByRole("button", { name: `Restore ${title} as a draft` }).click();
        await expect(staff.page).toHaveURL(/notice=restored/, { timeout: 30_000 });
        await expect(staff.page.getByText("Resource restored as a draft.")).toBeVisible();
        await expect(staff.page.getByTestId("tool-entry").filter({ hasText: title })).toHaveAttribute("data-state", "draft");
      });

      await test.step("the server action refuses a learner even when the form is submitted", async () => {
        // The form is loaded as staff, then the session is swapped for the learner's
        // before submitting: the action must refuse on its own, not rely on hidden UI.
        await staff.page.goto(`/tools/new?scope=offering:${aaf.id}`);
        await staff.page.getByLabel(/^Title/).fill(forged);
        await staff.context.clearCookies();
        await staff.context.addCookies(await learner.context.cookies());
        await staff.page.getByRole("button", { name: "Save resource" }).click();
        await expect(staff.page.getByText("You cannot add or move resources to that scope.")).toBeVisible({ timeout: 20_000 });
        const { data } = await db.from("tool_resources").select("id").eq("title", forged);
        expect(data).toHaveLength(0);
      });

      await test.step("the database refuses the learner too", async () => {
        const asLearner = await supabaseAs("participant11");
        const { error: insertError } = await asLearner
          .from("tool_resources")
          .insert({ offering_id: aaf.id, category: "resource", title: forged, published: true })
          .select("id");
        expect(insertError).not.toBeNull();
        const { data } = await db.from("tool_resources").select("id").eq("title", forged);
        expect(data).toHaveLength(0);
        await asLearner.auth.signOut();
      });
    } finally {
      await db.from("tool_resources").delete().in("title", [title, forged]);
      await staff.context.close();
      await learner.context.close();
    }
  });
});

test.describe("invitations", () => {
  const created: string[] = [];
  let expiredId = "";
  let revokedId = "";
  let pendingId = "";
  let otherId = "";

  test.beforeAll(async () => {
    // Synthetic invitations inserted directly (email_status stays "not_sent"): no email is sent.
    const db = service();
    const spring = await cohortId(db, SPRING_COHORT);
    const email = sampleEmail("participant12");
    const day = 24 * 60 * 60 * 1000;
    const rows: Record<string, string>[] = [
      { email, role: "participant", cohort_id: spring, expires_at: new Date(Date.now() - 2 * day).toISOString() },
      { email, role: "participant", cohort_id: spring, revoked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      { email, role: "participant", cohort_id: spring },
      { email: `someone.else.${uniqueSuffix()}@sample.crewscaler.test`, role: "participant", cohort_id: spring },
    ];
    for (const row of rows) {
      const { data, error } = await db.from("invitations").insert(row).select("id").single();
      if (error) throw error;
      created.push(data.id as string);
    }
    [expiredId, revokedId, pendingId, otherId] = created;
  });

  test.afterAll(async () => {
    if (created.length === 0) return;
    const db = service();
    await db.from("notifications").delete().in("dedupe_key", created.map((id) => `invitation:${id}`));
    await db.from("invitations").delete().in("id", created);
  });

  test("participant12 sees truthful expired, revoked, wrong-account and accepted states", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedIn(browser, "participant12");
    try {
      await page.goto("/invite/accept");
      await expect(page.getByRole("heading", { level: 1, name: "Invitations" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("invite-signed-in-as")).toContainText(sampleEmail("participant12"));

      const expired = page.locator(`#invitation-${expiredId}`);
      await expect(expired).toHaveAttribute("data-state", "expired");
      await expect(expired).toContainText("Expired");
      await expect(expired).toContainText("This invitation expired on");
      await expect(expired).toContainText("Ask your program administrator to send a new one.");
      await expect(expired.getByRole("button")).toHaveCount(0);

      const revoked = page.locator(`#invitation-${revokedId}`);
      await expect(revoked).toHaveAttribute("data-state", "revoked");
      await expect(revoked).toContainText("Revoked");
      await expect(revoked).toContainText("This invitation was withdrawn by the program administrator.");
      await expect(revoked.getByRole("button")).toHaveCount(0);

      // Someone else's invitation is never listed, and its link explains the mismatch.
      await expect(page.locator(`#invitation-${otherId}`)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      await page.goto(`/invite/accept?invitation=${otherId}`);
      await expect(page.getByText("This invitation is not for this account")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();

      // participant12 already belongs to this cohort, so accepting changes no access.
      const pending = page.locator(`#invitation-${pendingId}`);
      await expect(pending).toHaveAttribute("data-state", "pending");
      await pending.getByRole("button", { name: /^Accept invitation/ }).click();
      await expect(page).toHaveURL(new RegExp(`accepted=${pendingId}`), { timeout: 30_000 });
      await expect(page.getByText("Invitation accepted")).toBeVisible();
      const used = page.locator(`#invitation-${pendingId}`);
      await expect(used).toHaveAttribute("data-state", "accepted");
      await expect(used).toContainText("This invitation has already been used.");
      await expect(used.getByRole("button")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("layout", () => {
  test("signed-in account pages fit phone, tablet and desktop widths @responsive", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "participant11");
    for (const [path, heading] of [
      ["/profile", "Profile"],
      ["/tools", "Tools"],
      ["/catalog", "Course Catalog"],
      ["/invite/accept", "Invitations"],
      ["/help", "Help"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
  });
});
