/**
 * ME-006: the Helpr receives 100% of a tip; the card-processing fee is added on
 * top for the poster (owner, 2026-09-25: "The poster pays the fee so helpr gets
 * 100%").
 *
 * Class guarded: any tip charge path that pays the Helpr less than the tip
 * (a destination charge whose amount is the tip while an application fee is
 * retained from it), and any tip quote that is computed separately from the
 * charge. Three parts:
 *   1. `tipChargeBreakdown` itself: for every tip from 1 cent to $1,000 the
 *      Helpr's amount is the tip, charge - fee = tip, and the fee covers
 *      Stripe's card-rate cost on the whole charge.
 *   2. Every edge tip charge (inventory: each Stripe create call whose
 *      metadata says `type: "tip"`) takes its amount, line items and
 *      application fee from one `tipChargeBreakdown` result, and computes no
 *      fee of its own.
 *   3. Every client tip surface (inventory: each `action: "tip"` request, plus
 *      the Auto-tip settings page) quotes through TipCostBreakdown, which
 *      imports the edge module the server charges with.
 *
 * @mutate supabase/functions/auto-tip-charge/index.ts | amount: tipQuote.chargeCents, | amount: tipCents,
 * @mutate supabase/functions/_shared/tipFees.ts | helperCents: tip }; | helperCents: tip - feeCents };
 * @mutate src/components/TipDialog.tsx | import { TipCostBreakdown, TipTotalHint } from "@/components/TipCostBreakdown"; | import { TipCostBreakdown, TipTotalHint } from "@/components/TipCostBreakdownCopy";
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { tipChargeBreakdown, TIP_MAX_CENTS } from "../../supabase/functions/_shared/tipFees";
import { stripeProcessingCostCents } from "../../supabase/functions/_shared/stripeFees";

const ROOT = process.cwd();

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "test" || n === "__tests__" ? [] : walk(p, keep);
    return keep(n) ? [p] : [];
  });
}

/** Text of the balanced `( ... )` that starts at `open`. */
function balanced(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(open, i + 1);
  }
  throw new Error("unbalanced call");
}

describe("tipChargeBreakdown: the Helpr receives the whole tip", () => {
  it("for every tip from 1 cent to $1,000", () => {
    const bad: string[] = [];
    for (let tip = 1; tip <= TIP_MAX_CENTS; tip++) {
      const q = tipChargeBreakdown(tip);
      if (q.helperCents !== tip) bad.push(`${tip}: helper ${q.helperCents}`);
      else if (q.chargeCents - q.feeCents !== tip) bad.push(`${tip}: charge-fee ${q.chargeCents - q.feeCents}`);
      else if (q.feeCents < stripeProcessingCostCents(q.chargeCents)) bad.push(`${tip}: fee ${q.feeCents} < stripe ${stripeProcessingCostCents(q.chargeCents)}`);
      else if (q.feeCents - 1 >= stripeProcessingCostCents(q.chargeCents - 1)) bad.push(`${tip}: fee ${q.feeCents} not the smallest`);
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
  });

  it("prices the published examples (2.9% + 30c on the whole charge)", () => {
    expect(tipChargeBreakdown(500)).toEqual({ tipCents: 500, feeCents: 46, chargeCents: 546, helperCents: 500 });
    expect(tipChargeBreakdown(1000)).toEqual({ tipCents: 1000, feeCents: 61, chargeCents: 1061, helperCents: 1000 });
    expect(tipChargeBreakdown(2000)).toEqual({ tipCents: 2000, feeCents: 91, chargeCents: 2091, helperCents: 2000 });
  });
});

// ── Server: every Stripe create call that charges a tip ──────────────────────
const edgeFiles = walk(join(ROOT, "supabase/functions"), (n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));
const tipCalls = edgeFiles.flatMap((file) => {
  const code = blankComments(readFileSync(file, "utf8"));
  const out: { file: string; code: string; call: string; kind: "checkout" | "paymentIntent" }[] = [];
  for (const m of code.matchAll(/stripe\.(checkout\.sessions|paymentIntents)\.create\(/g)) {
    const call = balanced(code, m.index! + m[0].length - 1);
    if (/type:\s*"tip"/.test(call)) {
      out.push({ file: relative(ROOT, file), code, call, kind: m[1] === "paymentIntents" ? "paymentIntent" : "checkout" });
    }
  }
  return out;
});

describe("every edge tip charge takes its money fields from one tipChargeBreakdown", () => {
  it("the inventory is real (create-payment tip + auto-tip-charge)", () => {
    expect(tipCalls.length).toBeGreaterThan(1);
    expect(tipCalls.map((c) => c.file).sort()).toEqual([
      "supabase/functions/auto-tip-charge/index.ts",
      "supabase/functions/create-payment/index.ts",
    ]);
  });

  for (const c of tipCalls) {
    describe(c.file, () => {
      const v = c.code.match(/const\s+(\w+)\s*=\s*tipChargeBreakdown\(/)?.[1];

      it("imports tipChargeBreakdown from _shared/tipFees and computes no fee of its own", () => {
        expect(c.code).toMatch(/import\s*\{[^}]*\btipChargeBreakdown\b[^}]*\}\s*from\s*"\.\.\/_shared\/tipFees\.ts"/);
        expect(v).toBeTruthy();
        expect(c.code).not.toMatch(/stripeProcessingCostCents\(|stripePercentCostCents\(|STRIPE_PCT|STRIPE_FLAT_CENTS/);
      });

      it("retains exactly the breakdown's fee as the application fee", () => {
        expect(c.call).toMatch(new RegExp(`application_fee_amount:\\s*${v}\\.feeCents\\s*[,}]`));
      });

      it("charges tip + fee, so the destination transfer is the whole tip", () => {
        if (c.kind === "paymentIntent") {
          expect(c.call).toMatch(new RegExp(`\\bamount:\\s*${v}\\.chargeCents\\s*,`));
        } else {
          const units = [...c.call.matchAll(/unit_amount:\s*([^,\n}]+)/g)].map((m) => m[1].trim()).sort();
          expect(units).toEqual([`${v}.feeCents`, `${v}.tipCents`]);
        }
      });
    });
  }
});

// ── Client: every place a tip is quoted ───────────────────────────────────────
const srcFiles = walk(join(ROOT, "src"), (n) => /\.tsx?$/.test(n) && !/\.test\./.test(n));
const tipSurfaces = srcFiles
  .filter((f) => /body:\s*\{[^{}]*action:\s*"tip"/.test(blankComments(readFileSync(f, "utf8"))) || f.endsWith("src/pages/profile/AutoTip.tsx"))
  .map((f) => relative(ROOT, f))
  .sort();

describe("every client tip quote uses the server's definition", () => {
  it("the inventory is real (TipDialog, CompletionPrompts, AutoTip)", () => {
    expect(tipSurfaces.length).toBeGreaterThan(2);
  });

  it("TipCostBreakdown quotes from the edge module the server charges with", () => {
    const code = blankComments(readFileSync(join(ROOT, "src/components/TipCostBreakdown.tsx"), "utf8"));
    expect(code).toMatch(/import\s*\{[^}]*\btipChargeBreakdown\b[^}]*\}\s*from\s*"(\.\.\/)+supabase\/functions\/_shared\/tipFees"/);
    expect(code).not.toMatch(/stripeProcessingCostCents|STRIPE_PCT|STRIPE_FLAT_CENTS|0\.029/);
  });

  for (const f of tipSurfaces) {
    it(`${f} quotes through TipCostBreakdown and computes no tip fee itself`, () => {
      const code = blankComments(readFileSync(join(ROOT, f), "utf8"));
      expect(code).toMatch(/from\s*"@\/components\/TipCostBreakdown"/);
      expect(code).not.toMatch(/stripeProcessingCostCents|STRIPE_PCT|STRIPE_FLAT_CENTS|0\.029/);
    });
  }
});
