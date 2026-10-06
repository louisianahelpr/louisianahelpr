/**
 * Q837: every edge function that verifies its caller refuses an
 * unconfirmed-email caller, or is a named exemption.
 *
 * Q807 (20260927234313) refuses writes from an unconfirmed session on every
 * public table, but it reads auth.uid(). An edge function that verifies the
 * caller with auth.getUser() and then writes with the SERVICE ROLE runs with
 * auth.uid() NULL, so the table gate cannot see the end user. Each such
 * function calls refuseUnconfirmedEmail (supabase/functions/_shared/
 * requireConfirmedEmail.ts) on the user getUser() verified, right after its
 * own 401.
 *
 * INVENTORY, from the functions themselves: every supabase/functions/<fn>/
 * folder (all its .ts/.tsx files, comments blanked) that resolves its caller
 * with auth.getUser( or auth.getClaims(. The set must EQUAL GATED + EXEMPT
 * (two-way, exact). A GATED function must, in index.ts after its getUser
 * call, hold the canonical pair
 *   const <x> = refuseUnconfirmedEmail(<user>, corsHeaders); if (<x>) return <x>;
 * with no write, RPC, Stripe call or fetch between the call and the pair.
 * No _shared module may resolve a caller (a gate there would be invisible).
 *
 * RUNTIME, through the edge harness (2026-10-03): create-payment and
 * cash-out-credits refuse a verified caller with no email_confirmed_at with
 * the user-facing sentence in `error` and the code in `code`, and write
 * nothing (no table write, RPC or Stripe call); a confirmed caller is not
 * stopped.
 */
// @mutate supabase/functions/create-payment/index.ts |     const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);\n    if (unconfirmedEmail) return unconfirmedEmail; |     const unconfirmedEmail = null;
// @mutate supabase/functions/_shared/requireConfirmedEmail.ts |   return !user?.email_confirmed_at; |   return false;
// A gate whose refusal is discarded (lh-authz-rls review of Q837):
// @mutate supabase/functions/str-ical-sync/index.ts | if (unconfirmedEmail) return unconfirmedEmail; |
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import {
  emailUnconfirmed,
  refuseUnconfirmedEmail,
  EMAIL_UNCONFIRMED,
  EMAIL_UNCONFIRMED_MESSAGE,
} from "../../../supabase/functions/_shared/requireConfirmedEmail";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const FUNCTIONS = resolve(__dirname, "../../../supabase/functions");

/** Gated: resolves its caller with getUser() and refuses an unconfirmed one. EXACT. */
const GATED = [
  "ai-job-builder",
  "calculate-tax",
  "cash-out-credits",
  "check-pro-subscription",
  "claim-gift-card",
  "create-bgc-payment",
  "create-boost-payment",
  "create-gift-card-checkout",
  "create-notification",
  "create-payment",
  "create-pro-checkout",
  "instant-job-match",
  "instant-payout",
  "notify-email-change",
  "pay-onboarding-fee",
  "pro-customer-portal",
  "str-ical-sync",
  "stripe-connect",
  "stripe-idv-start",
  "stripe-payouts",
];

/** Exempt from the gate, each with why. EXACT. */
// @two-way src/test/edge/requireConfirmedEmail.test.ts:stale EXEMPT entries
const EXEMPT: Record<string, string> = {
  "complete-signup": "finishes the signup an unconfirmed account is in the middle of",
  "contact-support": "an unconfirmed user must be able to ask for help",
  "delete-own-account": "an unconfirmed user may always leave",
  "export-my-data": "an unconfirmed user may always see what we hold (read-only)",
  "verify-apple-iap": "Apple has already charged: never refuse a paid purchase (grant and flag); the gate belongs at purchase time (Q1200)",
  "admin-delete-user": "admin only: requires the admin role",
  "admin-resend-verification": "admin only: requires the admin role",
  "admin-user-actions": "admin only: requires the admin role",
  "admin-test-push": "admin only: requires the admin role",
  "admin-update-email": "admin only: requires the admin role (getClaims)",
  "execute-dispute-split": "admin only: requires the admin role",
  "release-payout": "admin only on the user path: requires the admin role",
  "payout-hold-stripe-sync": "admin only on the user path: requires the admin role (Q1221)",
  "send-account-status-email": "admin only on the user path: requires the admin role",
  "send-marketing-blast": "admin only: requires the admin role",
  "health-check": "admin only on the user path (getClaims + has_role admin, else 403); read-only probe",
};

const RESOLVES_CALLER = /\.auth\.(?:getUser|getClaims)\s*\(/;
const GATE_PAIR = /const\s+(\w+)\s*=\s*refuseUnconfirmedEmail\(([\w.?]+),\s*corsHeaders\);\s*if\s*\(\1\)\s*return\s+\1;/;
const SIDE_EFFECT = /\.(?:insert|update|upsert|delete)\(|\.rpc\(|\bstripe\.|new Stripe\(|\bfetch\(|fetchFunction\(|functions\.invoke\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out.sort();
}

function inventory(): { fn: string; folder: string; index: string }[] {
  return readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => {
      const dir = join(FUNCTIONS, d.name);
      const indexPath = join(dir, "index.ts");
      return {
        fn: d.name,
        folder: sourceFiles(dir).map((f) => blankComments(readFileSync(f, "utf8"))).join("\n"),
        index: existsSync(indexPath) ? blankComments(readFileSync(indexPath, "utf8")) : "",
      };
    })
    .filter(({ folder }) => RESOLVES_CALLER.test(folder));
}

/**
 * Names the getUser statement binds: `const { data: { user } } = ...` -> user;
 * `const { data: userData, error } = ...` -> userData, error; `const res = ...`
 * -> res. A key followed by `:` is not a binding.
 */
function getUserBindings(code: string, at: number): Set<string> {
  const start = code.lastIndexOf("const", at);
  const stmt = code.slice(start, at);
  const pattern = /const\s+([\s\S]*?)=\s*(?:await\s+)?[\w.]*$/.exec(stmt)?.[1] ?? "";
  return new Set([...pattern.matchAll(/\b([A-Za-z_]\w*)\b(?!\s*:)/g)].map((m) => m[1]));
}

/** Why a gated function's index.ts fails the rule, or null. */
export function ungated(code: string): string | null {
  const at = code.search(/\.auth\.getUser\s*\(/);
  if (at < 0) {
    return /\.auth\.getClaims\s*\(/.test(code)
      ? "resolves its caller with getClaims: claims carry no email_confirmed_at, use auth.getUser()"
      : "does not resolve its caller with auth.getUser()";
  }
  const rest = code.slice(at);
  const pair = GATE_PAIR.exec(rest);
  if (!pair) return "has no `const x = refuseUnconfirmedEmail(user, corsHeaders); if (x) return x;` after getUser";
  const between = rest.slice(0, pair.index);
  const effect = SIDE_EFFECT.exec(between);
  if (effect) return `does \`${effect[0]}\` before the gate`;
  // The user handed to the gate is the one getUser verified: its root is bound
  // by the getUser statement, or by `const <name> = <bound>.user` after it
  // (never a request body's `user`; lh-authz-rls review of Q837).
  const bound = getUserBindings(code, at);
  for (const m of between.matchAll(/const\s+(\w+)\s*=\s*(\w+)\??\.user\s*;/g)) if (bound.has(m[2])) bound.add(m[1]);
  const root = /^(\w+)/.exec(pair[2])?.[1] ?? "";
  if (!bound.has(root)) return `gates \`${pair[2]}\`, which is not the user auth.getUser() returned`;
  if (!/import\s*\{[^}]*\brefuseUnconfirmedEmail\b[^}]*\}\s*from\s*["']\.\.\/_shared\/requireConfirmedEmail\.ts["']/.test(code)) {
    return "calls refuseUnconfirmedEmail without importing the shared helper";
  }
  return null;
}

describe("Q837: an edge function refuses an unconfirmed-email caller", () => {
  const all = inventory();

  it("the inventory is exact: every function that resolves its caller is GATED or EXEMPT (two-way)", () => {
    // Floor: an empty read of supabase/functions would make every check below pass.
    expect(all.length).toBeGreaterThan(30);
    expect(all.map((x) => x.fn).sort()).toEqual([...GATED, ...Object.keys(EXEMPT)].sort());
    expect(GATED.filter((fn) => EXEMPT[fn])).toEqual([]);
  });

  it("every GATED function holds the canonical gate after getUser, before any side effect", () => {
    const offenders = all
      .filter((x) => GATED.includes(x.fn))
      .map((x) => [x.fn, ungated(x.index)] as const)
      .filter(([, why]) => why)
      .map(([fn, why]) => `${fn}: ${why}`);
    expect(offenders, "add `const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders); if (unconfirmedEmail) return unconfirmedEmail;` right after the 401").toEqual([]);
  });

  it("stale EXEMPT entries: each still resolves its caller and does not call the gate", () => {
    const byFn = new Map(all.map((x) => [x.fn, x.folder]));
    const stale = Object.keys(EXEMPT).filter((fn) => !byFn.has(fn) || byFn.get(fn)!.includes("refuseUnconfirmedEmail("));
    expect(stale).toEqual([]);
  });

  it("no _shared module resolves a caller (a gate behind it would be invisible here)", () => {
    const shared = sourceFiles(join(FUNCTIONS, "_shared"))
      .filter((f) => !f.endsWith("requireConfirmedEmail.ts"))
      .filter((f) => RESOLVES_CALLER.test(blankComments(readFileSync(f, "utf8"))));
    expect(shared).toEqual([]);
  });

  it("the helper follows the database's rule (session_email_unconfirmed: no email_confirmed_at)", async () => {
    expect(emailUnconfirmed(null)).toBe(true);
    expect(emailUnconfirmed({})).toBe(true);
    expect(emailUnconfirmed({ email_confirmed_at: null })).toBe(true);
    expect(emailUnconfirmed({ email_confirmed_at: "2026-10-03T00:00:00Z" })).toBe(false);
    const r = refuseUnconfirmedEmail({ email_confirmed_at: null }, { "Access-Control-Allow-Origin": "*" });
    expect(r?.status).toBe(403);
    expect(r?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // The client shows `error`; `code` is the machine reason (supabaseResult.ts reads body.error).
    const body = await r!.json();
    expect(body).toEqual({ error: EMAIL_UNCONFIRMED_MESSAGE, code: EMAIL_UNCONFIRMED });
    expect(body.error).toMatch(/^Confirm your email/);
    expect(refuseUnconfirmedEmail({ email_confirmed_at: "2026-10-03T00:00:00Z" }, {})).toBeNull();
  });

  it("can fail: a missing gate, a discarded refusal, a gate after a write, claims instead of the user", () => {
    const head = `import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";\n`;
    expect(ungated(`${head}const { data } = await supabase.auth.getUser(token); await admin.from("x").insert({});`)).toMatch(/has no/);
    expect(ungated(`${head}const { data } = await supabase.auth.getUser(token); const u = refuseUnconfirmedEmail(data.user, corsHeaders);`)).toMatch(/has no/);
    expect(
      ungated(`${head}const { data } = await supabase.auth.getUser(token); await admin.from("x").insert({}); const u = refuseUnconfirmedEmail(data.user, corsHeaders); if (u) return u;`),
    ).toMatch(/before the gate/);
    expect(ungated(`${head}const { data } = await c.auth.getClaims(token); const u = refuseUnconfirmedEmail(data, corsHeaders); if (u) return u;`)).toMatch(/getClaims/);
    // A user object from the request body is not the verified caller.
    expect(
      ungated(`${head}const { data } = await supabase.auth.getUser(token); const reqBody = await req.json(); const u = refuseUnconfirmedEmail(reqBody.user, corsHeaders); if (u) return u;`),
    ).toMatch(/not the user auth\.getUser\(\) returned/);
    expect(ungated(`${head}const { data } = await supabase.auth.getUser(token); const u = refuseUnconfirmedEmail(data.user, corsHeaders); if (u) return u;`)).toBeNull();
    expect(ungated(`${head}const { data: { user }, error } = await c.auth.getUser(); const u = refuseUnconfirmedEmail(user, corsHeaders); if (u) return u;`)).toBeNull();
    expect(ungated(`${head}const { data } = await c.auth.getUser(t); const user = data.user; const u = refuseUnconfirmedEmail(user, corsHeaders); if (u) return u;`)).toBeNull();
  });

  describe("runtime, through the edge harness", () => {
    const JWT = "Bearer caller.jwt.sig";
    beforeEach(() => {
      resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
      setEnv({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        SECRET_KEY: "service-key",
        SUPABASE_ANON_KEY: "anon-key",
        PUBLISHABLE_KEY: "anon-key",
        STRIPE_SECRET_KEY: "sk_test_gate",
      });
    });
    const call = async (name: string) => {
      const fn = await loadEdgeFunction(name);
      return fn.fetch(fn.request({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: JWT },
        body: { job_id: "job-1", attempt_id: "11111111-2222-4333-8444-555555555555" },
      }));
    };

    it.each(["create-payment", "cash-out-credits"])("%s answers 403 to an unconfirmed caller and does nothing", async (name) => {
      scenario.authUser = { id: "u-1", email: "u@example.com", email_confirmed_at: null };
      const res = await call(name);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe(EMAIL_UNCONFIRMED);
      expect(body.error).toMatch(/^Confirm your email/);
      expect(scenario.writes).toEqual([]);
      expect(scenario.rpcCalls).toEqual([]);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("a confirmed caller is not stopped by the gate (it reaches the function's own 400)", async () => {
      scenario.authUser = { id: "u-1", email: "u@example.com" }; // the mock confirms by default
      const res = await call("create-notification");
      expect(res.status).toBe(400);
    });
  });
});
