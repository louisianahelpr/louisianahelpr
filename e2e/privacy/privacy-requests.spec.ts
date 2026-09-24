import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  assertHealthy,
  getSession,
  newUserContext,
  sessionAvailable,
  SUPABASE_URL,
  ANON,
  E2E_TITLE_MARKER,
  PNG_1PX,
  type Session,
} from "../journeys/fixtures";
import {
  assertDisposable,
  disposableEmail,
  CONDITIONAL_PURGE_STEPS,
  EXPECTED_DB_COUNTS,
  EXPECTED_PURGE_STEPS,
  EXPORT_SECTIONS,
  IDENTITY_BUCKETS,
  KNOWN_NOT_EXPORTED,
} from "../../scripts/lib/privacyJourney.mjs";

/**
 * PRIVACY REQUESTS, END TO END, ON PROD (docs/OPEN.md Q70). Monthly:
 * .github/workflows/privacy-journey.yml.
 *
 *   create  a DISPOSABLE seed account (per-run mailinator address, is_seed),
 *           give it real data: two jobs (one the shared helper applied to, so
 *           it must OUTLIVE its poster), an avatar and a document in storage,
 *           a support report, notification preferences.
 *   export  press "Download My Data" on the Privacy panel, read the JSON the
 *           browser saves, and check every section, the profile and both jobs
 *           (the account has no applications or reviews to find), and that the
 *           seeded tables left out are exactly KNOWN_NOT_EXPORTED.
 *   delete  press Delete Account -> Continue -> type DELETE -> Delete Forever,
 *           exactly as a person does, and read the function's own step report.
 *   verify  each purge step BY NAME (EXPECTED_PURGE_STEPS), then the rows and
 *           objects themselves: auth user and profile gone, every identity
 *           bucket empty at <uid>/, the unhired job deleted, the applied-to job
 *           kept but redacted and ownerless, the report anonymised, the
 *           preferences deleted, and purge_user_data's own counters.
 *   outlive the helper who applied still gets a healthy Activity page with
 *           the ownerless job in their data (CLAUDE.md "a job can outlive its
 *           poster"); the kept row itself is asserted in verify.
 *
 * It must never touch a real account: every destructive call goes through
 * assertDisposable (scripts/lib/privacyJourney.mjs), which fails closed.
 * Cleanup removes the kept job, its application and the report row; if the
 * run dies before the UI delete, the disposable account is removed too.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (env, or the gitignored .env the workflow
 * writes) and the shared helper session. In CI a missing key FAILS; locally it
 * skips with the reason.
 */

// Guard-proof lines: each plants a defect the journey must catch.
// @mutate src/pages/legal/DataExportCard.tsx |         jobs: jobsRes.data,\n |         jobs: [],\n

function readServiceEnv(): { url: string; key: string } | null {
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let url = process.env.SUPABASE_URL ?? "";
  const envFile = join(process.cwd(), ".env");
  if ((!key || !url) && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
      if (m[1] === "VITE_SUPABASE_URL" && !url) url = v;
    }
  }
  url = (url || SUPABASE_URL).replace(/\/$/, "");
  if (!key) return null;
  // The key must be for the project the app under test talks to.
  if (url !== SUPABASE_URL) throw new Error(`service key is for ${url}, the suite targets ${SUPABASE_URL}`);
  return { url, key };
}

const svc = readServiceEnv();
const SR: Record<string, string> = svc ? { apikey: svc.key, Authorization: `Bearer ${svc.key}`, "Content-Type": "application/json" } : {};
const RUN_TAG = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`.slice(0, 16);
const RUN_STARTED = Date.now();
const EMAIL = disposableEmail(RUN_TAG);
const PASSWORD = randomBytes(24).toString("base64url");
const MARK = `${E2E_TITLE_MARKER} privacy-journey ${RUN_TAG}`;

test.describe.configure({ mode: "serial" });

async function srGet<T = unknown>(api: APIRequestContext, path: string): Promise<T> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SR });
  expect(r.ok(), `GET ${path.split("?")[0]} -> ${r.status()} ${await r.text().catch(() => "")}`).toBe(true);
  return (await r.json()) as T;
}

/** Service-role write returning `select` (never RETURNING *: src/test/restRepresentationNeedsSelect). */
async function srWrite(api: APIRequestContext, method: "POST" | "PATCH", table: string, filter: string, data: unknown, select = "id") {
  const q = [filter, `select=${select}`].filter(Boolean).join("&");
  const r = await api.fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, {
    method,
    headers: { ...SR, Prefer: "return=representation" },
    data: JSON.stringify(data),
  });
  expect(r.ok(), `${method} ${table} -> ${r.status()} ${await r.text().catch(() => "")}`).toBe(true);
  return (await r.json()) as Record<string, unknown>[];
}

/** Every object under <uid>/ in a bucket, recursively (folders have id null). */
async function listObjects(api: APIRequestContext, bucket: string, prefix: string): Promise<string[]> {
  const r = await api.post(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    headers: SR,
    data: { prefix, limit: 1000, offset: 0 },
  });
  if (r.status() === 400 || r.status() === 404) {
    const body = await r.text();
    // Only a bucket that does not exist holds nothing; any other "not found"
    // (object, tenant, JWT) is an error, never an empty listing.
    if (/bucket not found/i.test(body)) return [];
    throw new Error(`list ${bucket}/${prefix}: ${r.status()} ${body}`);
  }
  expect(r.ok(), `list ${bucket}/${prefix}: ${r.status()}`).toBe(true);
  const rows = (await r.json()) as { name: string; id: string | null }[];
  const out: string[] = [];
  for (const row of rows) {
    const path = `${prefix}${row.name}`;
    if (row.id === null) out.push(...(await listObjects(api, bucket, `${path}/`)));
    else out.push(path);
  }
  return out;
}

/** The public URL of an avatars object, only once a HEAD shows it exists. */
async function confirmedAvatarUrl(api: APIRequestContext, path: string): Promise<string> {
  const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
  const head = await api.fetch(url, { method: "HEAD" });
  expect(head.ok(), `avatar ${path} is not served (${head.status()})`).toBe(true);
  return url;
}

type Account = { userId: string; session: Session };
let account: Account | null = null;
let helperId = "";
const created = { keptJobId: "", deletedJobId: "", reportId: "", applicationId: "" };
let deletedViaUi = false;

/** Fresh read of everything assertDisposable needs, then the check itself. */
async function requireDisposable(api: APIRequestContext, userId: string) {
  const r = await api.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: SR });
  expect(r.ok(), `auth user ${userId}: ${r.status()}`).toBe(true);
  const user = (await r.json()) as { email?: string; created_at?: string };
  const [profile] = await srGet<{ is_seed: boolean | null }[]>(api, `profiles?user_id=eq.${userId}&select=is_seed`);
  assertDisposable({
    runTag: RUN_TAG,
    runStartedAt: RUN_STARTED,
    email: user.email,
    isSeed: profile?.is_seed ?? null,
    authCreatedAt: user.created_at,
  });
}

test.beforeAll(async () => {
  if (!svc) {
    const why = "SUPABASE_SERVICE_ROLE_KEY is not available (env or .env): the privacy journey cannot create its disposable account.";
    if (process.env.CI) throw new Error(why);
    test.skip(true, why);
  }
  if (!sessionAvailable("helper")) {
    const why = "the shared helper session is not available (PLAYWRIGHT_HELPER_* or a local .env)";
    if (process.env.CI) throw new Error(why);
    test.skip(true, why);
  }
});

test("privacy requests: create -> export -> delete -> purged, on a disposable seed account", async ({ browser, request }) => {
  test.setTimeout(10 * 60_000);

  await test.step("create the disposable seed account", async () => {
    const r = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
      headers: SR,
      data: { email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "SEED Privacy Journey" } },
    });
    expect(r.ok(), `create ${EMAIL}: ${r.status()} ${await r.text()}`).toBe(true);
    const userId = ((await r.json()) as { id: string }).id;
    // The profile row comes from the signup trigger.
    let prof: { user_id: string }[] = [];
    for (let i = 0; i < 20 && !prof.length; i++) {
      prof = await srGet(request, `profiles?user_id=eq.${userId}&select=user_id`);
      if (!prof.length) await new Promise((res) => setTimeout(res, 500));
    }
    expect(prof, "no profile row after signup").toHaveLength(1);
    await srWrite(request, "PATCH", "profiles", `user_id=eq.${userId}`, {
      is_seed: true,
      full_name: "SEED Privacy Journey",
      bio: MARK,
      phone: "5045550199",
      date_of_birth: "1990-01-01",
      terms_version_accepted: "Jun 2026",
      terms_accepted_at: new Date().toISOString(),
      location: "Lafayette, LA",
      email_verified: true,
    });
    const grant = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, "Content-Type": "application/json" },
      data: { email: EMAIL, password: PASSWORD },
      timeout: 45_000,
    });
    expect(grant.ok(), `sign in ${EMAIL}: ${grant.status()}`).toBe(true);
    account = { userId, session: (await grant.json()) as Session };
    await requireDisposable(request, userId);
    helperId = (await getSession(request, "helper")).user.id;
  });

  const { userId, session } = account!;
  const asUser = { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };

  await test.step("give it real data (storage as the user, rows by their own write paths where one exists)", async () => {
    // Storage through the user's own session: the bucket policies are part of what is exercised.
    const avatarPath = `${userId}/privacy-journey.png`;
    const up = await request.post(`${SUPABASE_URL}/storage/v1/object/avatars/${avatarPath}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "image/png", "x-upsert": "true" },
      data: PNG_1PX,
    });
    expect(up.ok(), `avatar upload: ${up.status()} ${await up.text()}`).toBe(true);
    // The profile gate (ProtectedRoute isProfileComplete) needs avatar_url, or
    // /profile, where Delete Account lives, redirects to /complete-profile.
    const avatarUrl = await confirmedAvatarUrl(request, avatarPath);
    await srWrite(request, "PATCH", "profiles", `user_id=eq.${userId}&is_seed=eq.true`, { avatar_url: avatarUrl });
    const docPath = `${userId}/credentials/privacy-journey-${Date.now()}.png`;
    const doc = await request.post(`${SUPABASE_URL}/storage/v1/object/user-documents/${docPath}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "image/png" },
      data: PNG_1PX,
    });
    expect(doc.ok(), `document upload: ${doc.status()} ${await doc.text()}`).toBe(true);
    // Positive control: the listing the purge check relies on SEES both objects
    // now, so an empty listing after the delete means deleted, not unlisted.
    expect(await listObjects(request, "avatars", `${userId}/`), "avatar not listed before the delete").toContain(avatarPath);
    expect(await listObjects(request, "user-documents", `${userId}/`), "document not listed before the delete").toContain(docPath);

    // Jobs: service role with is_seed explicit (prod-seed's shape): one the
    // purge must DELETE (unpaid, nobody applied), one it must KEEP (applied to).
    const base = {
      customer_id: userId,
      description: `${MARK} — not a real job.`,
      location: "2000 Johnston St, Lafayette, LA 70503",
      date_needed: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      pricing_mode: "set_price",
      payment_status: "unpaid",
      category: "errands",
      budget: 45,
      is_seed: true,
    };
    const [a] = await srWrite(request, "POST", "jobs", "", { ...base, title: `${MARK} A (deleted on purge)` });
    const [b] = await srWrite(request, "POST", "jobs", "", { ...base, title: `${MARK} B (outlives its poster)` });
    created.deletedJobId = String(a.id);
    created.keptJobId = String(b.id);
    const [app] = await srWrite(request, "POST", "applications", "", {
      job_id: created.keptJobId, helper_id: helperId, status: "pending", message: `${MARK} application`,
    });
    created.applicationId = String(app.id);

    // A support report through the user's own session (the Q64 surface), and
    // notification preferences through theirs.
    const rep = await request.post(`${SUPABASE_URL}/rest/v1/reports?select=id`, {
      headers: { ...asUser, Prefer: "return=representation" },
      data: { reporter_id: userId, reported_type: "support", reported_id: userId, reason: `[Issue Report] ${MARK}`, description: MARK },
    });
    expect(rep.ok(), `report insert: ${rep.status()} ${await rep.text()}`).toBe(true);
    created.reportId = String(((await rep.json()) as { id: string }[])[0].id);
    const prefs = await request.post(`${SUPABASE_URL}/rest/v1/notification_preferences?on_conflict=user_id&select=user_id`, {
      headers: { ...asUser, Prefer: "resolution=merge-duplicates,return=representation" },
      data: { user_id: userId },
    });
    expect(prefs.ok(), `notification_preferences: ${prefs.status()} ${await prefs.text()}`).toBe(true);

    // Q64 cross-check: a seed account's report must NOT open a ledger item.
    const items = await srGet<unknown[]>(request, `ops_alert_ledger?source_kind=eq.user-report&sample_ref->>report_id=eq.${created.reportId}&select=id`);
    expect(items, "a seed reporter's report reached the ops alert ledger").toHaveLength(0);
  });

  const ctx = await newUserContext(browser, session);
  const page = await ctx.newPage();

  await test.step("export: press Download My Data and read what the browser saves", async () => {
    await page.goto(`/profile?tab=legal&doc=privacy#download-your-data`);
    await assertHealthy(page, "privacy panel");
    const button = page.getByRole("button", { name: "Download My Data" });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.click()]);
    const file = await download.path();
    expect(file, "the export produced no file").toBeTruthy();
    const exported = JSON.parse(readFileSync(file!, "utf8")) as Record<string, unknown>;

    for (const section of EXPORT_SECTIONS) expect(Object.keys(exported), `export section "${section}"`).toContain(section);
    const profile = exported.profile as { user_id?: string; bio?: string } | null;
    expect(profile?.user_id, "export: profile is someone else's").toBe(userId);
    expect(profile?.bio, "export: profile bio").toBe(MARK);
    const jobIds = ((exported.jobs as { id: string }[] | null) ?? []).map((j) => j.id);
    expect(jobIds, "export: both of the account's jobs").toEqual(expect.arrayContaining([created.keptJobId, created.deletedJobId]));
    expect(Array.isArray(exported.applications), "export: applications is a list").toBe(true);
    expect(Array.isArray(exported.reviews), "export: reviews is a list").toBe(true);

    // What the account holds that the export leaves out: EXACT (KNOWN_NOT_EXPORTED).
    const seededTables = ["profiles", "jobs", "reports", "notification_preferences"];
    const exportKey = (t: string) => (t === "profiles" ? "profile" : t);
    const missing = seededTables.filter((t) => !(exportKey(t) in exported)).sort();
    expect(missing, "tables this account has rows in that the export omits (KNOWN_NOT_EXPORTED is exact)").toEqual([...KNOWN_NOT_EXPORTED].sort());
  });

  await test.step("delete: Delete Account -> Continue -> DELETE -> Delete Forever", async () => {
    await page.goto("/profile");
    await assertHealthy(page, "profile landing");
    await page.getByRole("button", { name: "Delete Account" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("textbox", { name: /Type DELETE to confirm account deletion/ }).fill("DELETE");
    // Last check before the irreversible press: fresh from the database, fail closed.
    await requireDisposable(request, userId);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/functions/v1/delete-own-account") && r.request().method() === "POST", { timeout: 90_000 }),
      page.getByRole("button", { name: "Delete Forever" }).click(),
    ]);
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; steps?: { step: string; ok: boolean; detail: string }[] };
    expect(res.status(), `delete-own-account: ${JSON.stringify(body).slice(0, 600)}`).toBe(200);
    deletedViaUi = true;
    expect(body.success).toBe(true);

    // Each purge step, by name.
    const steps = body.steps ?? [];
    for (const name of EXPECTED_PURGE_STEPS) {
      const s = steps.find((x) => x.step === name);
      if (CONDITIONAL_PURGE_STEPS.includes(name)) {
        expect(s, `purge step "${name}" appears only when the purge refuses`).toBeUndefined();
        continue;
      }
      expect(s, `purge step "${name}" missing from the report: ${JSON.stringify(steps)}`).toBeTruthy();
      expect(s!.ok, `purge step "${name}": ${s!.detail}`).toBe(true);
    }
    const unknown = steps.map((s) => s.step).filter((n) => !EXPECTED_PURGE_STEPS.includes(n));
    expect(unknown, "purge steps the journey does not know (add to EXPECTED_PURGE_STEPS)").toEqual([]);

    // purge_user_data's own counters for this account's seeded rows.
    const db = JSON.parse(steps.find((s) => s.step === "database")?.detail ?? "{}") as Record<string, number>;
    for (const [counter, min] of Object.entries(EXPECTED_DB_COUNTS))
      expect(db[counter] ?? -1, `purge_user_data ${counter}`).toBeGreaterThanOrEqual(min);

    await expect(page.getByText("Your account is deleted.")).toBeVisible({ timeout: 20_000 });
  });
  await ctx.close();

  await test.step("verify: the rows and objects themselves", async () => {
    const authUser = await request.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: SR });
    expect(authUser.status(), "auth user still exists").toBe(404);
    expect(await srGet(request, `profiles?user_id=eq.${userId}&select=user_id`), "profile row still exists").toHaveLength(0);
    for (const bucket of IDENTITY_BUCKETS)
      expect(await listObjects(request, bucket, `${userId}/`), `storage ${bucket}/${userId}/ not empty`).toEqual([]);
    expect(await srGet(request, `jobs?id=eq.${created.deletedJobId}&select=id`), "the unhired job was not deleted").toHaveLength(0);
    const [kept] = await srGet<{ customer_id: string | null; description: string; location: string | null; status: string }[]>(
      request, `jobs?id=eq.${created.keptJobId}&select=customer_id,description,location,status`);
    expect(kept, "the applied-to job was deleted (it must outlive its poster)").toBeTruthy();
    expect(kept.customer_id, "kept job still names its deleted poster").toBeNull();
    expect(kept.description).toBe("This job's details were removed when the poster closed their account."); // AL-012
    expect(kept.location, "kept job still carries the poster's address").toBeNull();
    expect(kept.status, "kept job's status was not preserved").toBe("open");
    const [rep] = await srGet<{ reporter_id: string | null }[]>(request, `reports?id=eq.${created.reportId}&select=reporter_id`);
    expect(rep?.reporter_id, "report still names the deleted reporter").toBeNull();
    expect(await srGet(request, `notification_preferences?user_id=eq.${userId}&select=user_id`), "notification preferences remain").toHaveLength(0);
  });

  await test.step("outlive: the applicant's Activity still renders once the poster is gone", async () => {
    // The applicant's own surface for a job they applied to is Activity
    // (/my-jobs, applied tab). /jobs/:id is not: signed in, it hands off to
    // quick-apply, which reads open_jobs_browse, and that view excludes
    // ownerless jobs by design (CLAUDE.md). The kept row is asserted above.
    const helperCtx = await newUserContext(browser, await getSession(request, "helper"));
    const hp = await helperCtx.newPage();
    await hp.goto("/my-jobs");
    await assertHealthy(hp, "applicant's Activity with an ownerless job");
    await helperCtx.close();
  });
});

/**
 * Q292: an account that never finished signup can still delete itself.
 *
 * ProtectedRoute's profile gate (isProfileComplete: name, avatar, DOB, phone,
 * city) bounces an incomplete account from /profile — where Delete Account
 * lives — to /complete-profile. Structural for Sign in with Apple (no photo).
 * So /complete-profile itself must offer deletion (Apple 5.1.1(v), GDPR Art.
 * 17), through the same hook and dialog as every other entry point.
 */
// @mutate src/pages/CompleteProfile.tsx | onClick={deleteAccount.requestDelete} | onClick={() => {}}
const INCOMPLETE_TAG = `${RUN_TAG.slice(0, 13)}inc`;
const INCOMPLETE_EMAIL = disposableEmail(INCOMPLETE_TAG);

test("privacy requests: an INCOMPLETE profile deletes itself from /complete-profile, and is purged", async ({ browser, request }) => {
  test.setTimeout(5 * 60_000);
  let userId = "";
  let token = "";
  let deleted = false;
  const disposable = async () => {
    const r = await request.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: SR });
    expect(r.ok(), `auth user ${userId}: ${r.status()}`).toBe(true);
    const user = (await r.json()) as { email?: string; created_at?: string };
    const [p] = await srGet<{ is_seed: boolean | null }[]>(request, `profiles?user_id=eq.${userId}&select=is_seed`);
    assertDisposable({ runTag: INCOMPLETE_TAG, runStartedAt: RUN_STARTED, email: user.email, isSeed: p?.is_seed ?? null, authCreatedAt: user.created_at });
  };
  try {
    await test.step("create a disposable account that never completed its profile (no avatar)", async () => {
      const r = await request.post(`${SUPABASE_URL}/auth/v1/admin/users`, {
        headers: SR,
        data: { email: INCOMPLETE_EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "SEED Privacy Incomplete" } },
      });
      expect(r.ok(), `create ${INCOMPLETE_EMAIL}: ${r.status()} ${await r.text()}`).toBe(true);
      userId = ((await r.json()) as { id: string }).id;
      let prof: { user_id: string }[] = [];
      for (let i = 0; i < 20 && !prof.length; i++) {
        prof = await srGet(request, `profiles?user_id=eq.${userId}&select=user_id`);
        if (!prof.length) await new Promise((res) => setTimeout(res, 500));
      }
      expect(prof, "no profile row after signup").toHaveLength(1);
      // Consent and a verified email, but NO avatar/DOB/phone/city: the gate's case.
      await srWrite(request, "PATCH", "profiles", `user_id=eq.${userId}`, {
        is_seed: true,
        full_name: "SEED Privacy Incomplete",
        terms_version_accepted: "Jun 2026",
        terms_accepted_at: new Date().toISOString(),
        email_verified: true,
      });
      const [row] = await srGet<{ avatar_url: string | null; is_legacy_user: boolean | null }[]>(
        request, `profiles?user_id=eq.${userId}&select=avatar_url,is_legacy_user`);
      expect(row.avatar_url, "the incomplete account must have no avatar").toBeNull();
      expect(row.is_legacy_user, "a legacy account bypasses the gate; this one must not").not.toBe(true);
      const grant = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: { email: INCOMPLETE_EMAIL, password: PASSWORD },
        timeout: 45_000,
      });
      expect(grant.ok(), `sign in ${INCOMPLETE_EMAIL}: ${grant.status()}`).toBe(true);
      const session = (await grant.json()) as Session;
      token = session.access_token;
      await disposable();

      const ctx = await newUserContext(browser, session);
      const page = await ctx.newPage();
      try {
        await test.step("the profile gate sends it from /profile to /complete-profile", async () => {
          await page.goto("/profile");
          await expect(page).toHaveURL(/\/complete-profile/, { timeout: 30_000 });
          await assertHealthy(page, "complete-profile gate");
          // Evidence for review (uploaded with test-results/): the gate at desktop and at 375.
          await page.screenshot({ path: "test-results/q292-complete-profile-desktop.png", fullPage: true });
          await page.setViewportSize({ width: 375, height: 812 });
          await page.screenshot({ path: "test-results/q292-complete-profile-375.png", fullPage: true });
        });
        await test.step("delete from /complete-profile: Delete Account -> Continue -> DELETE -> Delete Forever", async () => {
          await page.getByRole("button", { name: "Delete Account" }).click();
          await page.getByRole("button", { name: "Continue" }).click();
          await page.getByRole("textbox", { name: /Type DELETE to confirm account deletion/ }).fill("DELETE");
          await disposable();
          const [res] = await Promise.all([
            page.waitForResponse((r) => r.url().includes("/functions/v1/delete-own-account") && r.request().method() === "POST", { timeout: 90_000 }),
            page.getByRole("button", { name: "Delete Forever" }).click(),
          ]);
          const body = (await res.json().catch(() => ({}))) as { success?: boolean };
          expect(res.status(), `delete-own-account: ${JSON.stringify(body).slice(0, 600)}`).toBe(200);
          deleted = true;
          expect(body.success).toBe(true);
          await expect(page.getByText("Your account is deleted.")).toBeVisible({ timeout: 20_000 });
        });
      } finally {
        await ctx.close();
      }
    });
    await test.step("verify: auth user and profile row are gone", async () => {
      const authUser = await request.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: SR });
      expect(authUser.status(), "auth user still exists").toBe(404);
      expect(await srGet(request, `profiles?user_id=eq.${userId}&select=user_id`), "profile row still exists").toHaveLength(0);
    });
  } finally {
    // A run that died before the UI delete: the product's own purge, only
    // after the same fail-closed check. Never a hand-rolled delete.
    if (userId && token && !deleted) {
      await disposable();
      const gone = await request.post(`${SUPABASE_URL}/functions/v1/delete-own-account`, {
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { confirmation: "DELETE MY ACCOUNT" },
        timeout: 90_000,
      });
      expect(gone.ok(), `cleanup: delete-own-account ${gone.status()} ${await gone.text()} — ${INCOMPLETE_EMAIL} may be LEFT on prod`).toBe(true);
    }
  }
});

test.afterAll(async ({ playwright }) => {
  if (!svc) return;
  // afterAll may only use worker-scoped fixtures: make our own request context.
  const request = await playwright.request.newContext({ timeout: 60_000 });
  const residue: string[] = [];
  try {
    // Test-owned rows only, each filtered by what makes it ours; every delete
    // is read back, so residue is loud, never silent.
    const del = async (label: string, path: string, mayBeGone = false) => {
      const r = await request.delete(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...SR, Prefer: "return=representation" } });
      const rows = r.ok() ? ((await r.json()) as unknown[]) : null;
      if (!rows || (rows.length !== 1 && !(mayBeGone && rows.length === 0)))
        residue.push(`${label}: ${r.status()} ${rows ? `${rows.length} row(s)` : await r.text()}`);
    };
    if (created.applicationId) await del("application", `applications?select=id&id=eq.${created.applicationId}&helper_id=eq.${helperId}`);
    if (created.keptJobId) await del("kept job", `jobs?select=id&id=eq.${created.keptJobId}&is_seed=eq.true`);
    // Job A is deleted by the purge itself when the run got that far.
    if (created.deletedJobId) await del("unhired job", `jobs?select=id&id=eq.${created.deletedJobId}&is_seed=eq.true`, true);
    if (created.reportId) await del("report", `reports?select=id&id=eq.${created.reportId}&description=eq.${encodeURIComponent(MARK)}`);
    // A run that died before the UI delete: remove the disposable account the
    // way a person would (delete-own-account, the product's own purge — never a
    // hand-rolled storage/auth delete), and only after the same fail-closed check.
    if (account && !deletedViaUi) {
      const r = await request.get(`${SUPABASE_URL}/auth/v1/admin/users/${account.userId}`, { headers: SR });
      if (!r.ok() && r.status() !== 404) residue.push(`disposable account ${EMAIL}: could not read it (${r.status()})`);
      if (r.ok()) {
        const user = (await r.json()) as { email?: string; created_at?: string };
        const prof = await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${account.userId}&select=is_seed`, { headers: SR });
        const [p] = prof.ok() ? ((await prof.json()) as { is_seed: boolean | null }[]) : [];
        try {
          assertDisposable({ runTag: RUN_TAG, runStartedAt: RUN_STARTED, email: user.email, isSeed: p?.is_seed ?? null, authCreatedAt: user.created_at });
        } catch (e) {
          // The refusal is the headline; the residue is what the reader must act on.
          residue.push(`disposable account ${EMAIL} (${account.userId}) was LEFT on prod: ${(e as Error).message}`);
          expect(residue, "cleanup left residue on prod — remove it by hand").toEqual([]);
          return;
        }
        const gone = await request.post(`${SUPABASE_URL}/functions/v1/delete-own-account`, {
          headers: { apikey: ANON, Authorization: `Bearer ${account.session.access_token}`, "Content-Type": "application/json" },
          data: { confirmation: "DELETE MY ACCOUNT" },
          timeout: 90_000,
        });
        if (!gone.ok()) residue.push(`disposable account ${EMAIL}: delete-own-account ${gone.status()} ${await gone.text()}`);
      }
    }
    expect(residue, "cleanup left residue on prod — remove it by hand").toEqual([]);
  } finally {
    await request.dispose();
  }
});
