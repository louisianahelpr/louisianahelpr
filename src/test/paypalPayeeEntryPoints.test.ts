/**
 * CLASS GUARD: "Get paid with PayPal" (PayPal Plan A, phase 2; design ~/.lh-wt/paypal-design.md §6 row 2;
 * migration 20261023231647). Two classes, each inventoried from source, each with a floor.
 *
 * SERVER: every member-callable SQL function that touches a PayPal table (payee_accounts,
 * provider_payments, provider_refunds, provider_payouts, paypal_webhook_events) and is EXECUTE-granted
 * to `authenticated`:
 *   (s1) starts with PERFORM public.require_feature('paypal_payments') (hiding a screen is never the
 *        protection);
 *   (s2) takes no uuid parameter (the member is auth.uid(), never an id from the request) and no
 *        verified/payable parameter (the server decides those);
 *   (s3) names its member through auth.uid().
 *   And: (s4) helper_accept_missing clears 'payout_setup' through paypal_payee_ready, which reads the
 *   switch; (s5) paypal_payee_env says only 'sandbox' while PAYPAL_LIVE_ALLOWED is false.
 *
 * CLIENT (src, tests excluded, comments blanked): Stripe payout setup's paused notice
 * (PayoutSetupPausedNotice) is the jobs entry points' dead end while Stripe is closed.
 *   (c1) In jobs code it is rendered only by PayoutSetupNotice, which shows "Add your PayPal email"
 *        while `paypal_payments` is on; every other file that renders it is listed in NOT_JOBS with
 *        the reason (exact both ways).
 *   (c2) PayPalPayeePrompt is rendered only by PayoutSetupNotice; PayPalPayeeCard only by PaymentTab,
 *        under the switch; set_paypal_payee_email is called only by PayPalPayeeCard.
 *   (c3) The paused words' other carriers (PayoutStatusRow's setupPaused, claimSetupStep's second
 *        argument) are switched off for PayPal at every caller that reads the pause.
 *   (c4) The client mirror of helper_accept_missing takes the PayPal answer, and both accept-gate
 *        hooks pass it.
 *
 * Behaviour is proven in PGlite: src/test/pglite/paypalPayeeEmail.pglite.mjs (43 PASS, 3x; PLANT=base
 * 28 FAIL). Red on the phase 1 base: no member-callable PayPal function exists (s1 floor), the gate
 * has no PayPal arm (s4), and the jobs entry points render the paused notice directly (c1).
 *
 * @mutate supabase/migrations/20261023231647_paypal_payee_email.sql | BEGIN\n  PERFORM public.require_feature('paypal_payments');\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF v_email = '' THEN | BEGIN\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  IF v_email = '' THEN
 * @mutate supabase/migrations/20261023231647_paypal_payee_email.sql | AND NOT public.paypal_payee_ready(p.user_id) THEN 'payout_setup' END | THEN 'payout_setup' END
 * @mutate supabase/migrations/20261023231647_paypal_payee_email.sql |   SELECT 'sandbox'::text; |   SELECT 'live'::text;
 * @mutate supabase/migrations/20261023231647_paypal_payee_email.sql |      AND public.feature_enabled_for_user('paypal_payments', p_user_id)\n |      AND true\n
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | <PayoutSetupNotice compact className="text-ds-11" /> | <PayoutSetupPausedNotice compact className="text-ds-11" />
 * @mutate src/components/payouts/PayoutSetupNotice.tsx |   if (paypal.on) { |   if (false) {
 * @mutate src/components/PaymentTab.tsx |           ) : paypal ? ( |           ) : false ? (
 * @mutate src/components/profile/ProfileLanding.tsx |             setupPaused={setupPaused && !paypal.on} |             setupPaused={setupPaused}
 * @mutate src/hooks/useAwardBlockReason.ts |   return reasonFromMissing(acceptMissingFromProfile(profile, { paypalReady: paypal.ready })); |   return reasonFromMissing(acceptMissingFromProfile(profile));
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { acceptMissingFromProfile } from "@/lib/awardGate";

const ROOT = path.resolve(__dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PAYPAL_TABLES = /\bpublic\.(?:payee_accounts|provider_payments|provider_refunds|provider_payouts|paypal_webhook_events)\b/;

/** Function name -> granted to authenticated, replaying every GRANT/REVOKE EXECUTE in migration order. */
function memberCallable(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const f of migrationFiles(MIG)) {
    const sql = blankSqlComments(fs.readFileSync(path.join(MIG, f), "utf8"));
    for (const m of sql.matchAll(/\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s+(TO|FROM)\s+([^;]+);/gi)) {
      if (!/\bauthenticated\b/i.test(m[4])) continue;
      out.set(m[2], m[1].toUpperCase() === "GRANT");
    }
  }
  return out;
}

/** The plpgsql/sql body between the dollar tags, comments blanked. */
function bodyOf(stmt: string): string {
  const tag = /\bAS\s+(\$[a-z_]*\$)/i.exec(stmt);
  if (!tag) return "";
  const open = stmt.indexOf(tag[1], tag.index) + tag[1].length;
  return blankSqlComments(stmt.slice(open, stmt.indexOf(tag[1], open)));
}

/** "(p_email text, p_email_confirm text)" -> [["p_email","text"], ...] */
function params(stmt: string): [string, string][] {
  const m = /FUNCTION\s+public\.\w+\s*\(([^)]*)\)/i.exec(stmt);
  return (m?.[1] ?? "").split(",").map((p) => p.trim()).filter(Boolean)
    .map((p) => p.split(/\s+/)).map(([n, ...t]) => [n, t.join(" ").replace(/\s+DEFAULT[\s\S]*$/i, "").toLowerCase()] as [string, string]);
}

export function serverViolations(defs: Map<string, { stmt: string }>, granted: Map<string, boolean>): { checked: string[]; bad: string[] } {
  const checked: string[] = [];
  const bad: string[] = [];
  for (const [name, d] of defs) {
    if (granted.get(name) !== true) continue;
    const body = bodyOf(d.stmt);
    if (!PAYPAL_TABLES.test(body)) continue;
    checked.push(name);
    // (s1) the first statement of the body
    const first = body.replace(/^[\s\S]*?\bBEGIN\b/i, "").trim().split(";")[0]?.trim() ?? "";
    if (!/^PERFORM\s+public\.require_feature\('paypal_payments'\)$/i.test(first)) bad.push(`${name}: does not start with PERFORM public.require_feature('paypal_payments')`);
    for (const [p, t] of params(d.stmt)) {
      if (/\buuid\b/.test(t)) bad.push(`${name}: takes a uuid parameter (${p}); the member is auth.uid()`);
      if (/verified|payable/i.test(p)) bad.push(`${name}: takes ${p}; verified/payable are the server's to decide`);
    }
    if (!/\bauth\.uid\(\)/.test(body)) bad.push(`${name}: never reads auth.uid()`);
  }
  return { checked: checked.sort(), bad };
}

/** Files that render <PayoutSetupPausedNotice outside jobs code, each with why. EXACT. */
const NOT_JOBS: Readonly<Record<string, string>> = {
  "src/components/payouts/PayoutSetupNotice.tsx": "the one jobs wrapper: it renders the paused notice only while paypal_payments is off",
  "src/components/PayoutSetupForm.tsx": "the Stripe form; PaymentTab renders PayPalPayeeCard in its place while paypal_payments is on",
  "src/components/declutter/DeclutterMoveView.tsx": "Declutter sales pay out through Stripe only; a PayPal email does not pay them yet",
  "src/components/declutter/DeclutterSellView.tsx": "Declutter sales pay out through Stripe only; a PayPal email does not pay them yet",
};

const srcFiles = () =>
  walkSource([path.join(ROOT, "src")]).filter((p) => !/\.test\.(ts|tsx)$/.test(p) && !p.includes(`${path.sep}src${path.sep}test${path.sep}`));

function clientCode(): Map<string, string> {
  const code = new Map<string, string>();
  for (const f of srcFiles()) {
    const raw = readSource(f);
    if (raw !== null) code.set(rel(f), blankComments(raw));
  }
  return code;
}

export function renderers(code: Map<string, string>, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b`);
  return [...code].filter(([, c]) => re.test(c)).map(([f]) => f).sort();
}

describe("Get paid with PayPal: every entry point and member RPC follows the switch", () => {
  const defs = effectiveDefs(MIG);
  const granted = memberCallable();
  const code = clientCode();

  it("(s1-s3) every member-callable PayPal function starts with the switch, takes no ids and no verified/payable", () => {
    const { checked, bad } = serverViolations(defs, granted);
    expect(checked.length, "floor: the phase 2 RPCs are found").toBeGreaterThan(1);
    expect(checked).toEqual(expect.arrayContaining(["get_my_paypal_payee", "set_paypal_payee_email"]));
    expect(bad).toEqual([]);
  });

  it("(s1-s3) the scanner fails a planted member RPC (self-test)", () => {
    const planted = new Map([
      ["bad_payee", { stmt: "CREATE OR REPLACE FUNCTION public.bad_payee(p_user uuid, p_payable boolean) RETURNS void LANGUAGE plpgsql AS $fn$\nBEGIN\n  UPDATE public.payee_accounts SET payable = p_payable WHERE user_id = p_user;\nEND;\n$fn$;" }],
    ]);
    const { checked, bad } = serverViolations(planted, new Map([["bad_payee", true]]));
    expect(checked).toEqual(["bad_payee"]);
    expect(bad.length).toBe(4);
  });

  it("(s4) helper_accept_missing clears payout_setup through paypal_payee_ready, which reads the switch", () => {
    const gate = blankSqlComments(defs.get("helper_accept_missing")?.stmt ?? "");
    expect(gate).toMatch(/CASE WHEN \(p\.stripe_account_id IS NULL OR p\.stripe_payouts_enabled IS NOT TRUE\)\s+AND NOT public\.paypal_payee_ready\(p\.user_id\) THEN 'payout_setup' END/);
    const ready = blankSqlComments(defs.get("paypal_payee_ready")?.stmt ?? "");
    expect(ready).toMatch(/public\.feature_enabled_for_user\('paypal_payments', p_user_id\)/);
    expect(ready).toMatch(/AND a\.env = public\.paypal_payee_env\(\)\s+AND a\.payable/);
  });

  it("(s5) payout destinations are sandbox-only while live PayPal is refused", () => {
    expect(read("supabase/functions/_shared/payments/paypalClient.ts")).toMatch(/export const PAYPAL_LIVE_ALLOWED = false;/);
    const env = bodyOf(defs.get("paypal_payee_env")?.stmt ?? "");
    expect(env.trim()).toBe("SELECT 'sandbox'::text;");
  });

  it("(c1) in jobs code only PayoutSetupNotice renders the paused Stripe notice (exact both ways)", () => {
    const users = renderers(code, "PayoutSetupPausedNotice");
    expect(users.length, "floor").toBeGreaterThan(2);
    expect(users).toEqual(Object.keys(NOT_JOBS).sort());
    // and the jobs entry points render the wrapper instead
    expect(renderers(code, "PayoutSetupNotice").length).toBeGreaterThan(5);
  });

  it("(c2) the PayPal prompt, card and write each have their one caller, under the switch", () => {
    expect(renderers(code, "PayPalPayeePrompt")).toEqual(["src/components/payouts/PayoutSetupNotice.tsx"]);
    expect(renderers(code, "PayPalPayeeCard")).toEqual(["src/components/PaymentTab.tsx"]);
    const tab = code.get("src/components/PaymentTab.tsx") ?? "";
    expect(tab).toMatch(/const \{ on: paypal, settled: paypalSettled \} = useFeatureStatus\("paypal_payments"\);/);
    expect(tab).toMatch(/\) : paypal \? \(\s*<PayPalPayeeCard\b/);
    const notice = code.get("src/components/payouts/PayoutSetupNotice.tsx") ?? "";
    expect(notice).toMatch(/if \(paypal\.on\) \{\s*if \(paypal\.loading \|\| paypal\.ready\) return null;\s*return <PayPalPayeePrompt\b/);
    const writers = [...code].filter(([, c]) => /\.rpc\(\s*["']set_paypal_payee_email["']/.test(c)).map(([f]) => f);
    expect(writers).toEqual(["src/components/payouts/PayPalPayeeCard.tsx"]);
  });

  it("(c3) the paused words' other carriers are off for PayPal wherever the pause is read", () => {
    let rows = 0;
    const bad: string[] = [];
    for (const [f, c] of code) {
      if (f.endsWith("profileLanding/PayoutStatusRow.tsx") || f.startsWith("src/components/shops/")) continue;
      for (const m of c.matchAll(/<PayoutStatusRow\b[\s\S]*?\bsetupPaused=\{([^}]*)\}/g)) {
        rows++;
        if (!/paypal/i.test(m[1])) bad.push(`${f}: <PayoutStatusRow setupPaused={${m[1]}}> ignores PayPal`);
      }
      for (const m of c.matchAll(/\bclaimSetupStep\(\s*\w+\s*,\s*([^)]*)\)/g)) {
        rows++;
        if (!/paypal/i.test(m[1])) bad.push(`${f}: claimSetupStep(_, ${m[1]}) ignores PayPal`);
      }
    }
    expect(rows, "floor").toBeGreaterThan(2);
    expect(bad).toEqual([]);
  });

  it("(c4) the client accept gate counts a payable PayPal email, and both hooks pass it", () => {
    expect(acceptMissingFromProfile({ stripe_account_id: null }, { paypalReady: true })).toEqual([]);
    expect(acceptMissingFromProfile({ stripe_account_id: null }, { paypalReady: false })).toEqual(["payout_setup"]);
    expect(acceptMissingFromProfile({ stripe_account_id: null })).toEqual(["payout_setup"]);
    const hooks = code.get("src/hooks/useAwardBlockReason.ts") ?? "";
    expect(hooks.match(/acceptMissingFromProfile\(profile, \{ paypalReady: paypal\.ready \}\)/g)?.length).toBe(2);
    expect(hooks.match(/const paypal = usePayPalPayee\(\);/g)?.length).toBe(2);
  });
});
