/**
 * CLASS GUARD — a referral credit that fails to mint must not fail silently.
 *
 * History this exists for: `process_referral` was called from the browser
 * moments after `auth.signUp`, which returns NO session while email
 * confirmation is on. The RPC is granted to `authenticated` and asserts
 * `auth.uid() = p_new_user_id`, so the call was 401 `42501 permission denied`
 * one hundred percent of the time — and the client only `report()`ed it. Prod
 * ended up holding 29 `referral_codes`, ZERO `referrals`, and two
 * `referral_credits` that were both hand-seeded. Not one referral was ever
 * credited, for months, and nothing anywhere said so.
 *
 * The path now travels in `complete-signup`'s body via
 * `record_referral_signup` (service-role only), proven end to end on prod
 * 2026-09-22: code FUHNW3 minted a $5 `first_job_bonus` and a $5
 * `referrer_bonus`, then was cleaned up.
 *
 * What is asserted, and why each catches the CLASS rather than that one bug:
 *
 *  1. NO UNPRIVILEGED CALLER — the referral-minting RPC names are read out of
 *     the migrations (any `CREATE … FUNCTION public.<name>` whose body writes
 *     `referral_credits`), and no file under `src/` may call any of them.
 *     `src/` is the browser bundle, where the session may not exist yet; that
 *     is the exact shape of the original defect, and it would come back the
 *     moment anyone "helpfully" re-adds a client-side call for any of these
 *     functions — including one that does not exist yet.
 *
 *  2. THE OUTCOME IS REPORTED — the real `complete-signup` source is run
 *     through the edge harness. Whatever happens to the referral, the caller
 *     is told: `referralRecorded` is true only when the RPC actually returned
 *     true, and false when it errored or declined. A referral that did not
 *     mint must never be indistinguishable from one that did.
 *
 *  3. THE FAILURE IS RECORDED — when the RPC errors, the function logs it
 *     with the user and the code. Best-effort minting is a product decision;
 *     dropping the error is what made it invisible.
 *
 * @mutate supabase/functions/complete-signup/index.ts | referralRecorded = referralOk === true; | referralRecorded = true;
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SRC = join(ROOT, "src");

/**
 * Every Postgres function that mints a referral credit, read out of the
 * migration tree. A function qualifies if its definition text (from its
 * `CREATE … FUNCTION public.<name>` header to the next one) writes the
 * `referral_credits` table.
 *
 * Derived rather than listed on purpose: this repo has been burned by a
 * registry that was both the input and the oracle. A new minting RPC lands
 * in this set automatically and is held to the same rule.
 */
function referralMintingFunctions(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS)) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const header = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    const starts: Array<{ name: string; at: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) starts.push({ name: m[1], at: m.index });
    for (let i = 0; i < starts.length; i++) {
      const body = sql.slice(starts[i].at, starts[i + 1]?.at ?? sql.length);
      // A minting function is one that writes the referral ledger itself:
      // `referrals` (the link that earns the bonus) or `referral_credits`
      // (the bonus). `referral_codes` is just the share link and does not
      // count. Delegating wrappers are caught by the same sweep because they
      // are listed in the same migrations as the body they share.
      if (/(insert\s+into|update)\s+(public\.)?(referrals|referral_credits)\b/i.test(body)) {
        names.add(starts[i].name);
      }
    }
  }
  return [...names].sort();
}

/** Every .ts/.tsx file under src/, excluding the test tree and generated types. */
function clientSourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "__tests__") continue;
      out.push(...clientSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Generated Supabase typings name every RPC in the schema; they are a
    // type declaration, not a call site.
    if (full.endsWith(join("integrations", "supabase", "types.ts"))) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Remove // and block comments. Without this the sweep below matches the
 * long comment in `src/pages/Signup.tsx` that exists precisely to explain
 * why the client call was REMOVED — a guard that fires on its own fix.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}


const USER_ID = "11111111-1111-1111-1111-111111111111";

async function loadCompleteSignup(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/**
 * A signup that is complete in every other respect, arriving with a referral
 * code off a `?ref=` share link.
 */
function seedSignup() {
  // The unauthenticated initial-completion path the signup form uses: a fresh
  // auth user inside the 30-minute window, never signed in, empty profile.
  scenario.adminUsers = {
    [USER_ID]: {
      email: "newbie@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [
      {
        bio: null,
        approval_status: "pending",
        full_name: "Newbie R",
        location: "Lafayette",
        user_id: USER_ID,
      },
    ],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

async function runSignup(): Promise<Record<string, unknown>> {
  const fn = await loadCompleteSignup();
  const res = await fn.fetch(
    fn.request({
      body: {
        userId: USER_ID,
        location: "Lafayette",
        zipCode: "70501",
        parish: "Lafayette",
        phone: "(337) 555-0142",
        ageAttested: true,
        termsAccepted: true,
        // What a `?ref=` share link forwards — deliberately scruffy casing
        // and whitespace, because that is what a pasted code looks like.
        referralCode: " fuhnw3 ",
      },
    }),
  );
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

describe("a referral credit can never fail to mint silently", () => {
  let errorLog: unknown[][];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    errorLog = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLog.push(args);
    });
  });

  afterEach(() => spy.mockRestore());

  describe("no unprivileged caller", () => {
    it("finds the referral-minting functions in the migrations at all", () => {
      // Without this, the rule below could pass because the derivation broke,
      // not because the tree is clean.
      const minters = referralMintingFunctions();
      expect(minters.length).toBeGreaterThan(0);
      expect(minters).toContain("process_referral");
      expect(minters).toContain("record_referral_signup");
    });

    it("no file in the browser bundle calls a referral-minting RPC", () => {
      const minters = referralMintingFunctions();
      const offenders: string[] = [];
      for (const file of clientSourceFiles()) {
        const text = stripComments(readFileSync(file, "utf8"));
        for (const name of minters) {
          // `.rpc("<name>"` / `.rpc('<name>'` — a call, not a mention in prose.
          if (new RegExp(`\\.rpc\\(\\s*["'\`]${name}["'\`]`).test(text)) {
            offenders.push(`${file.slice(ROOT.length + 1)} → ${name}`);
          }
        }
      }
      expect(
        offenders,
        `These browser files call a referral-minting RPC directly:\n  ${offenders.join("\n  ")}\n` +
          `The browser has no session at signup time (email confirmation is on), so the call returns ` +
          `401 42501 and the credit is never minted. That is how prod reached 29 referral codes and 0 ` +
          `referrals. Referral minting belongs in complete-signup's service-role body.`,
      ).toEqual([]);
    });
  });

  describe("complete-signup reports the referral outcome", () => {
    it("says referralRecorded=true only when the RPC actually minted", async () => {
      seedSignup();
      scenario.rpc.record_referral_signup = true;
      const body = await runSignup();
      expect(body.referralRecorded).toBe(true);
    });

    it("says referralRecorded=false when the RPC declines the code", async () => {
      seedSignup();
      // Unknown code / self-referral / already referred — the RPC returns false.
      scenario.rpc.record_referral_signup = false;
      const body = await runSignup();
      expect(
        body.referralRecorded,
        "the response claimed a referral was recorded when the RPC declined it — a caller " +
          "(and every future dashboard built on this field) cannot tell a minted credit from a " +
          "no-op, which is exactly the blindness that hid this for months",
      ).toBe(false);
    });

    it("says referralRecorded=false AND logs the reason when the RPC errors", async () => {
      seedSignup();
      scenario.rpcErrors = {
        record_referral_signup: { message: "permission denied for function record_referral_signup", code: "42501" },
      };
      const body = await runSignup();

      expect(
        body.referralRecorded,
        "the referral RPC failed outright and the response still reported a recorded referral",
      ).toBe(false);

      const logged = errorLog.map((a) => a.map(String).join(" ")).join("\n");
      expect(
        logged,
        "the referral RPC errored and nothing was logged. Minting best-effort is a product " +
          "decision; swallowing the error is the defect — it is what made a 100%-failing referral " +
          "path invisible for months.",
      ).toMatch(/referral/i);
      expect(logged, "the log did not name the user the referral was lost for").toContain(USER_ID);
    });

    it("still completes the signup when the referral fails", async () => {
      // The other half of the contract: loud, but never fatal. A failed $5
      // bonus must not cost the account.
      seedSignup();
      scenario.rpcErrors = {
        record_referral_signup: { message: "permission denied", code: "42501" },
      };
      const body = await runSignup();
      expect(body.success).toBe(true);
    });

    it("sends the code normalised, so a share link's casing is never the reason it fails", async () => {
      seedSignup();
      scenario.rpc.record_referral_signup = true;
      await runSignup();
      const call = (scenario.rpcCalls ?? []).find((c) => c.name === "record_referral_signup");
      expect(call, "complete-signup never attempted to record the referral at all").toBeDefined();
      expect((call?.args as Record<string, unknown>)?.p_referral_code).toBe("FUHNW3");
    });
  });
});
