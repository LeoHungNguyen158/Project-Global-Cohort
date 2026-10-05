import { Client } from "pg";

// Load .env.local when present; real environment variables take precedence.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no local env file (CI or staging shell)
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost", "::1", "host.docker.internal"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: requireEnv("SUPABASE_DB_URL") });
  await client.connect();
  return client;
}

/**
 * Run SQL as a specific authenticated user (role + JWT claims), exactly as PostgREST
 * would, so seeds and tests exercise real RLS, grants and RPC checks.
 */
export async function asUser<T>(db: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await db.query("set local role authenticated");
    const out = await fn();
    await db.query("commit");
    return out;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
