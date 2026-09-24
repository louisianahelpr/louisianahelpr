/**
 * Q193 — OWNER DECISION (2026-09-23): the approval-pending screen
 * (/account-pending) and the account-denied screen (/account-denied) are
 * DELETED, with their states. "Every signup is auto-approved and bans are
 * automated." Unverified-email users land on the 3-step "Check Your Email"
 * page (/signup-pending) instead — "no duplicate pages with the same info".
 * AccountBanned stays.
 *
 * This pins every layer the two screens lived in, derived from the source
 * tree rather than a list of known call sites, so a link or redirect added
 * tomorrow anywhere in the app, an edge function, a script or an e2e spec is
 * caught the day it lands:
 *
 *   1. ROUTES/LINKS/REDIRECTS: no code (comments blanked, string bodies kept)
 *      under src/, supabase/functions/, scripts/ or e2e/ names either path.
 *   2. THE PAGES: no AccountPending.tsx / AccountDenied.tsx anywhere under src/pages.
 *   3. PUBLIC FILES: robots.txt and the AASA claim list do not name them.
 *   4. THE EMAIL LANDING: Signup's emailRedirectTo and both resend paths use
 *      the one helper that points at /signup-pending.
 *   5. THE STATE: no client or edge code WRITES approval_status 'denied', and
 *      the newest migration statement about profiles_approval_status_no_denied
 *      is its ADD, whose CHECK does not admit 'denied'.
 *
 * The route-by-route behaviour (an unverified user on EVERY protected route
 * lands on /signup-pending; a leftover pending/denied value is let in) is
 * pinned in src/test/emailGateEveryProtectedRoute.test.tsx.
 *
 * PROVEN RED 2026-09-23 against HEAD 40fd919ff (before Q193), all 6 checks
 * failed: (1) 44 code references in 24 files; (2) both pages present; (3)
 * robots.txt "Disallow: /account-pending" + "/account-denied"; (4) no
 * getSignupConfirmRedirect — Signup and both resends hand-built
 * `/account-pending`; (5) DenyUserDialog.tsx:62 and
 * stripe-idv-webhook/index.ts:350 wrote 'denied'; (6) no constraint. Each
 * registered mutation below re-plants one of them.
 *
 * @mutate src/components/ProtectedRoute.tsx | return <Navigate to="/signup-pending" replace />; | return <Navigate to="/account-pending" replace />;
 * @mutate src/lib/authRedirects.ts | => `${getPublicOrigin()}/signup-pending`; | => `${getPublicOrigin()}/account-pending`;
 * @mutate src/pages/auth/Signup.tsx | emailRedirectTo: getSignupConfirmRedirect(), | emailRedirectTo: `${window.location.origin}/signup-pending`,
 * @mutate supabase/functions/stripe-idv-webhook/index.ts | idv_failure_reason: "Identity matched a previously removed account.", | idv_failure_reason: "Identity matched a previously removed account.", approval_status: "denied",
 *   (Q288: the mutation that re-admitted 'denied' to 20260923153703's CHECK
 *   is retired; 20260923205943 drops the column, so that CHECK no longer
 *   decides anything. The mutation below, keeping the column, is its heir.)
 * @mutate supabase/migrations/20260923205943_drop_profiles_approval_status.sql |   ALTER TABLE public.profiles DROP COLUMN approval_status; |   SELECT 1;
 * @mutate public/robots.txt | Disallow: /account-banned | Disallow: /account-pending
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["src", "supabase/functions", "scripts", "e2e"];
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SELF = "src/test/retiredAccountStateScreens.test.ts";
/** Generated from the live schema; not app code. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

const RETIRED_PATH = /\/account-(pending|denied)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(REPO, r)))
  .map((f) => relative(REPO, f))
  .filter((f) => f !== SELF && !GENERATED.has(f));

const code = (rel: string) => blankComments(readFileSync(join(REPO, rel), "utf8"));

describe("Q193: the pending and denied account screens stay deleted", () => {
  it("the scan actually read the tree (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/components/ProtectedRoute.tsx");
    expect(files).toContain("supabase/functions/stripe-idv-webhook/index.ts");
  });

  it("no route, link or redirect in code names /account-pending or /account-denied", () => {
    const hits: string[] = [];
    for (const f of files) {
      code(f).split("\n").forEach((line, i) => {
        if (RETIRED_PATH.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    expect(hits, "a retired account-state path is referenced again — Q193 deleted both screens").toEqual([]);
  });

  it("the two pages are gone and AccountBanned is kept", () => {
    // Any folder under src/pages: a file named for either screen is the screen back.
    const pageFiles = (readdirSync(join(REPO, "src/pages"), { recursive: true }) as string[]).map((p) => p.split(/[\\/]/).pop());
    expect(pageFiles.length).toBeGreaterThan(50);
    expect(pageFiles.filter((n) => /^Account(Pending|Denied)\.tsx$/.test(n ?? ""))).toEqual([]);
    expect(existsSync(join(REPO, "src/pages/auth/AccountBanned.tsx"))).toBe(true);
    expect(code("src/App.tsx")).toMatch(/<Route\s+path="\/account-banned"/);
  });

  it("robots.txt and the AASA claim list do not name them", () => {
    const robots = readFileSync(join(REPO, "public/robots.txt"), "utf8");
    expect(robots.split("\n").filter((l) => RETIRED_PATH.test(l))).toEqual([]);
    const aasa = JSON.parse(readFileSync(join(REPO, "public/.well-known/apple-app-site-association"), "utf8"));
    const claims: string[] = [];
    for (const d of aasa.applinks.details) {
      for (const p of d.paths ?? []) claims.push(p);
      for (const c of d.components ?? []) claims.push(c["/"]);
    }
    expect(claims.length).toBeGreaterThan(10);
    expect(claims.filter((c) => RETIRED_PATH.test(c))).toEqual([]);
    // The confirmation link's landing stays unclaimed (its session arrives in
    // the fragment — see the AASA comment on it).
    expect(claims).toContain("NOT /signup-pending");
  });

  it("the signup email link and both resends land on /signup-pending through one helper", () => {
    expect(code("src/lib/authRedirects.ts")).toMatch(
      /export const getSignupConfirmRedirect = \(\): string => `\$\{getPublicOrigin\(\)\}\/signup-pending`;/,
    );
    const signup = code("src/pages/auth/Signup.tsx");
    expect(signup).toMatch(/emailRedirectTo:\s*getSignupConfirmRedirect\(\)/);
    const pending = code("src/pages/auth/SignupPending.tsx");
    expect(pending).toMatch(/emailRedirectTo:\s*getSignupConfirmRedirect\(\)/);
    // Every signup-confirmation emailRedirectTo in the client (any file that
    // calls auth.signUp or auth.resend) goes through the helper, so a third
    // resend path cannot quietly point somewhere else. (auth.updateUser's
    // email-CHANGE link is a different flow with its own landing.)
    const stray: string[] = [];
    const senders = files.filter(
      (x) => x.startsWith("src/") && !/\.test\.tsx?$/.test(x) && /\.auth\s*\.\s*(signUp|resend)\s*\(/.test(code(x)),
    );
    expect(senders).toEqual(expect.arrayContaining(["src/pages/auth/Signup.tsx", "src/pages/auth/SignupPending.tsx"]));
    for (const f of senders) {
      code(f).split("\n").forEach((line, i) => {
        if (/emailRedirectTo:/.test(line) && !/getSignupConfirmRedirect\(\)/.test(line)) stray.push(`${f}:${i + 1}`);
      });
    }
    expect(stray).toEqual([]);
  });

  it("no client or edge code writes approval_status 'denied'", () => {
    const writes: string[] = [];
    for (const f of files.filter((x) => (x.startsWith("src/") || x.startsWith("supabase/functions/")) && !/\.test\.tsx?$/.test(x))) {
      code(f).split("\n").forEach((line, i) => {
        if (/approval_status["']?\s*[:=]\s*["']denied["']/.test(line)) writes.push(`${f}:${i + 1}`);
      });
    }
    expect(writes).toEqual([]);
  });

  // Q288 dropped the column (20260923205943), taking the CHECK with it. Then
  // 'denied' is unstorable because there is nowhere to store it; the CHECK may
  // only be dropped if the column's own last DDL is its DROP.
  it("the newest migration statement about the constraint ADDs it without 'denied', or the column is gone", () => {
    const dir = join(REPO, "supabase/migrations");
    let last: { verb: string; body: string } | null = null;
    let lastColumn: string | null = null;
    const re = /\b(add|drop)\s+constraint\s+(?:if\s+exists\s+)?profiles_approval_status_no_denied\b([^;]*);/gi;
    const col = /\bdrop\s+column\s+(?:if\s+exists\s+)?approval_status\b/gi;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
      for (const m of sql.matchAll(re)) last = { verb: m[1].toLowerCase(), body: m[2] };
      if (col.test(sql)) lastColumn = f;
      col.lastIndex = 0;
    }
    expect(last, "no migration defines profiles_approval_status_no_denied").not.toBeNull();
    if (last!.verb === "drop") {
      expect(lastColumn, "the CHECK is dropped but approval_status is not: 'denied' is storable again").not.toBeNull();
      return;
    }
    expect(last!.verb).toBe("add");
    expect(last!.body).toMatch(/check\s*\(\s*approval_status\s+in\s*\(/i);
    expect(last!.body).not.toMatch(/'denied'/);
  });
});
