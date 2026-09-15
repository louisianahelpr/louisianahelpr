import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  FROM_BEING_REFERRED_REASONS,
  FROM_REFERRING_REASONS,
  referralEarningsBreakdown,
  sourceOfReason,
} from "./referralEarnings";
import { ReferralExtras } from "@/components/profile/ReferralExtras";

const REPO = resolve(__dirname, "../..");

describe("referralEarningsBreakdown (VN-45)", () => {
  it("the owner's case: $15 of credit, none of it from referring anyone, is explained", () => {
    const b = referralEarningsBreakdown([
      { amount: 5, reason: "first_job_bonus", redeemed: false },
      { amount: 5, reason: "legacy_seed", redeemed: false },
      { amount: 5, reason: null, redeemed: false },
    ]);
    expect(b.total).toBe(15);
    expect(b.unredeemed).toBe(15);
    expect(b.fromReferring).toBe(0);
    expect(b.fromBeingReferred).toBe(5);
    expect(b.other).toBe(10);
    expect(b.needsExplanation).toBe(true);
    expect(b.lines.map((l) => [l.label, l.amount])).toEqual([
      ["From being referred", 5],
      ["Other credits", 10],
    ]);
  });

  it("referrer and upgrade bonuses count as earned from referrals; nothing to explain", () => {
    const b = referralEarningsBreakdown([
      { amount: 5, reason: "referrer_bonus", redeemed: true },
      { amount: "10", reason: "subscription_bonus", redeemed: false },
    ]);
    expect(b.total).toBe(15);
    expect(b.unredeemed).toBe(10);
    expect(b.fromReferring).toBe(15);
    expect(b.needsExplanation).toBe(false);
    expect(b.lines).toEqual([{ source: "fromReferring", label: "From your referrals", amount: 15 }]);
  });

  it("money totals are every row, whatever the reason — what cash-out-credits pays", () => {
    const rows = [
      { amount: 5, reason: "referrer_bonus", redeemed: false },
      { amount: 5, reason: "first_job_bonus", redeemed: false },
      { amount: 2.5, reason: "admin_grant", redeemed: true },
    ];
    const b = referralEarningsBreakdown(rows);
    expect(b.total).toBe(12.5);
    expect(b.unredeemed).toBe(10);
    expect(b.fromReferring + b.fromBeingReferred + b.other).toBe(b.total);
  });

  it("sums in cents and ignores unparseable amounts", () => {
    const b = referralEarningsBreakdown([
      { amount: 0.1, reason: "referrer_bonus", redeemed: false },
      { amount: 0.2, reason: "referrer_bonus", redeemed: false },
      { amount: "not-a-number", reason: "referrer_bonus", redeemed: false },
    ]);
    expect(b.total).toBe(0.3);
    expect(b.fromReferring).toBe(0.3);
  });

  it("no credits: zeros, no lines, nothing to explain", () => {
    const b = referralEarningsBreakdown([]);
    expect(b).toMatchObject({ total: 0, unredeemed: 0, needsExplanation: false, lines: [] });
  });

  it("an unknown reason is never counted as a referral", () => {
    expect(sourceOfReason("referrer_bonus_v2")).toBe("other");
    expect(sourceOfReason(undefined)).toBe("other");
  });
});

describe("the rank ladder shows referral earnings, not every credit", () => {
  it("renders the from-referrals amount with its label", () => {
    render(<ReferralExtras referralCount={0} earnedFromReferrals={0} />);
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getByText("from referrals")).toBeTruthy();
  });
});

describe("class guard: every credit the ledger can hold is classified, and the page reads one definition", () => {
  const MIGRATIONS = resolve(REPO, "supabase/migrations");

  /** Newest body of every public function, by migration order. */
  function newestBodies(): string[] {
    const out = new Map<string, string>();
    const def = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\s*\([\s\S]*?\$([A-Za-z_]*)\$([\s\S]*?)\$\2\$/gi;
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      for (const m of readFileSync(resolve(MIGRATIONS, f), "utf8").matchAll(def)) out.set(m[1].toLowerCase(), m[3]);
    }
    return [...out.values()];
  }

  /** Reasons minted by SQL: `INSERT INTO public.referral_credits (cols) VALUES (vals)`, reason column by position. */
  function sqlReasons(): string[] {
    const found: string[] = [];
    const ins = /INSERT INTO (?:public\.)?referral_credits\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/gi;
    for (const body of newestBodies()) {
      const code = body.replace(/--[^\n]*/g, "");
      for (const m of code.matchAll(ins)) {
        const cols = m[1].split(",").map((c) => c.trim());
        const vals = m[2].split(",").map((v) => v.trim());
        const i = cols.indexOf("reason");
        const lit = i >= 0 ? /^'([a-z_]+)'$/.exec(vals[i] ?? "") : null;
        expect(lit, `referral_credits INSERT with a non-literal reason: ${m[0]}`).toBeTruthy();
        found.push(lit![1]);
      }
    }
    return found;
  }

  /** Reasons minted by edge functions: `.from("referral_credits") … .insert({ … reason: "x" … })`. */
  function edgeReasons(): string[] {
    const found: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    for (const file of walk(resolve(REPO, "supabase/functions"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\.from\(\s*["']referral_credits["']\s*\)\s*\.(?:insert|upsert)\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        const r = /reason:\s*["']([a-z_]+)["']/.exec(m[1]);
        expect(r, `${file}: referral_credits insert with no literal reason`).toBeTruthy();
        found.push(r![1]);
      }
    }
    return found;
  }

  it("every minted reason is FROM_REFERRING or FROM_BEING_REFERRED (none silently lands in 'Other credits')", () => {
    const sql = sqlReasons();
    const edge = edgeReasons();
    // The scan itself can fail: today's minters are check_referral_bonus and check-pro-subscription.
    expect(sql).toEqual(expect.arrayContaining(["first_job_bonus", "referrer_bonus"]));
    expect(edge).toContain("subscription_bonus");
    const classified = [...FROM_REFERRING_REASONS, ...FROM_BEING_REFERRED_REASONS];
    const unclassified = [...new Set([...sql, ...edge])].filter((r) => !classified.includes(r));
    expect(unclassified, "classify each new referral_credits reason in src/lib/referralEarnings.ts").toEqual([]);
  });

  it("the Referrals page never reduces the credit list outside referralEarningsBreakdown", () => {
    // The original VN-45 shape: `credits.reduce(...)` for the tiles, handed
    // straight to the ladder as its "earned" figure.
    for (const file of ["src/components/ReferralSection.tsx", "src/components/profile/ReferralExtras.tsx"]) {
      const code = readFileSync(resolve(REPO, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      expect(code, file).not.toMatch(/credits\s*\.\s*(?:reduce|filter)\s*\(/);
    }
    const section = readFileSync(resolve(REPO, "src/components/ReferralSection.tsx"), "utf8");
    expect(section).toMatch(/referralEarningsBreakdown\(credits\)/);
    expect(section).toMatch(/earnedFromReferrals=\{earnings\.fromReferring\}/);
  });
});
