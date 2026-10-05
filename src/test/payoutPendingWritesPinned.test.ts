// Q1321 class guard. payment_status 'payout_pending' is what the payout cron
// pays from, so every edge write that SETS it must pin the payment_status it
// is moving from in the same chain. create-payment's `release` ("mark
// complete") set it from a dynamic updateFields object with no payment_status
// predicate at all, so it wrote payout_pending over 'cancelling' (a refund in
// flight), 'refunded', 'chargeback' and 'unpaid', and the cron paid the Helpr.
//
// Inventory comes from the source: every edge-function file, every literal or
// assigned payout_pending write. A write's chain runs to its `.select(`; the
// pin (.eq/.in on "payment_status") must sit inside it.
//
// @mutate supabase/functions/create-payment/index.ts |         if (updateFields.payment_status === "payout_pending") conditional = conditional.eq("payment_status", "escrow"); |         void 0;
// @mutate supabase/functions/auto-release-payment/index.ts |         .eq("payment_status", "escrow")\n        .select("id"); |         .select("id");
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = join(ROOT, "supabase/functions");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const WRITE = /payment_status\s*:\s*["']payout_pending["']|\.payment_status\s*=\s*["']payout_pending["']\s*;/g;
const PIN = /\.(?:eq|in)\(\s*["']payment_status["']/;

type Site = { file: string; line: number; pinned: boolean };

function payoutPendingSites(file: string, text: string): Site[] {
  const src = blankComments(text);
  const out: Site[] = [];
  for (const m of src.matchAll(WRITE)) {
    const from = m.index ?? 0;
    const sel = src.indexOf(".select(", from);
    const end = sel === -1 ? Math.min(src.length, from + 2500) : Math.min(sel + 20, from + 4000);
    out.push({ file, line: src.slice(0, from).split("\n").length, pinned: PIN.test(src.slice(from, end)) });
  }
  return out;
}

const sites = walk(FUNCTIONS).flatMap((f) => payoutPendingSites(relative(ROOT, f), readFileSync(f, "utf8")));

describe("Q1321: every edge write that sets payment_status 'payout_pending' pins the state it moves from", () => {
  it("inventory: finds the payout_pending writers (floor)", () => {
    expect(sites.length).toBeGreaterThan(5);
    expect(sites.some((s) => s.file === "supabase/functions/create-payment/index.ts")).toBe(true);
  });

  it("every payout_pending write carries a payment_status pin in its chain", () => {
    expect(sites.filter((s) => !s.pinned).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it("the scanner flags an unpinned write (shown able to fail)", () => {
    const planted = 'updateFields.payment_status = "payout_pending";\nconst { data } = await db.from("jobs").update(updateFields).eq("id", id).eq("status", s).select("id");';
    expect(payoutPendingSites("x.ts", planted)).toEqual([{ file: "x.ts", line: 1, pinned: false }]);
  });
});
