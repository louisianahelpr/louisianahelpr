/**
 * Class guard: EVERY refund keeps the card fee (owner, 2026-10-14: "if admin
 * refunds we keep the fee also. we should never absorb any fee"), EXCEPT a
 * refund caused by our own mistake, which goes back in full.
 *
 * The bug: create-payment admin_refund_general sent Stripe a full refund with
 * no amount (prod job b108a7ae, 2026-10-14: 2606 of a 2606 charge refunded, the
 * $1.06 card fee Stripe kept paid by the platform), while cancel_escrow on the
 * same kind of job kept it (4f9f4431: 2500 of 2606).
 *
 * Inventory from source (comments blanked): every `stripe.refunds.create(` in
 * supabase/functions, plus every caller of a pass-through wrapper. Each must be
 * classified in REFUND_SITES (EXACT both ways: a new site fails until it is
 * classified, a stale entry fails), and then:
 *
 *   keeps-fee    the `amount` sent to Stripe is derived (traced through the
 *                nearest preceding declarations) from the shared definition in
 *                supabase/functions/_shared/refundAmount.ts, AND its definition
 *                (the amount expression, then the right-hand side of the
 *                nearest declaration of each money identifier behind it, up to
 *                five hops) is PINNED exactly in AMOUNT_DEFS: "any identifier
 *                traces to the helper" alone
 *                accepted `capturedCents - generalSplit.setupKeptCents`, the
 *                pre-fix shape (lh-silent-failure review of 79e9a6bb5, #1);
 *   own-mistake  the call carries the comment "own-mistake full refund (owner,
 *                2026-10-14)" just above it, naming why it is our error;
 *   both         a call that sends either (a fee-withheld amount, or nothing
 *                for a full refund of our own error): both checks apply.
 *
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             ...(isPartial ? { amount: requestedCents } : {}),
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             amount: capturedCents - generalSplit.setupKeptCents,
 * @mutate supabase/functions/create-payment/index.ts |           const refundAmount = cancelSplit.refundCents; |           const refundAmount = capturedCents - cancelSplit.setupKeptCents;
 * @mutate supabase/functions/execute-dispute-split/index.ts | refundableCents = posterBase.ceilingCents | refundableCents = capturedCents - posterBase.setupKeptCents
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const owedCents = unfilledCents + feeReturnCents + taxReturnCents; | const owedCents = unfilledCents + feeProRataCents + taxReturnCents;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       const feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: crewStripeFeeCents, proRataCents: feeProRataCents }); |       const feeReturnCents = feeProRataCents;
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |         // own-mistake full refund (owner, 2026-10-14): we charged the one-time |         // we charged the one-time
 * The three charge-recurring-visits own-mistake branches (owner pop-up, 2026-10-14 ~3 PM CT, confirmed each):
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): this run charged | // this run charged
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14), as Q415 (e): the visit | // as Q415 (e): the visit
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): everything goes back. | // everything goes back.
 * @mutate supabase/functions/charge-recurring-visits/index.ts |   const refundCents = Number.isFinite(captured)\n    ? refundToPayerCents({ capturedCents: captured, actualFeeCents: actualOrEstimatedFeeCents(pi, captured) }).refundCents |   const refundCents = Number.isFinite(captured)\n    ? captured
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const FN = join(ROOT, "supabase/functions");
const HELPERS = ["refundToPayerCents(", "crewFeeShareReturnCents(", "refundLessStripeFeeCents("];
const OWN_MISTAKE_MARK = "own-mistake full refund (owner, 2026-10-14)";

type Kind = "keeps-fee" | "own-mistake" | "both" | "pass-through";

/**
 * Every refund site, keyed by file and a substring of its call text. EXACT.
 * own-mistake entries are the owner's exceptions (2026-10-14, asked twice):
 * our own errors are refunded in full, card fee included.
 */
const REFUND_SITES: Array<{ file: string; key: string; kind: Kind; why: string }> = [
  { file: "supabase/functions/create-payment/index.ts", key: "cancel-escrow-", kind: "keeps-fee", why: "poster/admin cancel of a funded job" },
  { file: "supabase/functions/create-payment/index.ts", key: "refund-dispute-", kind: "keeps-fee", why: "Quick Refund of a dispute (card cost only)" },
  { file: "supabase/functions/create-payment/index.ts", key: "refund-general-", kind: "keeps-fee", why: "admin refund, full or partial" },
  { file: "supabase/functions/execute-dispute-split/index.ts", key: "poster_share", kind: "keeps-fee", why: "the poster's leg of a dispute split" },
  { file: "supabase/functions/void-cancelled-payments/index.ts", key: "cancel-refund-", kind: "keeps-fee", why: "cancelled job settlement" },
  { file: "supabase/functions/process-scheduled-payouts/index.ts", key: "crew-dispute-refund-", kind: "keeps-fee", why: "crew unfilled spots / crew dispute" },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "refunds.create(params, opts)", kind: "pass-through", why: "createRefundOnce: callers checked below" },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "visitRefundKey(stripe, intent.id)", kind: "own-mistake", why: "a second charge for one visit (our double charge; owner pop-up 2026-10-14 ~3 PM CT)" },
  { file: "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts", key: "ONBOARDING_FEE_CENTS", kind: "own-mistake", why: "the $2 setup fee charged twice" },
  { file: "supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts", key: "duplicate-funding-refund:", kind: "own-mistake", why: "a second payment for an already-funded job" },
  { file: "supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts", key: "recurring-visit-refund:", kind: "own-mistake", why: "a visit checkout we could not settle" },
];

/** Callers of the pass-through wrapper (charge-recurring-visits createRefundOnce), in source order. EXACT. */
const WRAPPER = { file: "supabase/functions/charge-recurring-visits/index.ts", name: "createRefundOnce" };
const WRAPPER_CALLERS: Array<{ kind: Exclude<Kind, "pass-through">; why: string }> = [
  { kind: "keeps-fee", why: "stale-visit sweep, series ended or date changed hands" },
  // Owner pop-up 2026-10-14 ~3 PM CT confirmed both full-refund branches below as our own mistakes.
  { kind: "own-mistake", why: "stale-visit sweep, paid and never booked for no party reason (Q415 (e))" },
  { kind: "both", why: "mid-run: fee withheld when the series ended / date changed hands, full when the insert simply failed" },
];

/**
 * The pinned definition of each keeps-fee amount, whitespace-collapsed: the
 * `amount:` expression itself when it is not a bare identifier, else the
 * right-hand side of that identifier's nearest preceding declaration or
 * assignment. EXACT: changing how a refund amount is computed fails here until
 * the new expression is reviewed and pinned. Keyed by REFUND_SITES key, or
 * `createRefundOnce#<n>` for the wrapper's callers.
 */
const AMOUNT_DEFS: Record<string, string[]> = {
  "cancel-escrow-": [
    "refundAmount",
    "refundAmount = cancelSplit.refundCents",
    "cancelSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: serviceFeeCents, setupFeeCents, alreadyRefundedCents, })",
  ],
  "refund-dispute-": [
    "refundAmount",
    "refundAmount = disputeSplit.refundCents",
    "disputeSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: disputeOtherRefundedCents, })",
  ],
  "refund-general-": [
    "generalSplit.refundCents",
    "generalSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: generalAlreadyRefundedCents, requestedCents: isPartial ? requestedCents : null, })",
  ],
  "poster_share": [
    "refundCents",
    "refundCents = Math.max(0, Math.round(refundableCents * posterShare))",
    "refundableCents = posterBase.ceilingCents",
    "posterBase = refundToPayerCents({ capturedCents, actualFeeCents: pi ? actualOrEstimatedFeeCents(pi, capturedCents) : 0, customerFeeCents: pi ? cardCostFeeCents(job) : 0, setupFeeCents: pi ? setupFeeKeptCents(job) : 0, })",
  ],
  "crew-dispute-refund-": [
    "refundCents",
    "refundCents = Math.min(cardOwedCents, chargeLeftCents)",
    "cardOwedCents = Math.max(0, owedCents - giftRestoredCents)",
    "chargeLeftCents = a.isPifFunded ? Math.min(capturedCents, Math.max(0, capturedCents + a.giftAppliedCents - a.paidCents - giftRestoredCents - blockFeeCents)) : Math.max(0, a.capturedCents - a.paidCents - blockFeeCents)",
    "owedCents = unfilledCents + feeReturnCents + taxReturnCents",
    "giftRestoredCents = Math.max(0, Math.round(Number(restore?.restore_cents ?? 0)))",
    "capturedCents = a.capturedCents",
    "blockFeeCents = Math.min(a.blockFeeCents, unpaidBudgetCents)",
    "unfilledCents = unpaidBudgetCents - blockFeeCents + Math.max(0, urgentCents - paidUrgent)",
    "feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: crewStripeFeeCents, proRataCents: feeProRataCents })",
    "taxReturnCents = budgetCents > 0 ? Math.floor((taxCents * unpaidBudgetCents) / budgetCents) : 0",
    "unpaidBudgetCents = Math.max(0, budgetCents - paidBudget)",
    "urgentCents = Math.round(Number(job.urgent_fee ?? 0) * 100)",
    "budgetCents = Math.round(Number(job.budget ?? 0) * 100)",
    "taxCents = Math.max(0, Math.round(Number(job.sales_tax_amount ?? 0) * 100))",
  ],
  "cancel-refund-": [
    "refundAmount",
    "refundAmount = voidSplit.refundCents > 0 || refundedAtStripe ? voidSplit.refundCents : capturedCents - Math.round(cancellationFee * 100) - blockFeeCents - nonRefundableCents",
    "voidSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: fullSeriesRefund ? 0 : serviceFeeCents, setupFeeCents: setupFeeKeptCents(job), otherKeptCents: Math.round(cancellationFee * 100) + blockFeeCents, alreadyRefundedCents: chargeRefundedCents, })",
    "capturedCents = pi.amount_received ?? pi.amount",
    "blockFeeCents = crewBlockFeeCents(blockFeeRows)",
    "nonRefundableCents = voidSplit.nonRefundableCents",
  ],
  "createRefundOnce#0": [
    "owedCents",
    "owedCents = withholdFee ? lessFeeCents : amountCents",
    "lessFeeCents = Number.isFinite(amountCents) ? refundToPayerCents({ capturedCents: amountCents, actualFeeCents: actualOrEstimatedFeeCents(piObj, amountCents) }).refundCents : Number.NaN",
    "amountCents = Number(row.amount_cents)",
  ],
  "createRefundOnce#2": [
    "split.refundCents",
    "split = await refundLessStripeFeeCents(stripe, intent, capturedCents)",
  ],
};

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/** The nearest preceding declaration or assignment of `id` before `at`: its right-hand side and position. */
function declOf(code: string, id: string, at: number): { text: string; at: number } | null {
  const decl = new RegExp(`(?:\\b(?:const|let)\\s+${id}\\b[^=]*=|(?<![.\\w$])${id}\\s*=(?!=))`, "g");
  let best = -1;
  for (const d of code.slice(0, at).matchAll(decl)) best = d.index ?? best;
  if (best < 0) return null;
  const start = code.indexOf("=", best) + 1;
  let end = code.indexOf(";", start);
  if (end < 0 || end > at) end = at;
  return { text: code.slice(start, end), at: best };
}

/**
 * The definition AMOUNT_DEFS pins for an amount expression at `at`: the
 * expression, then (breadth first, up to three hops) the right-hand side of
 * the nearest declaration of every money identifier it uses (named *Cents,
 * *Split, *Base or split), up to five hops. A right-hand side
 * that calls a shared refund helper is pinned whole (its arguments included)
 * and not followed further. One hop was not enough: `refundableCents` behind
 * the dispute split's `Math.round(refundableCents * posterShare)` could be
 * re-defined unseen (lh-silent-failure re-review of 9a52981da).
 */
function amountDefinition(code: string, expr: string, at: number): string[] {
  const parts: string[] = [norm(expr)];
  const seen = new Set<string>();
  let frontier: Array<{ text: string; at: number }> = [{ text: expr, at }];
  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const next: Array<{ text: string; at: number }> = [];
    for (const f of frontier) {
      if (depth > 0 && HELPERS.some((h) => f.text.includes(h))) continue;
      for (const m of f.text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
        const id = m[1];
        if (KEYWORDS.has(id) || seen.has(id)) continue;
        // An object key (`{ capturedCents: ...`) is not a use.
        const idx = m.index ?? 0;
        if (/^\s*:(?!:)/.test(f.text.slice(idx + id.length)) && /[{,]\s*$/.test(f.text.slice(0, idx))) continue;
        // Past the amount itself, only money amounts are followed: in these
        // functions every one is named *Cents (or is a refundToPayerCents
        // result, *Split / *Base / split). Flags and Stripe objects are left
        // to the edge tests.
        if (depth > 0 && !/(?:Cents|Split|Base)$|^split$/.test(id)) continue;
        seen.add(id);
        const def = declOf(code, id, f.at);
        if (!def) continue;
        parts.push(`${id} = ${norm(def.text)}`);
        next.push(def);
      }
    }
    frontier = next;
  }
  return parts;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The text of a call from its opening paren to the matching close. */
function callText(code: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") {
      depth--;
      if (depth === 0) return code.slice(openIdx, i + 1);
    }
  }
  return code.slice(openIdx);
}

const KEYWORDS = new Set(["const", "let", "await", "Math", "Number", "String", "true", "false", "null", "undefined", "typeof", "new", "async", "return"]);

/**
 * Does the value of `expr` (an expression at `at`) come from a shared refund
 * helper? Follows each root identifier to its nearest preceding declaration or
 * assignment, breadth first, a few hops deep.
 */
function tracesToHelper(code: string, expr: string, at: number): boolean {
  const seen = new Set<string>();
  let frontier: Array<{ text: string; at: number }> = [{ text: expr, at }];
  for (let depth = 0; depth < 7 && frontier.length > 0; depth++) {
    const next: Array<{ text: string; at: number }> = [];
    for (const f of frontier) {
      if (HELPERS.some((h) => f.text.includes(h))) return true;
      for (const m of f.text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
        const id = m[1];
        if (KEYWORDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        const decl = new RegExp(`(?:\\b(?:const|let)\\s+${id}\\b[^=]*=|(?<![.\\w$])${id}(?:\\.amount)?\\s*=(?!=))`, "g");
        let best = -1;
        for (const d of code.slice(0, f.at).matchAll(decl)) best = d.index ?? best;
        if (best < 0) continue;
        const start = code.indexOf("=", best) + 1;
        let end = code.indexOf(";", start);
        if (end < 0 || end > f.at) end = f.at;
        next.push({ text: code.slice(start, end), at: best });
      }
    }
    frontier = next;
  }
  return false;
}

function amountExpr(call: string): string | null {
  const m = call.match(/\bamount:\s*([^,}\n]+)/);
  return m ? m[1].trim() : null;
}

function hasOwnMistakeComment(raw: string, at: number): boolean {
  const before = raw.slice(0, at).split("\n").slice(-9).join("\n");
  return before.includes(OWN_MISTAKE_MARK);
}

interface Found { file: string; at: number; call: string }

function refundSites(): Found[] {
  const found: Found[] = [];
  for (const abs of walk(FN)) {
    const code = blankComments(readFileSync(abs, "utf8"));
    for (const m of code.matchAll(/\bstripe\.refunds\.create\(/g)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      found.push({ file: relative(ROOT, abs), at: m.index ?? 0, call: "refunds.create" + callText(code, open) });
    }
  }
  return found;
}

function check(file: string, at: number, call: string, kind: Exclude<Kind, "pass-through">, argExpr: string | null, defKey: string): string[] {
  const raw = readFileSync(join(ROOT, file), "utf8");
  const code = blankComments(raw);
  const problems: string[] = [];
  if (kind === "keeps-fee" || kind === "both") {
    if (!argExpr) problems.push(`${file}: ${call.slice(0, 80)} sends no amount (a full refund) but must keep the card fee`);
    else {
      if (!tracesToHelper(code, argExpr, at)) {
        problems.push(`${file}: the amount "${argExpr}" of ${call.slice(0, 60)} does not come from _shared/refundAmount.ts`);
      }
      const def = amountDefinition(code, argExpr, at);
      if (JSON.stringify(AMOUNT_DEFS[defKey]) !== JSON.stringify(def)) {
        problems.push(`${file}: the amount of ${defKey} is defined as ${JSON.stringify(def, null, 2)}, pinned as ${JSON.stringify(AMOUNT_DEFS[defKey], null, 2)}: review that it keeps the card fee, then pin it`);
      }
    }
    if (!/from\s+["'](?:\.\.\/)+_shared\/refundAmount\.ts["']/.test(code)) problems.push(`${file}: does not import _shared/refundAmount.ts`);
  }
  if (kind === "own-mistake" || kind === "both") {
    if (!hasOwnMistakeComment(raw, at)) problems.push(`${file}: ${call.slice(0, 60)} is a full refund without the "${OWN_MISTAKE_MARK}" comment`);
  }
  return problems;
}

describe("every refund keeps the card fee, except our own mistakes (owner, 2026-10-14)", () => {
  const sites = refundSites();

  it("the inventory is read from source and every site is classified, both ways", () => {
    expect(sites.length).toBeGreaterThan(8);
    const unmatched = sites.filter((s) => REFUND_SITES.filter((e) => e.file === s.file && s.call.includes(e.key)).length !== 1);
    expect(unmatched.map((s) => `${s.file}: ${s.call.slice(0, 100)}`), "classify each new refund site in REFUND_SITES").toEqual([]);
    const stale = REFUND_SITES.filter((e) => sites.filter((s) => s.file === e.file && s.call.includes(e.key)).length !== 1);
    expect(stale.map((e) => `${e.file} ${e.key}`), "stale REFUND_SITES entry: remove it").toEqual([]);
    expect(REFUND_SITES.filter((e) => e.kind === "own-mistake").length).toBe(4);
  });

  it("each refund either keeps the card fee through the shared helper or is a named own-mistake full refund", () => {
    const problems: string[] = [];
    for (const s of sites) {
      const entry = REFUND_SITES.find((e) => e.file === s.file && s.call.includes(e.key));
      if (!entry || entry.kind === "pass-through") continue;
      problems.push(...check(s.file, s.at, s.call, entry.kind, amountExpr(s.call), entry.key));
    }
    expect(problems).toEqual([]);
  });

  it("AMOUNT_DEFS pins exactly the keeps-fee sites, no more", () => {
    const keys = [
      ...REFUND_SITES.filter((e) => e.kind === "keeps-fee" || e.kind === "both").map((e) => e.key),
      ...WRAPPER_CALLERS.map((c, i) => (c.kind === "keeps-fee" || c.kind === "both" ? `${WRAPPER.name}#${i}` : null)).filter(Boolean),
    ];
    expect(keys.length).toBeGreaterThan(5);
    expect(Object.keys(AMOUNT_DEFS).sort()).toEqual([...keys].sort());
  });

  it("the pass-through wrapper's callers are each classified and checked", () => {
    const raw = readFileSync(join(ROOT, WRAPPER.file), "utf8");
    const code = blankComments(raw);
    const calls = [...code.matchAll(new RegExp(`(?<!function\\s)\\b${WRAPPER.name}\\(`, "g"))];
    expect(calls.length, "classify each createRefundOnce caller in WRAPPER_CALLERS").toBe(WRAPPER_CALLERS.length);
    const problems: string[] = [];
    calls.forEach((m, i) => {
      const at = m.index ?? 0;
      const call = callText(code, at + m[0].length - 1);
      const params = call.match(/^\(\s*stripe\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null;
      // The amount on the params object: its own nearest `amount:` / `.amount =`.
      const before = code.slice(0, at);
      const objAssign = [...before.matchAll(new RegExp(`\\b${params}\\s*=\\s*\\{[^;]*?\\bamount:\\s*([^,}\\n]+)`, "g"))].pop();
      const propAssign = [...before.matchAll(new RegExp(`\\b${params}\\.amount\\s*=\\s*([^;\\n]+)`, "g"))].pop();
      const pick = [objAssign, propAssign].filter(Boolean).sort((a, b) => (b!.index ?? 0) - (a!.index ?? 0))[0];
      problems.push(...check(WRAPPER.file, at, `${WRAPPER.name}${call}`, WRAPPER_CALLERS[i].kind, pick ? pick[1].trim() : null, `${WRAPPER.name}#${i}`));
    });
    // The wrapper's own fee path: refundLessStripeFeeCents computes through the shared helper.
    const body = code.slice(code.indexOf("async function refundLessStripeFeeCents("));
    expect(body.slice(0, body.indexOf("\n}\n")).includes("refundToPayerCents(")).toBe(true);
    expect(problems).toEqual([]);
  });
});
