/**
 * Every /admin?view=* renders on PROD, as the admin-e2e account, at 375,
 * without ANY error screen: no route or app crash, no "couldn't load" data
 * failure, no "couldn't verify your access" gate. The view list is parsed from
 * the `View` union in src/pages/admin/Admin.tsx, so a new view is checked the day it
 * is added.
 *
 * Origin (2026-09-12): the mocked visual sweep captured "This page hit a
 * problem" on /admin?view=tiers. Reads only: every Supabase write is refused
 * at the wire, except named read RPCs.
 *
 * 2026-09-13: the first version failed only on crashes and merely annotated a
 * "couldn't load" state, so /admin?view=support showed "We couldn't load the
 * support queue" and passed. The cause was this spec: `admin_support_queue` is
 * a read RPC whose name matched none of the read prefixes, so the firewall
 * refused it. Every refused request is now named in the failure message, so a
 * load failure the firewall caused says which call it blocked.
 */
import { expect, test } from "../prodTest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findErrorScreen, readScreenText } from "../errorScreens";
import { isStorageSignPath } from "../readRpc";
import { isConsentAcceptance, newUserContext, sessionFor, settle, SUPABASE_URL } from "./harness";

function adminViews(src = readFileSync(join(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8")): string[] {
  const m = /type View\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `type View` in src/pages/admin/Admin.tsx");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

const VIEWS = adminViews();

/**
 * Read RPCs by prefix, plus read RPCs whose names carry no read verb. Adding a
 * name here is a claim that the function does not write: check
 * `pg_get_functiondef` on prod first.
 *
 * `admin_stalled_job_queue` added 2026-09-20. Verified live on prod before
 * adding: `LANGUAGE sql STABLE SECURITY DEFINER`, one SELECT over
 * `job_completion_nudges JOIN jobs`, and `pg_proc.provolatile = 's'`.
 */
const READ_RPC =
  /\/rest\/v1\/rpc\/(get_|list_|count_|admin_get_|admin_list_|search_|admin_support_queue(\?|$)|admin_stalled_job_queue(\?|$)|admin_notification_crosses_seed_boundary(\?|$))/;

/**
 * Admin RPCs that WRITE. Not an allow-list — the opposite: naming one here is
 * how the inventory check below is told "yes, the firewall is right to refuse
 * this one". Each verified `provolatile = 'v'` on prod, 2026-09-20.
 */
const WRITE_RPC = new Set([
  "rpc_settle_dispute_without_payment",
  "admin_delete_review",
  "admin_reverse_violation",
  "resolve_stalled_job_flag",
  "review_credential",
  "rpc_decide_dispute",
]);

/**
 * Every RPC name the admin surface calls, read out of the admin source itself.
 *
 * Matches `supabase.rpc("x"` AND `(supabase.rpc as any)("x"` — the second form
 * is how a brand-new RPC is called before `types.ts` is regenerated, and it is
 * exactly the form that hid `admin_stalled_job_queue` from a narrower scan.
 */
function adminRpcNames(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.test\./.test(p)) files.push(p);
    }
  };
  walk(join(process.cwd(), "src/components/admin"));
  files.push(join(process.cwd(), "src/pages/admin/Admin.tsx"));
  const names = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\brpc\b[^("]{0,40}?\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

// Shown able to fail on the exact miss this file's own comment describes: a
// READ whose name carries no read verb, so the firewall refuses it and the
// screen renders a load failure while the app is fine. Renaming the support
// queue's CALL SITE leaves it matched by neither READ_RPC nor WRITE_RPC, which
// is the state `admin_support_queue` (2026-09-13) and `admin_stalled_job_queue`
// (2026-09-19) were each in before someone noticed by hand.
// @mutate src/components/admin/AdminSupport.tsx | rpc("admin_support_queue" | rpc("admin_support_items"

test("the admin view inventory is parsed (non-empty, includes tiers)", () => {
  expect(VIEWS.length).toBeGreaterThan(10);
  expect(VIEWS).toContain("tiers");
});

test("the read allow-list passes the support queue and still refuses writes", () => {
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_support_queue`)).toBe(true);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_stalled_job_queue`)).toBe(true);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_support_queue_resolve`)).toBe(false);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_stalled_job_queue_resolve`)).toBe(false);
  expect(READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/admin_ban_user`)).toBe(false);
});

/**
 * Minting a signed URL is a POST that reads: it writes nothing and returns a
 * link to an object the caller may already see (2026-09-24: the firewall
 * refused it, and /admin?view=credentials showed "Couldn't load preview" on a
 * healthy screen). Shared with harness.ts `writeFirewall` via `isStorageSignPath`.
 */
const READ_STORAGE = { test: (url: string) => isStorageSignPath(new URL(url).pathname) };

test("the storage read allow-list passes signing and still refuses uploads", () => {
  expect(READ_STORAGE.test(`${SUPABASE_URL}/storage/v1/object/sign/user-documents/u/credentials/x.png`)).toBe(true);
  expect(READ_STORAGE.test(`${SUPABASE_URL}/storage/v1/object/user-documents/u/credentials/x.png`)).toBe(false);
  expect(READ_STORAGE.test(`${SUPABASE_URL}/storage/v1/object/avatars/u/avatar.png`)).toBe(false);
});

/**
 * PREVENT, DON'T CHASE (2026-09-20). `admin_stalled_job_queue` shipped on
 * 2026-09-19 and the very next run of this suite showed "We couldn't load the
 * stuck-job queue" on /admin?view=stalled — a READ the firewall above refused
 * because its name carries no read verb, the same class of miss
 * `admin_support_queue` caused on 2026-09-13 and which was then fixed one name
 * at a time. The screen under test looked broken and the app was fine.
 *
 * So the list stops being a list someone has to remember. Every RPC the admin
 * source calls must be CLASSIFIED — matched by READ_RPC, or named in
 * WRITE_RPC — and the day an admin screen calls a new one, this fails naming
 * it, before a nightly reports it as a load failure on the screen.
 *
 * It cannot say which way a new name belongs; that is a live check
 * (`pg_proc.provolatile`, `pg_get_functiondef`) and the reason it fails loudly
 * rather than guessing.
 */
test("every RPC the admin surface calls is classified read or write", () => {
  const names = adminRpcNames();
  expect(names.length, "no RPC call sites found under src/components/admin — the scanner is broken").toBeGreaterThan(5);
  const unclassified = names.filter(
    (n) => !READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/${n}`) && !WRITE_RPC.has(n),
  );
  expect(
    unclassified,
    `these admin RPCs are neither in READ_RPC nor WRITE_RPC:\n  ${unclassified.join("\n  ")}\n` +
      "Check pg_proc.provolatile / pg_get_functiondef on prod, then add each to the right one. " +
      "A read left unclassified makes its own screen render a load failure in this suite.",
  ).toEqual([]);
  // A name cannot be both: that would mean the firewall passes a write.
  const both = [...WRITE_RPC].filter((n) => READ_RPC.test(`${SUPABASE_URL}/rest/v1/rpc/${n}`));
  expect(both, "classified as a write but the read firewall passes it").toEqual([]);
});

for (const view of VIEWS) {
  test(`/admin?view=${view} renders without an error screen`, async ({ browser, request }, info) => {
    const admin = await sessionFor(request, "admin");
    const ctx = await newUserContext(browser, admin);
    const blocked: string[] = [];
    await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
      const req = route.request();
      const m = req.method();
      if (m === "GET" || m === "HEAD" || m === "OPTIONS" || READ_RPC.test(req.url()) || READ_STORAGE.test(req.url()) || /\/auth\/v1\/(token|user)/.test(req.url())) return route.continue();
      // The terms re-consent acceptance, and nothing else — see
      // `isConsentAcceptance` in harness.ts. This firewall is armed before the
      // first goto, so without the exception the gate it raises can never be
      // cleared here, and /admin is judged through a scrim.
      if (isConsentAcceptance(m, new URL(req.url()).pathname, req.postData())) return route.continue();
      blocked.push(`${m} ${req.url().replace(SUPABASE_URL, "")}`);
      await route.abort("blockedbyclient").catch(() => {});
    });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin?view=${view}`);
    await settle(page, 1500);
    await page.screenshot({ path: info.outputPath(`admin-${view}.png`) });
    /**
     * NAME THE ACCOUNT AND THE REASON (2026-09-20). This assertion read
     * "admin-e2e was bounced off /admin" and nothing else, so 26 identical
     * failures a night said only that something was wrong with /admin. The
     * actual destination was /complete-profile, not /dashboard: the account
     * PLAYWRIGHT_ADMIN_EMAIL points at had `avatar_url` NULL, which is one of
     * ProtectedRoute's Big-7 gate fields, so it never reached AdminRoute at
     * all and the admin surface was never exercised. A bounce to
     * /complete-profile is a fact about the ACCOUNT; a bounce to /dashboard is
     * a fact about its ROLE; they are different bugs and the message now says
     * which one happened, on whose account.
     */
    const landed = new URL(page.url()).pathname;
    const why =
      landed === "/complete-profile"
        ? " — the profile gate, not the admin gate: this account is missing one of " +
          "ProtectedRoute's Big-7 fields (full_name, avatar_url, date_of_birth, phone, location). " +
          "Point PLAYWRIGHT_ADMIN_EMAIL at the seeded admin (scripts/audit/prod-seed.mjs), or complete this profile."
        : landed === "/dashboard"
          ? " — the admin gate: the role lookup came back CONFIRMED not-admin for this account."
          : landed === "/login"
            ? " — the session was not accepted; it is signed out."
            : "";
    expect(
      landed,
      `admin-e2e was bounced off /admin (view=${view}) to ${landed}${why}\nsigned in as: ${admin.user.email ?? admin.user.id}`,
    ).toBe("/admin");
    // Not body innerText: /admin?view=health lists stored alert titles such as
    // "Error screen shown: We couldn't load your account." inside
    // [data-quoted-log]; readScreenText lets findErrorScreen skip them (Q101).
    const screen = await page.evaluate(readScreenText).catch(() => ({ text: "", quoted: [] as string[] }));
    const found = findErrorScreen(screen, []);
    expect(
      found,
      `/admin?view=${view}: ${found?.name} — ${found?.excerpt}\nrefused at the wire: ${blocked.join(", ") || "nothing"}`,
    ).toBeNull();
    await ctx.close();
  });
}
