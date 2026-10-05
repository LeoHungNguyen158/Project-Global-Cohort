import { afterAll, describe, expect, it } from "vitest";
import { as, closeDb, db, EMAIL } from "./helpers";

// Structural guarantees the data-level permission tests rely on. A new table, view, function
// or bucket that weakens one of them fails here, whatever data the seed happens to contain.

afterAll(closeDb);

async function names(sql: string): Promise<string[]> {
  const { rows } = await (await db()).query<{ name: string }>(sql);
  return rows.map((r) => r.name).sort();
}

/** Functions that visitors who are not signed in may call (both SECURITY DEFINER, both read-only). */
const ANON_FUNCTIONS = ["public.catalog_list()", "public.public_site_settings()"];

describe("schema invariants", () => {
  it("every table in the public schema has row-level security enabled", async () => {
    const off = await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(off).toEqual([]);
  });

  it("the public schema has no view that would bypass row-level security", async () => {
    // A view runs with its owner's rights unless security_invoker is set, so a plain view over
    // a protected table would hand every row to whoever can select from the view.
    const views = await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and (c.relkind = 'm'
        or (c.relkind = 'v' and not coalesce('security_invoker=true' = any(c.reloptions), false)))`);
    expect(views).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const unpinned = await names(`
      select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(unpinned).toEqual([]);
  });

  it("visitors who are not signed in can read no table and call only the public catalog and site settings", async () => {
    const tables = await names(`
      select distinct c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace,
        unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) priv
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, priv)`);
    expect(tables).toEqual([]);

    const sequences = await names(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('anon', c.oid, 'update'))`);
    expect(sequences).toEqual([]);

    const functions = await names(`
      select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(functions.filter((f) => !ANON_FUNCTIONS.includes(f))).toEqual([]);
    expect(functions).toContain("public.catalog_list()");

    const { rows } = await (await db()).query("select has_schema_privilege('anon', 'private', 'usage') as usage");
    expect(rows[0].usage).toBe(false);
  });

  it("signed-in users hold no table privileges beyond select, insert, update and delete", async () => {
    const extra = await names(`
      select distinct c.relname || ' ' || priv as name from pg_class c join pg_namespace n on n.oid = c.relnamespace,
        unnest(array['truncate', 'references', 'trigger']) priv
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('authenticated', c.oid, priv)`);
    expect(extra).toEqual([]);
  });

  it("no one but the database owner can read or change tables in the private schema", async () => {
    const reachable = await names(`
      select distinct c.relname || ' ' || r.role as name from pg_class c join pg_namespace n on n.oid = c.relnamespace,
        unnest(array['anon', 'authenticated']) r(role),
        unnest(array['select', 'insert', 'update', 'delete', 'truncate']) priv
      where n.nspname = 'private' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege(r.role, c.oid, priv)`);
    expect(reachable).toEqual([]);
  });

  it("the private schema is not reachable through the Data API", async () => {
    const sb = await as(EMAIL.p(1));
    const rpc = await sb.schema("private").rpc("is_platform_admin");
    expect(rpc.error?.code).toBe("PGRST106");
    const table = await sb.schema("private").from("answer_keys").select("*").limit(1);
    expect(table.error?.code).toBe("PGRST106");
    expect(table.data).toBeNull();
  });

  it("every private helper that a row-level policy calls is executable by signed-in users", async () => {
    // Otherwise the policy fails with "permission denied" for everyone it should admit.
    const { rows } = await (await db()).query<{ expr: string }>(`
      select coalesce(pg_get_expr(polqual, polrelid), '') || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '') as expr
      from pg_policy`);
    const helpers = new Set(rows.flatMap((r) => [...r.expr.matchAll(/private\.([a-z_][a-z0-9_]*)\(/g)].map((m) => m[1])));
    expect(helpers.size).toBeGreaterThan(0);
    const blocked = await names(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = any(array[${[...helpers].map((h) => `'${h}'`).join(", ")}])
        and not has_function_privilege('authenticated', p.oid, 'execute')`);
    expect(blocked).toEqual([]);
  });

  it("signed-in users can execute only the private helpers that policies and their own triggers need", async () => {
    // Policies run as the signed-in user, and so do SECURITY INVOKER guard triggers that call
    // private.purge_allowed(). Everything else in the private schema (for example
    // release_grade(grade, actor) or notify(user, …)) runs only inside definer functions.
    const { rows } = await (await db()).query<{ expr: string }>(`
      select coalesce(pg_get_expr(polqual, polrelid), '') || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '') as expr
      from pg_policy
      union all
      select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and not p.prosecdef`);
    const needed = new Set(rows.flatMap((r) => [...r.expr.matchAll(/private\.([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1])));
    const executable = await names(`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')`);
    expect(executable.filter((f) => !needed.has(f))).toEqual([]);
  });

  it("every storage bucket is private and has a size limit", async () => {
    const { rows } = await (await db()).query<{ id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }>(
      "select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id",
    );
    expect(rows.map((b) => b.id)).toEqual(["avatars", "course-content", "message-attachments", "submissions"]);
    for (const b of rows) {
      expect(b.public, b.id).toBe(false);
      expect(b.file_size_limit, b.id).not.toBeNull();
    }
    const avatars = rows.find((b) => b.id === "avatars")!;
    expect(avatars.allowed_mime_types?.every((t) => t.startsWith("image/"))).toBe(true);
  });
});
