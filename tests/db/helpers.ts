import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly
}

export const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
export const PASSWORD = process.env.SEED_PASSWORD!;
export const DOMAIN = "sample.crewscaler.test";

export const EMAIL = {
  admin: `admin@${DOMAIN}`,
  mai: `mai.tran@${DOMAIN}`,
  daniel: `daniel.okafor@${DOMAIN}`,
  linh: `linh.pham@${DOMAIN}`,
  p: (n: number) => `participant${String(n).padStart(2, "0")}@${DOMAIN}`,
};

const clients = new Map<string, SupabaseClient>();

/** A real API client signed in as a seeded user (PostgREST + Storage + Auth, RLS applies). */
export async function as(email: string): Promise<SupabaseClient> {
  const cached = clients.get(email);
  if (cached) return cached;
  const c = createClient(API_URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  clients.set(email, c);
  return c;
}

export function anon(): SupabaseClient {
  return createClient(API_URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

let pg: Client | null = null;
/** Superuser-ish connection for fixture lookups/adjustments only (never for assertions of access). */
export async function db(): Promise<Client> {
  if (!pg) {
    pg = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    await pg.connect();
  }
  return pg;
}

export async function closeDb() {
  await pg?.end();
  pg = null;
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await (await db()).query(sql, params);
  if (!rows[0]) throw new Error(`no row for: ${sql}`);
  return rows[0] as T;
}

export async function userId(email: string): Promise<string> {
  return (await one<{ id: string }>("select id from auth.users where email = $1", [email])).id;
}

export async function offeringId(code: string): Promise<string> {
  return (await one<{ id: string }>("select id from public.course_offerings where code = $1", [code])).id;
}
