/**
 * Q231 — while a dispute is decided but its split is unexecuted, no platform
 * code path other than execute-dispute-split moves that job's escrow.
 *
 * `rpc_decide_dispute` records the decision and, in the same transaction, sets
 * jobs.status to 'completed' (or 'cancelled' for a poster-100% ruling) and
 * jobs.dispute_status to 'resolved' while payment_status stays 'escrow' and
 * disputes.execution_status is 'pending'. Those two job markers are exactly
 * what the ordinary settle paths look for (completed + escrow, cancelled +
 * escrow), so every path that can move a job's escrow must prove it leaves
 * that shape alone. Measured on prod 2026-09-23 (pg_get_functiondef + the edge
 * source): every path below was excluded. This test keeps it that way. (A
 * Stripe-side chargeback can still pull the charge; that is not platform code
 * and is tracked separately in docs/OPEN.md.)
 *
 * INVENTORY, derived from source: every edge-function file (tests excluded)
 * whose CODE (comments blanked) makes a Stripe call that moves money —
 * `.transfers.create / .transfers.createReversal / .refunds.create /
 * .paymentIntents.cancel / .paymentIntents.capture / .payouts.create /
 * .disputes.close` on ANY receiver, or a raw api.stripe.com money URL. The SQL
 * layer cannot reach Stripe (no FDW, no Stripe URL in any function; money
 * crons only net.http_post to the edge functions listed here), so it has no
 * entry; its only jobs.payment_status writers were measured live:
 * redeem_gift_card (funds TO escrow) and rpc_settle_dispute_without_payment
 * (only from unpaid/abandoned/failed).
 *
 * The map must name EXACTLY that set (both directions). Then per kind:
 *   unsettled-check  `const v = await checkUnsettledDispute(...)`, then an
 *                    `if (...v.blocked...) {` whose body returns/continues/
 *                    throws, and EVERY money call is inside the guard's own
 *                    region (innermost enclosing loop or function) after the
 *                    guard — or inside a helper (traced transitively) that is
 *                    only ever called there.
 *   split-owner      execute-dispute-split: takes claim_dispute_settlement
 *                    ('split') before its first money call.
 *   not-job-escrow   moves money that is not a job's held escrow (reason given).
 *   per-action       create-payment: no money in the shared preamble; every
 *                    `if (action === "x")` block that moves money (directly or
 *                    via a helper) is named with its own gate, checked the same
 *                    way before that block's first money call.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { blankComments, blankNonCode } from "./helpers/blankNonCode";

// Shown able to fail — each line alone reds this test:
// @mutate supabase/functions/void-cancelled-payments/index.ts | const settlement = await checkUnsettledDispute(supabaseAdmin, job.id); | const settlement = { blocked: false } as { blocked: boolean; readError?: string; dispute?: { id: string } };
// @mutate supabase/functions/void-cancelled-payments/index.ts | if (settlement.blocked) { | if (false) {
// @mutate supabase/functions/release-payout/index.ts | const settlement = await checkUnsettledDispute(supabaseAdmin, job.id); | const settlement = { blocked: false } as never;
// @mutate supabase/functions/process-scheduled-payouts/index.ts | if (settlement.blocked) { | if (settlement.readError) {
// @mutate supabase/functions/create-payment/index.ts | const generalSettlement = await checkUnsettledDispute(supabaseAdmin, jobId); | const generalSettlement = { blocked: false } as never;
// @mutate supabase/functions/create-payment/index.ts | if ("refusal" in refundClaim) return refundClaim.refusal; | void refundClaim;
// @mutate supabase/functions/money-reconciliation/index.ts | pi = await stripe.paymentIntents.retrieve( | pi = await stripe.paymentIntents.cancel(
// @mutate supabase/functions/void-cancelled-payments/index.ts | const jobs = cancelledJobs; | const jobs = cancelledJobs;\n    for (const j of jobs \|\| []) await stripe.refunds.create({ payment_intent: String(j.id) });
// @mutate supabase/functions/execute-dispute-split/index.ts | "claim_dispute_settlement", | "claim_dispute_settlement_x",
// Transitive (Q409): a money helper reached through another helper, called once outside the guarded loop.
// @mutate supabase/functions/process-scheduled-payouts/index.ts |     const crewSettled = new Set<string>(); |     const crewSettled = new Set<string>();\n    const early = () => crewReadyToRelease(null as never);

const MONEY_SRC =
  String.raw`\.\s*(?:transfers\s*\.\s*(?:create|createReversal)|refunds\s*\.\s*create|paymentIntents\s*\.\s*(?:cancel|capture)|payouts\s*\.\s*create|disputes\s*\.\s*close)\s*\(` +
  String.raw`|api\.stripe\.com\/v1\/(?:transfers|refunds|payouts|payment_intents\/[^"'\x60]*\/(?:cancel|capture))`;
const MONEY = new RegExp(MONEY_SRC);
const MONEY_G = new RegExp(MONEY_SRC, "g");

type Protection =
  | { kind: "unsettled-check" }
  | { kind: "split-owner" }
  | { kind: "not-job-escrow"; why: string }
  | { kind: "per-action" };

const PATHS: Record<string, Protection> = {
  "supabase/functions/release-payout/index.ts": { kind: "unsettled-check" },
  "supabase/functions/process-scheduled-payouts/index.ts": { kind: "unsettled-check" },
  "supabase/functions/void-cancelled-payments/index.ts": { kind: "unsettled-check" },
  "supabase/functions/execute-dispute-split/index.ts": { kind: "split-owner" },
  "supabase/functions/create-payment/index.ts": { kind: "per-action" },
  "supabase/functions/instant-payout/index.ts": {
    kind: "not-job-escrow",
    why: "pays out the Helpr's connected-account balance (money already transferred) and its fee",
  },
  "supabase/functions/cash-out-credits/index.ts": {
    kind: "not-job-escrow",
    why: "transfers from the credits ledger, not from a job's charge",
  },
  "supabase/functions/charge-recurring-visits/index.ts": {
    kind: "not-job-escrow",
    why: "refunds only the PaymentIntent it just created when the visit row did not land",
  },
  "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts": {
    kind: "not-job-escrow",
    why: "refunds the onboarding-fee charge, which is not a job escrow",
  },
  "supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts": {
    kind: "not-job-escrow",
    why: "reverses/repays only transfers found in Stripe's job_<id> transfer group, i.e. money that already left escrow; an unexecuted split has none",
  },
};

type Gate = "unsettled-check" | "claim-refusal" | { custom: RegExp };

/** create-payment actions that move money, and what keeps each one off a decided split. */
const CREATE_PAYMENT_ACTIONS: Record<string, { gate: Gate; why: string }> = {
  escrow: {
    gate: { custom: /if \(abandonedChallenge\s*&&\s*priorPi\)/ },
    why: "cancels only an abandoned 3DS PaymentIntent of a checkout that never funded",
  },
  cancel_escrow: { gate: "unsettled-check", why: "unsettled check" },
  admin_release_dispute: {
    gate: "claim-refusal",
    why: "decided job is not 'disputed'; claim_dispute_settlement refuses split_pending",
  },
  admin_refund_dispute: {
    gate: "claim-refusal",
    why: "decided job is not 'disputed'; claim_dispute_settlement refuses split_pending",
  },
  admin_refund_general: { gate: "unsettled-check", why: "unsettled check" },
};

// ── source helpers ───────────────────────────────────────────────────────────

/** End offset of the `{ ... }` block whose `{` is the first at/after `from` (on blanked code). */
function blockEnd(bare: string, from: number): number {
  const open = bare.indexOf("{", from);
  if (open < 0) return bare.length;
  let depth = 0;
  for (let i = open; i < bare.length; i++) {
    if (bare[i] === "{") depth++;
    else if (bare[i] === "}" && --depth === 0) return i;
  }
  return bare.length;
}

type Fn = { name: string; at: number; end: number };

/** Every named function in the file: `const f = async (`, `[export] [async] function f(`. */
function functions(code: string, bare: string): Fn[] {
  const re = /(?:const (\w+) = async\s*\(|(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\()/g;
  return [...bare.matchAll(re)].map((m) => {
    const at = m.index ?? 0;
    const bodyFrom = m[1] ? bare.indexOf("=>", at) : bare.indexOf(")", at);
    return { name: code.slice(at, at + m[0].length).match(/(\w+)\s*(?:=|\()/)![1], at, end: blockEnd(bare, bodyFrom) };
  });
}

/** Names of functions that move money, directly or through another such function (fixpoint). */
function moneyFunctions(code: string, fns: Fn[]): Set<string> {
  const money = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of fns) {
      if (money.has(f.name)) continue;
      const body = code.slice(f.at, f.end);
      if (MONEY.test(body) || [...money].some((n) => new RegExp(String.raw`\b${n}\s*\(`).test(body.slice(1)))) {
        money.add(f.name);
        grew = true;
      }
    }
  }
  return money;
}

/** Offsets of every money call and every call to a money function, excluding definitions. */
function moneySites(code: string, fns: Fn[], money: Set<string>): Array<{ at: number; via?: string }> {
  const sites: Array<{ at: number; via?: string }> = [...code.matchAll(MONEY_G)].map((m) => ({ at: m.index ?? 0 }));
  const defs = new Set(fns.map((f) => f.at));
  for (const n of money) {
    for (const m of code.matchAll(new RegExp(String.raw`\b${n}\s*\(`, "g"))) {
      const at = m.index ?? 0;
      const def = fns.find((f) => f.name === n);
      if (def && at >= def.at && at < def.at + 60 + n.length && defs.has(def.at)) continue; // the definition itself
      sites.push({ at, via: n });
    }
  }
  return sites;
}

/** The innermost `for (...) {` loop or function body enclosing `at`. */
function region(bare: string, at: number): [number, number] {
  const stack: number[] = [];
  for (let i = 0; i < at; i++) {
    if (bare[i] === "{") stack.push(i);
    else if (bare[i] === "}") stack.pop();
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const open = stack[k];
    const before = bare.slice(Math.max(0, open - 300), open);
    if (/(?:\bfor\s*\((?:[^;{}]|\{[^{}]*\})*(?:;[^;{}]*;[^{}]*)?\)|=>|\bfunction\b[^{}]*\))\s*$/.test(before)) {
      return [open, blockEnd(bare, open)];
    }
  }
  return [0, bare.length];
}

/**
 * Where a gate starts and whether it acts. Returns the offset from which money
 * is allowed (end of the gate's `if` head), or an error string.
 */
function gateEnd(code: string, bare: string, from: number, gate: Gate): number | string {
  if (typeof gate === "object") {
    const m = gate.custom.exec(code.slice(from));
    return m ? from + (m.index ?? 0) + m[0].length : "custom gate missing";
  }
  if (gate === "unsettled-check") {
    const call = /const (\w+) = await checkUnsettledDispute\s*\(/.exec(code.slice(from));
    if (!call) return "no checkUnsettledDispute call";
    const v = call[1];
    const callAt = from + (call.index ?? 0);
    const cond = new RegExp(String.raw`if \(([^{]*\b${v}\.blocked\b[^{]*)\) \{`).exec(code.slice(callAt));
    if (!cond || (cond.index ?? 0) > 800) return `${v}.blocked is never acted on`;
    const open = callAt + (cond.index ?? 0) + cond[0].length - 1;
    const body = bare.slice(open, blockEnd(bare, open));
    if (!/\b(?:return|continue|throw)\b/.test(body)) return `if (${v}.blocked) does not return/continue/throw`;
    return callAt;
  }
  const claim = /const (\w+) = await claimDisputeSettlement\s*\(/.exec(code.slice(from));
  if (!claim) return "no claimDisputeSettlement call";
  const v = claim[1];
  const claimAt = from + (claim.index ?? 0);
  const refused = new RegExp(String.raw`if \("refusal" in ${v}\) return ${v}\.refusal;`).exec(code.slice(claimAt));
  if (!refused || (refused.index ?? 0) > 400) return `${v}'s refusal is never returned`;
  const status = /job\.status !== "disputed"/.exec(code.slice(from, claimAt));
  if (!status) return "no 'disputed' status gate before the claim";
  return claimAt;
}

/**
 * The collect-then-pay shape (process-scheduled-payouts): the guarded loop
 * `continue`s past a blocked job and `.push`es the rest onto an array; a later
 * `for (const ... of ARRAY)` loop pays. A site is covered when its enclosing
 * for-of iterates an array whose EVERY `.push(` is inside the guarded region,
 * after the guard, and which is never reassigned or spread from elsewhere.
 */
function fedOnlyAfterGuard(code: string, bare: string, at: number, allowFrom: number, reg: [number, number]): boolean {
  const [open] = region(bare, at);
  const head = /for \(const [^;]*? of \(?(\w+)(?: \|\| \[\])?\)?\) \{$/.exec(code.slice(Math.max(0, open - 200), open + 1));
  if (!head) return false;
  const arr = head[1];
  const pushes = [...code.matchAll(new RegExp(String.raw`\b${arr}\.(?:push|unshift|splice)\(`, "g"))].map((m) => m.index ?? 0);
  const writes = [...code.matchAll(new RegExp(String.raw`\b${arr}\s*=[^=]`, "g"))].length;
  return pushes.length > 0 && writes <= 1 && pushes.every((i) => i >= allowFrom && i >= reg[0] && i < reg[1]);
}

/** Money sites in [lo, hi) that the gate (which allows money from `allowFrom` within `reg`) does not cover. */
function unguardedSites(
  code: string,
  bare: string,
  sites: Array<{ at: number; via?: string }>,
  fns: Fn[],
  allowFrom: number,
  reg: [number, number],
  lo = 0,
  hi = code.length,
): string[] {
  const inReg = (i: number) => (i >= allowFrom && i >= reg[0] && i < reg[1]) || fedOnlyAfterGuard(code, bare, i, allowFrom, reg);
  const callsOf = (owner: Fn) =>
    [...code.matchAll(new RegExp(String.raw`\b${owner.name}\s*\(`, "g"))]
      .map((c) => c.index ?? 0)
      .filter((i) => i < owner.at || i > owner.at + 60 + owner.name.length);
  /**
   * A site is covered when it is in the guarded region, or it sits inside a
   * function every one of whose call sites is covered, TRANSITIVELY (a money
   * helper called only from another helper that is itself called only where
   * money is allowed: process-scheduled-payouts' refundUnfilledCrewShares,
   * called from crewReadyToRelease, Q409). Same bar at every level: one
   * uncovered call anywhere up the chain is a miss. Depth-capped against
   * recursion.
   */
  const covered = (at: number, depth = 0): boolean => {
    if (inReg(at)) return true;
    if (depth > 4) return false;
    const owner = fns.filter((f) => f.at < at && at < f.end).pop();
    if (!owner) return false;
    const calls = callsOf(owner);
    return calls.length > 0 && calls.every((i) => covered(i, depth + 1));
  };
  const out: string[] = [];
  for (const s of sites) {
    if (s.at < lo || s.at >= hi || covered(s.at)) continue;
    // Inside a function body called only from outside [lo, hi): judged there.
    const owner = fns.filter((f) => f.at < s.at && s.at < f.end).pop();
    if (owner) {
      const calls = callsOf(owner);
      if (calls.length > 0 && calls.every((i) => i < lo || i >= hi)) continue; // called only from elsewhere; judged there
    }
    out.push(`${s.via ?? "stripe"}@${code.slice(0, s.at).split("\n").length}`);
  }
  return out;
}

/** `if (action === "x") {` blocks of create-payment, up to the next marker / first module function. */
export function actionBlocks(code: string): { preambleEnd: number; blocks: Record<string, [number, number]> } {
  const marks = [...code.matchAll(/if \(action === "(\w+)"\) \{/g)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  const moduleFnAt = code.search(/^(?:export\s+)?async function \w+/m);
  const blocks: Record<string, [number, number]> = {};
  marks.forEach((m, i) => {
    blocks[m.name] = [m.at, marks[i + 1]?.at ?? (moduleFnAt > m.at ? moduleFnAt : code.length)];
  });
  return { preambleEnd: marks[0]?.at ?? code.length, blocks };
}

function moneyFiles(): Record<string, string> {
  const files = execFileSync("git", ["ls-files", "supabase/functions"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$|\/tests?\/|__tests__/.test(f));
  const out: Record<string, string> = {};
  for (const f of files) {
    const code = blankComments(readFileSync(f, "utf8"));
    if (MONEY.test(code)) out[f] = code;
  }
  return out;
}

describe("Q231: only execute-dispute-split moves a decided dispute's escrow", () => {
  const files = moneyFiles();

  it("the money-path inventory is exactly the classified set", () => {
    const found = Object.keys(files).sort();
    expect(found.length).toBeGreaterThan(8);
    expect(found).toEqual(Object.keys(PATHS).sort());
  });

  it("every unsettled-check path acts on .blocked and moves money only after it, in its region", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const [f, p] of Object.entries(PATHS)) {
      if (p.kind !== "unsettled-check") continue;
      const code = files[f] ?? "";
      const bare = blankNonCode(code);
      const g = gateEnd(code, bare, 0, "unsettled-check");
      if (typeof g === "string") {
        bad.push(`${f}: ${g}`);
        continue;
      }
      const fns = functions(code, bare);
      const sites = moneySites(code, fns, moneyFunctions(code, fns));
      checked += sites.length;
      const miss = unguardedSites(code, bare, sites, fns, g, region(bare, g));
      if (miss.length) bad.push(`${f}: money outside the guarded region: ${miss.join(", ")}`);
    }
    expect(checked).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });

  it("execute-dispute-split takes claim_dispute_settlement('split') before its first money call", () => {
    const f = Object.entries(PATHS).filter(([, p]) => p.kind === "split-owner").map(([k]) => k);
    expect(f).toEqual(["supabase/functions/execute-dispute-split/index.ts"]);
    const code = files[f[0]] ?? "";
    const claim = code.search(/\.rpc\(\s*"claim_dispute_settlement",[\s\S]{0,200}?_action:\s*"split"/);
    const money = code.search(MONEY);
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(money);
  });

  it("create-payment: no money in the preamble; every money-moving action is named and gated", () => {
    const code = files["supabase/functions/create-payment/index.ts"] ?? "";
    const bare = blankNonCode(code);
    const fns = functions(code, bare);
    const money = moneyFunctions(code, fns);
    expect(money.size).toBeGreaterThan(0);
    const sites = moneySites(code, fns, money);
    // Every `action ===` dispatch is a recognised block marker (no ||, switch, or quotes drift).
    const dispatches = [...bare.matchAll(/if \(action ===/g)].length;
    const { preambleEnd, blocks } = actionBlocks(code);
    expect(Object.keys(blocks).length).toBe(dispatches);
    expect(/switch\s*\(\s*action\s*\)/.test(bare)).toBe(false);
    expect(Object.keys(blocks).length).toBeGreaterThan(5);

    const preamble = sites.filter((s) => s.at < preambleEnd);
    expect(preamble).toEqual([]);

    const moving = Object.entries(blocks)
      .filter(([, [lo, hi]]) => sites.some((s) => s.at >= lo && s.at < hi))
      .map(([n]) => n)
      .sort();
    expect(moving).toEqual(Object.keys(CREATE_PAYMENT_ACTIONS).sort());

    const bad: string[] = [];
    for (const [name, { gate }] of Object.entries(CREATE_PAYMENT_ACTIONS)) {
      const [lo, hi] = blocks[name];
      const g = gateEnd(code, bare, lo, gate);
      if (typeof g === "string" || g >= hi) {
        bad.push(`${name}: ${typeof g === "string" ? g : "gate outside the block"}`);
        continue;
      }
      const miss = unguardedSites(code, bare, sites, fns, g, [lo, hi], lo, hi);
      if (miss.length) bad.push(`${name}: money before its gate: ${miss.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("the shared check reads decided + not executed, and refuses on a read error", () => {
    const code = blankComments(readFileSync("supabase/functions/_shared/unsettledDispute.ts", "utf8"));
    expect(code).toMatch(/\.eq\("status", "decided"\)/);
    // The default read; `crewFanout` (process-scheduled-payouts, group jobs
    // only, Q409) additionally leaves out a crew decision that cron executes.
    expect(code).toMatch(/:\s*"execution_status\.is\.null,execution_status\.neq\.executed";/);
    expect(code).toMatch(/opts\.crewFanout\s*\?\s*"execution_status\.is\.null,and\(execution_status\.neq\.executed,execution_status\.neq\.crew_fanout\)"/);
    expect(code).toMatch(/\.or\(unsettled\)/);
    expect(code).toMatch(/blocked: true,\s*readError/);
    // Its one fail-open branch is a missing TABLE (nothing to block); it must stay that narrow.
    expect(code.match(/return \{ blocked: false \}/g)?.length).toBe(3);
  });

  it("the checker catches the shapes the review named", () => {
    const loop = (inner: string) =>
      `for (const job of jobs) {\n const settlement = await checkUnsettledDispute(a, job.id);\n if (settlement.blocked) { continue; }\n await stripe.refunds.create({});\n}\n${inner}`;
    const run = (code: string) => {
      const bare = blankNonCode(code);
      const g = gateEnd(code, bare, 0, "unsettled-check");
      if (typeof g === "string") return [g];
      const fns = functions(code, bare);
      return unguardedSites(code, bare, moneySites(code, fns, moneyFunctions(code, fns)), fns, g, region(bare, g));
    };
    expect(run(loop(""))).toEqual([]);
    // A second loop after the guarded one moves money unguarded.
    expect(run(loop("for (const j of other) { await stripe.refunds.create({}); }"))).toHaveLength(1);
    // A module function defined after the guard but called before it.
    expect(run(`await payIt();\n${loop("async function payIt() { await s.transfers.create({}); }")}`).length).toBeGreaterThan(0);
    // .blocked computed but ignored.
    expect(run(loop("").replace("if (settlement.blocked) { continue; }", ""))).toEqual(["settlement.blocked is never acted on"]);
    expect(MONEY.test(blankComments("// await stripe.refunds.create({})"))).toBe(false);
    expect(MONEY.test('fetch("https://api.stripe.com/v1/refunds")')).toBe(true);
  });
});
