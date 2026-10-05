// Grant the first platform administrator to an existing, verified account.
//
//   npm run admin:bootstrap -- --user-id <uuid>          # shows what would happen
//   npm run admin:bootstrap -- --user-id <uuid> --yes    # grants the role
//
// The account is identified only by its exact auth user id (Supabase Dashboard →
// Authentication → Users). Nothing is inferred from sign-up order, email or display
// name. Later administrators are granted in Administration → Users, where the granting
// person is recorded; this command refuses when an administrator already exists unless
// --additional is passed.
import { adminClient, targetDescription } from "./lib/admin-client";
import { argValue, fail, hasFlag } from "./lib/cli";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const userId = argValue("--user-id");
  if (!userId || !UUID.test(userId)) {
    fail("Pass the account's auth user id: --user-id <uuid> (Supabase Dashboard → Authentication → Users).");
  }
  const apply = hasFlag("--yes");
  const sb = adminClient();
  console.log(`Target project: ${targetDescription()}`);

  const { data: found, error } = await sb.auth.admin.getUserById(userId);
  if (error || !found?.user) fail("No account with this user id exists in the target project.");
  const user = found.user;
  if (!user.email_confirmed_at) {
    fail("This account has not confirmed its email address. Ask the person to accept the invitation (or confirm their email) first.");
  }
  if (user.banned_until && new Date(user.banned_until) > new Date()) fail("This account is banned in Supabase Auth.");

  const { data: profile, error: profileError } = await sb.from("profiles").select("id, display_name, suspended_at").eq("id", userId).maybeSingle();
  if (profileError) fail(`Could not read the profile: ${profileError.message}`);
  if (!profile) fail("This account has no profile yet. Have the person sign in once, then run the command again.");
  if (profile.suspended_at) fail("This account is suspended in the app. Reactivate it first.");

  const { data: admins, error: grantsError } = await sb
    .from("platform_role_grants")
    .select("user_id")
    .eq("role", "platform_admin")
    .is("revoked_at", null);
  if (grantsError) fail(`Could not read existing roles: ${grantsError.message}`);
  const others = (admins ?? []).filter((g) => g.user_id !== userId).length;

  console.log(`Account:        ${user.email} (${profile.display_name})`);
  console.log(`Email verified: ${user.email_confirmed_at}`);
  console.log(`Existing platform administrators: ${(admins ?? []).length}`);

  if ((admins ?? []).some((g) => g.user_id === userId)) {
    console.log("\nThis account is already a platform administrator. Nothing changed.");
    return;
  }
  if (others > 0 && !hasFlag("--additional")) {
    fail(
      `${others} platform administrator(s) already exist. Grant more administrators in Administration → Users so the ` +
        "granting person is recorded, or re-run with --additional if that is not possible.",
    );
  }
  if (!apply) {
    console.log("\nDry run: nothing changed. Re-run with --yes to grant the platform administrator role to this account.");
    return;
  }

  const { error: insertError } = await sb.from("platform_role_grants").insert({ user_id: userId, role: "platform_admin" });
  if (insertError) fail(`Could not grant the role: ${insertError.message}`);
  // The grant itself is audited by a database trigger; this event records how it was made.
  const { error: auditError } = await sb.from("audit_events").insert({
    actor_id: null,
    action: "bootstrap_admin",
    target_table: "platform_role_grants",
    target_id: userId,
    metadata: { via: "npm run admin:bootstrap", additional: others > 0 },
  });
  if (auditError) console.warn(`Warning: the role was granted but the extra audit note failed: ${auditError.message}`);
  console.log("\nGranted. The account sees Administration after its next page load.");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
