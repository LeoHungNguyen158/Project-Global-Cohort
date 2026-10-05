// Load a data-only database dump into a freshly migrated target database.
//
// Make the dump (from an authorized workstation; schemas public, auth and private hold the
// app's records, accounts, answer keys and results):
//   npx supabase db dump --db-url "$SOURCE_DB_URL" --data-only --schema public,auth,private -f backups/<date>/data.sql
//
// Restore it into a target that has the migrations applied and no accounts yet:
//   SUPABASE_DB_URL=<target> npm run restore:db -- --from backups/<date>/data.sql          # checks only
//   SUPABASE_DB_URL=<target> npm run restore:db -- --from backups/<date>/data.sql --yes    # loads
//
// Safety: a target that already has accounts is refused unless --replace; a non-local
// target needs --confirm-target <its host>; APP_ENV=production needs --confirm-production.
// Rows the migrations created (default settings and limits) are replaced by the backup's.
// Files are restored separately with `npm run restore:storage`.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { connect, isLocalUrl, requireEnv } from "./lib/db";
import { argValue, fail, guardProduction, hasFlag } from "./lib/cli";

const CHECK_TABLES = [
  "auth.users",
  "public.profiles",
  "public.cohorts",
  "public.course_offerings",
  "public.enrollments",
  "public.content_assets",
  "public.submissions",
  "public.quiz_attempts",
  "public.grades",
  "public.messages",
  "private.answer_keys",
];

async function main() {
  const from = argValue("--from");
  if (!from) fail("Pass the dump file: --from <data.sql> (made with supabase db dump --data-only).");
  const file = resolve(from);
  if (!existsSync(file)) fail(`No such file: ${file}`);
  const sql = readFileSync(file, "utf8");

  const tables = [...new Set([...sql.matchAll(/^INSERT INTO "([^"]+)"\."([^"]+)"/gm)].map((m) => `"${m[1]}"."${m[2]}"`))];
  if (tables.length === 0) fail("The file contains no INSERT statements. Use a data-only dump (--data-only).");
  if (/^CREATE (TABLE|SCHEMA|FUNCTION|OR REPLACE FUNCTION) (IF NOT EXISTS )?"/m.test(sql)) fail("The file contains schema statements. Use a data-only dump; apply migrations to the target instead.");

  const url = requireEnv("SUPABASE_DB_URL");
  const host = new URL(url).hostname;
  if (!isLocalUrl(url) && argValue("--confirm-target") !== host) {
    fail(`The target database is ${host}, not a local stack. Re-run with --confirm-target ${host} if it is a disposable or recovery project.`);
  }
  const apply = hasFlag("--yes");
  if (apply) guardProduction();

  const db = await connect();
  try {
    const accounts = Number((await db.query("select count(*)::int as n from auth.users")).rows[0].n);
    if (accounts > 0 && !hasFlag("--replace")) {
      fail(`The target already has ${accounts} account(s). Restore into an empty, freshly migrated project, or pass --replace to discard its data.`);
    }
    const nonEmpty: string[] = [];
    for (const t of tables) {
      const exists = await db.query("select to_regclass($1) is not null as ok", [t]);
      if (!exists.rows[0].ok) fail(`The target has no table ${t}. Apply the same migrations as the source first.`);
      if ((await db.query(`select exists (select 1 from ${t}) as has`)).rows[0].has) nonEmpty.push(t);
    }
    console.log(`Dump:   ${file} (${tables.length} tables)`);
    console.log(`Target: ${host}${isLocalUrl(url) ? " (local)" : ""}${apply ? "" : "  (check only; add --yes to load)"}`);
    console.log(`Tables in the target that will be cleared first: ${nonEmpty.length ? nonEmpty.join(", ") : "none"}`);
    if (!apply) return;

    const started = Date.now();
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      if (nonEmpty.length > 0) await db.query(`truncate ${nonEmpty.join(", ")} cascade`);
      await db.query(sql);
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
    console.log(`\nLoaded in ${((Date.now() - started) / 1000).toFixed(1)}s. Row counts now:`);
    for (const t of CHECK_TABLES) {
      const reg = await db.query("select to_regclass($1) is not null as ok", [t]);
      if (!reg.rows[0].ok) continue;
      const n = (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
      console.log(`  ${t.padEnd(26)} ${n}`);
    }
    console.log("\nNext: restore the files with `npm run restore:storage -- --from <storage folder> --yes --verify`.");
  } finally {
    await db.end();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
