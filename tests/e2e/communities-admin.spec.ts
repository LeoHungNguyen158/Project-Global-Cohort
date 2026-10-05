import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Administration → Communities. Everything that changes state happens in a cohort and
// communities this spec creates (unique names and codes), to synthetic accounts created
// here on the sample domain. Seeded cohorts, communities and people are only read.
// afterAll removes what the run created.

const NOT_AVAILABLE = { level: 1, name: "Page not available" } as const;
const S = uniqueSuffix();
const COHORT_CODE = `CMT-E2E-${S}`;
const COHORT_NAME = `Community test cohort ${S}`;
const PROGRAM_COMMUNITY = `Program circle ${S}`;
const COHORT_COMMUNITY = `Cohort circle ${S}`;
const COORDINATOR = { email: sampleEmail(`cmt-coord-${S}`), name: `E2E Community Coordinator ${S}` };
const IN_COHORT = { email: sampleEmail(`cmt-in-${S}`), name: `E2E Community Member ${S}` };
const OUTSIDER = { email: sampleEmail(`cmt-out-${S}`), name: `E2E Community Outsider ${S}` };
const PEOPLE = [COORDINATOR, IN_COHORT, OUTSIDER];

function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for the community fixtures.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signed-in client for a sample account, for fixture steps an administrator would do elsewhere. */
async function supabaseAs(email: string): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return client;
}

async function signedIn(browser: Browser, who: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

/** Outcome announced at page level after row actions (the admin flash region). */
function flash(page: Page): Locator {
  return page.getByTestId("admin-flash");
}

async function confirmIn(page: Page, confirmLabel: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Opens a page and waits until it is idle (hydrated), so forms run their client-side handlers. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const state: { ids: Record<string, string>; cohortId?: string; programCommunityId?: string; cohortCommunityId?: string } = { ids: {} };

test.describe("community administration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const db = service();
    for (const person of PEOPLE) {
      const { data, error } = await db.auth.admin.createUser({
        email: person.email,
        password: process.env.SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: person.name },
      });
      if (error) throw error;
      state.ids[person.email] = data.user.id;
    }
    // The cohort is created as the sample administrator (flagged as sample data like other admin-made test records).
    const admin = await supabaseAs(sampleEmail("admin"));
    const { data: cohort, error } = await admin.from("cohorts").insert({ code: COHORT_CODE, name: COHORT_NAME, status: "active" }).select("id").single();
    if (error) throw error;
    state.cohortId = cohort.id;
    const steps = [
      db.from("cohort_participation").insert({ cohort_id: cohort.id, user_id: state.ids[IN_COHORT.email] }),
      db.from("platform_role_grants").insert({ user_id: state.ids[COORDINATOR.email], role: "coordinator" }),
      db.from("coordinator_scopes").insert({ user_id: state.ids[COORDINATOR.email], cohort_id: cohort.id }),
    ];
    for (const step of steps) {
      const { error: stepError } = await step;
      if (stepError) throw stepError;
    }
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    const db = service();
    const problems: string[] = [];
    const run = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) problems.push(`${label}: ${error.message}`);
    };
    await run("communities", db.from("communities").delete().like("name", `%${S}`));
    if (state.cohortId) {
      await run("participation", db.from("cohort_participation").delete().eq("cohort_id", state.cohortId));
      await run("cohort", db.from("cohorts").delete().eq("id", state.cohortId));
    }
    const ids = Object.values(state.ids);
    // Audit rows written by the synthetic accounts reference their profiles; they are this run's artifacts.
    if (ids.length) await run("audit", db.from("audit_events").delete().in("actor_id", ids));
    for (const id of ids) await run(`delete ${id}`, db.auth.admin.deleteUser(id));
    expect(problems, "cleanup").toEqual([]);
  });

  test("a platform administrator creates an invitation-only community and adds and removes a member", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    await signIn(page, "admin");
    await open(page, "/admin/communities");
    await expect(page.getByRole("navigation", { name: "Administration sections" }).getByRole("link", { name: "Communities" })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(page);

    await page.getByText("Create a community").click();
    await page.locator("#new-community-name").fill(PROGRAM_COMMUNITY);
    await page.locator("#new-community-description").fill("A synthetic community for the administration test.");
    await page.locator("#new-community-join-policy").selectOption("invite");
    await page.locator("#new-community-cohort").selectOption("");
    await page.getByRole("button", { name: "Create community" }).click();
    await page.waitForURL(/\/admin\/communities\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
    state.programCommunityId = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByText("Community created.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: PROGRAM_COMMUNITY })).toBeVisible();
    const { data: created } = await db.from("communities").select("cohort_id, join_policy").eq("id", state.programCommunityId!).single();
    expect(created).toEqual({ cohort_id: null, join_policy: "invite" });

    // Program-wide communities take an existing account by email address.
    await page.getByLabel("Add an existing account by email").fill(OUTSIDER.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(`${OUTSIDER.name} is now a member of this community.`)).toBeVisible({ timeout: 30_000 });
    const members = page.getByRole("table", { name: "Community members" });
    await expect(members.getByRole("row", { name: new RegExp(OUTSIDER.name) })).toContainText(OUTSIDER.email);
    await expectNoAxeViolations(page);

    // Adding the same person again is reported, not duplicated.
    await page.getByLabel("Add an existing account by email").fill(OUTSIDER.email);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText(`${OUTSIDER.name} is already a member of this community.`)).toBeVisible({ timeout: 30_000 });

    // The list shows the community with its policy and member count.
    await open(page, "/admin/communities");
    const row = page.getByRole("row", { name: new RegExp(PROGRAM_COMMUNITY) });
    await expect(row).toContainText("Program-wide");
    await expect(row).toContainText("Invitation only");
    await expect(row.getByRole("cell").last()).toHaveText("1");

    // Editing: open joining, then back to invitation only.
    await open(page, `/admin/communities/${state.programCommunityId}`);
    await page.locator("#edit-community-join-policy").selectOption("open");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Community saved.")).toBeVisible({ timeout: 30_000 });
    const policy = async () => (await db.from("communities").select("join_policy").eq("id", state.programCommunityId!).single()).data?.join_policy;
    expect(await policy()).toBe("open");
    await page.locator("#edit-community-join-policy").selectOption("invite");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(policy, { timeout: 30_000 }).toBe("invite");

    // Membership never grants course or cohort access.
    const outsiderId = state.ids[OUTSIDER.email];
    const [{ count: enrollments }, { count: participation }] = await Promise.all([
      db.from("enrollments").select("id", { count: "exact", head: true }).eq("user_id", outsiderId),
      db.from("cohort_participation").select("cohort_id", { count: "exact", head: true }).eq("user_id", outsiderId),
    ]);
    expect(enrollments).toBe(0);
    expect(participation).toBe(0);

    await page.getByRole("button", { name: `Remove ${OUTSIDER.name} from this community` }).click();
    await confirmIn(page, "Remove");
    await expect(flash(page)).toContainText("Member removed.");
    await expect(page.getByText("No members yet.")).toBeVisible();
    const { count: left } = await db.from("community_members").select("user_id", { count: "exact", head: true }).eq("community_id", state.programCommunityId!);
    expect(left).toBe(0);

    await open(page, "/admin/audit?target=community_members");
    const entries = page.getByRole("list", { name: "Audit entries" }).getByRole("listitem");
    await expect(entries.filter({ hasText: "community.add_member" }).first()).toBeVisible();
    await expect(entries.filter({ hasText: "community.remove_member" }).first()).toBeVisible();
  });

  test("a cohort coordinator manages only their cohort's communities and sees no email addresses", async ({ browser }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: lounge } = await db.from("communities").select("id").is("cohort_id", null).eq("is_sample", true).limit(1).single();

    const coordinator = await signedIn(browser, COORDINATOR.email);
    const c = coordinator.page;
    await open(c, "/admin/communities");
    await expect(c.getByRole("navigation", { name: "Administration sections" }).getByRole("link", { name: "Communities" })).toBeVisible();
    await expect(c.getByText("You manage the communities of the cohorts you coordinate.")).toBeVisible();
    // Only communities of their own cohort are listed (none yet), and program-wide is not offered.
    await expect(c.getByText(PROGRAM_COMMUNITY)).toHaveCount(0);
    await c.getByText("Create a community").click();
    await expect(c.locator("#new-community-cohort option")).toHaveCount(1);
    await expect(c.locator("#new-community-cohort option").first()).toHaveText(`${COHORT_NAME} (${COHORT_CODE})`);
    await c.locator("#new-community-name").fill(COHORT_COMMUNITY);
    await c.locator("#new-community-join-policy").selectOption("invite");
    await c.getByRole("button", { name: "Create community" }).click();
    await c.waitForURL(/\/admin\/communities\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
    state.cohortCommunityId = new URL(c.url()).pathname.split("/").pop();
    await c.waitForLoadState("networkidle");

    // Candidates are the cohort's people; the outsider is not offered.
    const options = c.locator("#add-member option");
    await expect(options.filter({ hasText: IN_COHORT.name })).toHaveCount(1);
    await expect(options.filter({ hasText: OUTSIDER.name })).toHaveCount(0);
    await c.locator("#add-member").selectOption({ label: IN_COHORT.name });
    await c.getByRole("button", { name: "Add member" }).click();
    await expect(c.getByText(`${IN_COHORT.name} is now a member of this community.`)).toBeVisible({ timeout: 30_000 });
    await expect(c.getByRole("table", { name: "Community members" }).getByRole("row", { name: new RegExp(IN_COHORT.name) })).toBeVisible();
    await expect(c.locator("main")).not.toContainText("@sample.crewscaler.test");
    await expectNoAxeViolations(c);

    // Program-wide communities (seeded or created above) are for platform administrators.
    for (const id of [state.programCommunityId, lounge?.id].filter(Boolean)) {
      await open(c, `/admin/communities/${id}`);
      await expect(c.getByRole("heading", NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
    }
    await coordinator.context.close();

    const { data: membership } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", state.cohortCommunityId!);
    expect(membership).toEqual([{ user_id: state.ids[IN_COHORT.email] }]);
  });

  test("learners see who adds members of invitation-only communities and cannot join them", async ({ browser }) => {
    test.setTimeout(120_000);
    const learner = await signedIn(browser, IN_COHORT.email);
    const l = learner.page;

    // Member of the cohort community the coordinator added them to.
    await open(l, `/cohorts/communities/${state.cohortCommunityId}`);
    await expect(l.getByRole("heading", { level: 1, name: COHORT_COMMUNITY })).toBeVisible();
    await expect(l.getByText("Joined", { exact: true })).toBeVisible();
    await expect(l.getByRole("link", { name: "Manage community" })).toHaveCount(0);

    // Not a member of the program-wide invitation-only community: no Join button, accurate wording.
    await open(l, `/cohorts/communities/${state.programCommunityId}`);
    await expect(l.getByText("For all participants, by invitation")).toBeVisible();
    await expect(l.getByText("Joining is by invitation from a program or cohort administrator.").first()).toBeVisible();
    await expect(l.getByRole("button", { name: /^Join/ })).toHaveCount(0);
    // Administration stays closed to learners.
    await open(l, `/admin/communities/${state.cohortCommunityId}`);
    await expect(l.getByRole("heading", NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
    await learner.context.close();
  });

  test("administrators reach the management page from the community itself", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "admin");
    await open(page, `/cohorts/communities/${state.programCommunityId}`);
    await page.getByRole("link", { name: "Manage community" }).click();
    await page.waitForURL(new RegExp(`/admin/communities/${state.programCommunityId}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: PROGRAM_COMMUNITY })).toBeVisible();
  });
});

test.describe("community administration layout", () => {
  // Read-only: the seeded communities (one program-wide, one of the fall cohort).
  test("community administration pages fit 390, 768 and 1440 px and pass axe @responsive", async ({ page }) => {
    test.setTimeout(180_000);
    const db = service();
    const { data: seeded } = await db.from("communities").select("id").eq("is_sample", true).order("name");
    expect((seeded ?? []).length).toBeGreaterThan(0);
    await signIn(page, "admin");
    for (const path of ["/admin/communities", ...(seeded ?? []).map((c) => `/admin/communities/${c.id}`)]) {
      await open(page, path);
      await expect(page.getByRole("heading", { level: 1, name: "Administration" }), path).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
  });
});
