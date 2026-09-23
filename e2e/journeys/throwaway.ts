/**
 * THROWAWAY ACCOUNTS for the journeys that must not touch a shared account
 * (docs/OPEN.md Q226 ban enforcement, Q253 no-show).
 *
 * Banning helper-e2e or poster-e2e locks every other lane out, and a no-show
 * report writes a strike (ban_status = final_warning, a user_violations row)
 * onto the Helpr it names. So those journeys run on a per-run, is_seed,
 * @mailinator account created here with the service-role key and deleted
 * again in the journey's cleanup.
 *
 * SAFETY is the email: every destructive helper below re-reads the auth user
 * and refuses anything whose address is not THROWAWAY_EMAIL_RE, whose profile
 * is not is_seed, or which is one of the shared accounts. It fails closed.
 *
 * The service-role key comes from SUPABASE_SERVICE_ROLE_KEY (the e2e-journeys
 * workflow sets it, fetched the way privacy-journey.yml does) or the gitignored
 * local .env. Without it these journeys cannot run: in CI that is a failure,
 * locally a stated skip.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { ANON, PNG_1PX, SUPABASE_URL, type Session } from "./fixtures";

export const THROWAWAY_EMAIL_RE = /^helpr-journey-throwaway-[a-z0-9]{6,20}@mailinator\.com$/;

/** The shared accounts: never a throwaway, whatever else matches. */
const SHARED_IDS = new Set([
  "71c56dfb-b326-4010-b960-b18dd3966e7f", // poster-e2e
  "437de07d-1bd7-46c8-a451-6b46aa3bcad5", // helper-e2e
]);

export function serviceKey(): string | null {
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let url = "";
  const envFile = join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
      if (m[1] === "VITE_SUPABASE_URL") url = v.replace(/\/$/, "");
    }
  }
  if (!key) return null;
  if (url && url !== SUPABASE_URL) throw new Error(`the service key in .env is for ${url}; the suite targets ${SUPABASE_URL}`);
  return key;
}

export const sr = (key: string, extra: Record<string, string> = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

export type Throwaway = { userId: string; email: string; session: Session };

async function ok(r: { ok(): boolean; status(): number; text(): Promise<string> }, what: string) {
  const body = await r.text();
  if (!r.ok()) throw new Error(`${what}: HTTP ${r.status()} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

/** Create, complete (so ProtectedRoute lets it past /complete-profile) and sign in one throwaway. */
export async function createThrowaway(api: APIRequestContext, key: string, label: string): Promise<Throwaway> {
  const tag = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const email = `helpr-journey-throwaway-${tag}@mailinator.com`;
  if (!THROWAWAY_EMAIL_RE.test(email)) throw new Error(`generated ${email} does not match THROWAWAY_EMAIL_RE`);
  const password = randomBytes(24).toString("base64url");
  const user = await ok(
    await api.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
      headers: sr(key),
      data: { email, password, email_confirm: true, user_metadata: { full_name: `SEED Journey ${label}` } },
    }),
    `create ${email}`,
  );
  const userId = String(user.id);
  // The profile row comes from the signup trigger.
  for (let i = 0; i < 20; i++) {
    const rows = await ok(await api.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=user_id`, { headers: sr(key) }), "read profile");
    if (rows.length) break;
    if (i === 19) throw new Error(`no profile row for ${email} after signup`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const grant = await ok(
    await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, "Content-Type": "application/json" },
      data: { email, password },
      timeout: 45_000,
    }),
    `sign in ${email}`,
  );
  const session = grant as Session;
  // Avatar through the user's own session (the bucket policy is the real one).
  const avatarPath = `${userId}/journey-throwaway.png`;
  await ok(
    await api.post(`${SUPABASE_URL}/storage/v1/object/avatars/${avatarPath}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "image/png", "x-upsert": "true" },
      data: PNG_1PX,
    }),
    "avatar upload",
  );
  const patched = await ok(
    await api.patch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=user_id`, {
      headers: sr(key, { Prefer: "return=representation" }),
      data: {
        is_seed: true,
        full_name: `SEED Journey ${label}`,
        avatar_url: `${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPath}`,
        phone: `504555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`,
        date_of_birth: "1990-01-01",
        location: "Baton Rouge, LA",
        terms_version_accepted: "Jun 2026",
        terms_accepted_at: new Date().toISOString(),
        email_verified: true,
        // The jobs INSERT policy requires a verified identity (measured: an
        // unverified throwaway's post is refused 42501 by RLS, before any ban).
        idv_status: "verified",
      },
    }),
    "complete the throwaway profile",
  );
  if (patched.length !== 1) throw new Error(`completing ${email}'s profile matched ${patched.length} rows`);
  await requireThrowaway(api, key, userId);
  return { userId, email, session };
}

/** Fail closed unless `userId` is a throwaway this module made: email, is_seed, not shared. */
export async function requireThrowaway(api: APIRequestContext, key: string, userId: string): Promise<void> {
  if (SHARED_IDS.has(userId)) throw new Error(`REFUSED: ${userId} is a shared test account`);
  const u = await ok(await api.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sr(key) }), `read auth user ${userId}`);
  if (!THROWAWAY_EMAIL_RE.test(String(u.email ?? ""))) throw new Error(`REFUSED: ${userId} (${u.email}) is not a journey throwaway`);
  const [p] = await ok(await api.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=is_seed`, { headers: sr(key) }), "read is_seed");
  if (p && p.is_seed !== true) throw new Error(`REFUSED: ${userId} is not is_seed`);
}

/**
 * Delete a throwaway and every row it left, then PROVE it: the rows that do
 * not cascade from auth.users (notification_preferences has no FK, Q282) are
 * deleted first, and the counts are re-read afterwards. Returns a line per
 * table for the report annotation.
 */
export async function deleteThrowaway(api: APIRequestContext, key: string, userId: string): Promise<string[]> {
  await requireThrowaway(api, key, userId);
  const out: string[] = [];
  const TABLES: Array<[string, string]> = [
    ["user_violations", "user_id"],
    ["user_bans", "user_id"],
    ["notifications", "user_id"],
    ["notification_preferences", "user_id"],
    ["applications", "helper_id"],
    ["saved_searches", "user_id"],
  ];
  for (const [table, col] of TABLES) {
    const r = await api.delete(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${userId}&select=${col}`, {
      headers: sr(key, { Prefer: "return=representation" }),
    });
    const rows = await ok(r, `delete ${table}`);
    out.push(`${table}: ${rows.length} deleted`);
  }
  // Jobs it posted (the ban journey's positive control): unpaid, is_seed.
  const jobs = await ok(
    await api.delete(`${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${userId}&is_seed=eq.true&select=id`, { headers: sr(key, { Prefer: "return=representation" }) }),
    "delete throwaway jobs",
  );
  out.push(`jobs: ${jobs.length} deleted`);
  await api.delete(`${SUPABASE_URL}/storage/v1/object/avatars/${userId}/journey-throwaway.png`, { headers: sr(key) });
  const del = await api.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sr(key) });
  if (!del.ok() && del.status() !== 404) throw new Error(`delete auth user ${userId}: HTTP ${del.status()} ${await del.text()}`);
  // Verify: nothing with this id remains.
  const left: string[] = [];
  for (const [table, col] of [...TABLES, ["profiles", "user_id"] as [string, string], ["jobs", "customer_id"] as [string, string]]) {
    const rows = await ok(await api.get(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${userId}&select=${col}`, { headers: sr(key) }), `re-read ${table}`);
    if (rows.length) left.push(`${table}: ${rows.length}`);
  }
  const gone = await api.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sr(key) });
  if (gone.ok()) left.push("auth.users: 1");
  if (left.length) throw new Error(`throwaway ${userId} left rows behind: ${left.join(", ")}`);
  out.push("auth user deleted; 0 rows left in any table checked");
  return out;
}
