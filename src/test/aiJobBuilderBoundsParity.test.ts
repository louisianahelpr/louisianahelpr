/**
 * GUARD (Q54, front/back parity): the bounds `ai-job-builder` puts on the
 * model's output (supabase/functions/ai-job-builder/sanitize.ts) against the
 * bounds of the post-job form the output is poured into
 * (src/pages/post-job/useJobEntry.ts applyAiJob assigns every field verbatim).
 *
 * FOUND 2026-09-26 (Q54 sweep): only the title agrees. Every other field the
 * sanitizer bounds is looser than the form, so a generated posting can land in
 * the form already over its own limits:
 *   - description:   sanitizer 4000 chars, form DESCRIPTION_MAX 1000 (maxLength
 *                    does not truncate a programmatic value; no DB CHECK on
 *                    jobs.description, so it would post at 4000);
 *   - special_requirements: sanitizer 1000, form textarea maxLength 500;
 *   - budget:        sanitizer clamps to [0, 100000], the form, the create-payment
 *                    check and jobs_budget_range allow [10, 1000];
 *   - helpers_needed: sanitizer clamps to [1, 20], the group-job input is [2, 10].
 * The sanitizer is server code; this lane records the drift instead of
 * changing it (docs/audit/parity-matrix-2026-09-26.md, finding F1).
 *
 * KNOWN_DRIFT is EXACT, both directions: a new drift fails, and so does fixing
 * one without deleting its entry here.
 *
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | const TITLE_MAX = 32; | const TITLE_MAX = 40;
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | const DESCRIPTION_MAX = 4000; | const DESCRIPTION_MAX = 1000;
 * @mutate supabase/functions/ai-job-builder/sanitize.ts | const MAX_HELPERS = 20; | const MAX_HELPERS = 10;
 * @mutate src/components/postjob/detailsSection/detailsSectionConstants.ts | export const TITLE_MAX = 32; | export const TITLE_MAX = 28;
 * @mutate src/components/postjob/LogisticsSection.tsx | rows={2} maxLength={500} autoCapitalize="sentences" | rows={2} maxLength={1000} autoCapitalize="sentences"
 */
import { describe, it, expect } from "vitest";
import { numericConst, readCode } from "./helpers/parityReaders";
import { MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS } from "@/lib/moneyLimits";

const SANITIZE = "supabase/functions/ai-job-builder/sanitize.ts";
const FORM_CONSTS = "src/components/postjob/detailsSection/detailsSectionConstants.ts";
const LOGISTICS = "src/components/postjob/LogisticsSection.tsx";

/** `num(r.<field>, lo, HI)` in sanitizeJob → [lo, hi]. */
function sanitizerClamp(field: string): [number, number] {
  const code = readCode(SANITIZE);
  const m = new RegExp(`num\\(r\\.${field},\\s*(\\d+),\\s*([A-Z_]+|\\d+)\\)`).exec(code);
  if (!m) throw new Error(`${SANITIZE}: ${field} is no longer clamped by num()`);
  const hi = /^\d+$/.test(m[2]) ? Number(m[2]) : numericConst(SANITIZE, m[2]);
  return [Number(m[1]), hi];
}
/** `str(r.<field>, MAX)` in sanitizeJob → MAX. */
function sanitizerLen(field: string): number {
  const m = new RegExp(`str\\(r\\.${field},\\s*([A-Z_]+)\\)`).exec(readCode(SANITIZE));
  if (!m) throw new Error(`${SANITIZE}: ${field} is no longer length-capped by str()`);
  return numericConst(SANITIZE, m[1]);
}
function jsxAttr(rel: string, anchor: RegExp, attr: string): number {
  const code = readCode(rel);
  const at = code.search(anchor);
  if (at < 0) throw new Error(`${rel}: anchor ${anchor} not found`);
  // The whole JSX tag the anchor sits in: from its `<` to its `/>`.
  const tagStart = code.lastIndexOf("<", at);
  const tagEnd = code.indexOf("/>", at);
  const m = new RegExp(`\\b${attr}=(?:\\{(\\d+)\\}|"(\\d+)")`).exec(code.slice(tagStart, tagEnd));
  if (!m) throw new Error(`${rel}: no ${attr} on ${anchor}`);
  return Number(m[1] ?? m[2]);
}

type Pair = { field: string; sanitizer: number; form: number; loose: "above" | "below" };

function pairs(): Pair[] {
  const budget = sanitizerClamp("budget_max");
  const budgetMin = sanitizerClamp("budget_min");
  const helpers = sanitizerClamp("helpers_needed");
  const helpersInput = /aria-label="Number of Helprs needed"/;
  return [
    { field: "title max chars", sanitizer: sanitizerLen("title"), form: numericConst(FORM_CONSTS, "TITLE_MAX"), loose: "above" },
    { field: "description max chars", sanitizer: sanitizerLen("description"), form: numericConst(FORM_CONSTS, "DESCRIPTION_MAX"), loose: "above" },
    {
      field: "special_requirements max chars",
      sanitizer: sanitizerLen("special_requirements"),
      form: jsxAttr(LOGISTICS, /<Textarea id="requirements"/, "maxLength"),
      loose: "above",
    },
    { field: "budget_max ceiling", sanitizer: budget[1], form: MAX_JOB_BUDGET_DOLLARS, loose: "above" },
    { field: "budget_min ceiling", sanitizer: budgetMin[1], form: MAX_JOB_BUDGET_DOLLARS, loose: "above" },
    { field: "budget floor", sanitizer: Math.min(budget[0], budgetMin[0]), form: MIN_JOB_BUDGET_DOLLARS, loose: "below" },
    { field: "helpers_needed ceiling", sanitizer: helpers[1], form: jsxAttr(LOGISTICS, helpersInput, "max"), loose: "above" },
    { field: "helpers_needed floor", sanitizer: helpers[0], form: jsxAttr(LOGISTICS, helpersInput, "min"), loose: "below" },
  ];
}

/** field → "sanitizer vs form", exactly as measured 2026-09-26. */
// @two-way src/test/aiJobBuilderBoundsParity.test.ts:stale KNOWN_DRIFT entry
const KNOWN_DRIFT: Record<string, string> = {
  "description max chars": "4000 vs 1000",
  "special_requirements max chars": "1000 vs 500",
  "budget_max ceiling": "100000 vs 1000",
  "budget_min ceiling": "100000 vs 1000",
  "budget floor": "0 vs 10",
  "helpers_needed ceiling": "20 vs 10",
  "helpers_needed floor": "1 vs 2",
};

describe("ai-job-builder output bounds vs the post-job form (Q54)", () => {
  it("inventory floor: every bound resolves on both sides", () => {
    const ps = pairs();
    expect(ps.length).toBeGreaterThan(7);
    for (const p of ps) {
      expect(Number.isFinite(p.sanitizer), p.field).toBe(true);
      expect(Number.isFinite(p.form), p.field).toBe(true);
    }
  });

  it("the set of drifted bounds is exactly KNOWN_DRIFT (a new drift fails; so does a fix left listed)", () => {
    const drift: Record<string, string> = {};
    for (const p of pairs()) {
      const looser = p.loose === "above" ? p.sanitizer > p.form : p.sanitizer < p.form;
      if (looser || (p.field === "title max chars" && p.sanitizer !== p.form)) drift[p.field] = `${p.sanitizer} vs ${p.form}`;
    }
    const stale = Object.keys(KNOWN_DRIFT).filter((f) => drift[f] !== KNOWN_DRIFT[f]);
    expect(stale, "stale KNOWN_DRIFT entry — the bound moved or was fixed; update or remove it").toEqual([]);
    expect(drift).toEqual(KNOWN_DRIFT);
  });

  it("the title cap is the same number on both sides (the one bound that agrees)", () => {
    expect(sanitizerLen("title")).toBe(numericConst(FORM_CONSTS, "TITLE_MAX"));
  });
});
