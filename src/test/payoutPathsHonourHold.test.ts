/**
 * CLASS CHECK (docs/OPEN.md Q764): every path that moves money to a Helpr
 * checks the server-side payout hold first.
 *
 * The hold used to live in one admin's browser, and release-payout (and every
 * other payout path) read no hold at all. It now lives in public.payout_holds
 * (20261004162921) and is read through supabase/functions/_shared/payoutHold.ts.
 * This file makes "every payout path honours it" a property of the source, not
 * of whoever remembered:
 *
 *   1. INVENTORY, from source, never from a list typed here. Every non-test .ts
 *      under supabase/functions is parsed with the TypeScript parser (comments
 *      are not code). A MONEY SITE is
 *        - a call to `<x>.transfers.create(...)` (platform balance -> a
 *          Connect account) or `<x>.payouts.create(...)` (Connect balance ->
 *          the person's bank);
 *        - a `transfer_data` property (a destination charge: Stripe moves the
 *          money to the Helpr as the card is charged — tips);
 *        - a `fetch(...)` of the release-payout function (auto-release-payment
 *          pays through it).
 *   2. EVERY SITE IS GATED: a call to checkPayoutHold(...) or
 *      loadPayoutHolds(...) appears BEFORE the site, in the site's own function
 *      or one that encloses it (a thin closure such as auto-tip-charge's
 *      `createIntent = () => stripe.paymentIntents.create(...)` inherits its
 *      caller's check). A check in a SIBLING function never counts, so one
 *      helper's check cannot cover another helper's transfer.
 *   3. EXACT AND TWO-WAY: the per-file site counts equal PAYOUT_PATHS below.
 *      A new money site anywhere fails until it is gated AND listed; a listed
 *      file that no longer moves money fails as stale. Outside the list, the
 *      only callers of the hold check are READ_ONLY_HOLD_READERS (monitors that
 *      must not page on a payout a hold keeps back on purpose), also exact.
 *
 * Behaviour (held -> refused, unreadable -> refused, clear -> paid) is pinned
 * per path by src/test/edge/payoutHold.test.ts; the SQL (RLS, admin-only
 * writers, the claim trigger, the export section) by
 * src/test/pglite/payoutHoldServerSide.pglite.mjs.
 *
 * @mutate supabase/functions/release-payout/index.ts | const hold = await checkPayoutHold(supabaseAdmin, job.helper_id); | const hold = { kind: "clear" } as { kind: string; message?: string; reason?: string; denied?: boolean };
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const hold = await checkPayoutHold(supabaseAdmin, helperId); | const hold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/auto-release-payment/index.ts | const holdLookup = await loadPayoutHolds(supabaseAdmin, (dueJobs ?? []).map((j) => j.helper_id)); | const holdLookup = { ok: true, holds: new Map() } as { ok: boolean; holds: Map<string, unknown>; message?: string };
 * @mutate supabase/functions/create-payment/index.ts | const tipHold = await checkPayoutHold(supabaseAdmin, helperId); | const tipHold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/create-payment/index.ts | const hold = await checkPayoutHold(supabaseAdmin, helperId); | const hold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/auto-tip-charge/index.ts | const tipHold = await checkPayoutHold(supabase, c.helper_id as string); | const tipHold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/cash-out-credits/index.ts | const hold = await checkPayoutHold(supabase, userId); | const hold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/instant-payout/index.ts | const hold = await checkPayoutHold(supabaseAdmin, user.id); | const hold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/execute-dispute-split/index.ts | const hold = await checkPayoutHold(supabaseAdmin, job.helper_id); | const hold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const feeHold = await checkPayoutHold(supabaseAdmin, helperId); | const feeHold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const shareHold = await checkPayoutHold(supabaseAdmin, share.helper_id); | const shareHold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/_shared/chargebackClawback.ts | const repayHold = await checkPayoutHold(supabase, row.helper_id); | const repayHold = { kind: "clear" } as { kind: string; message?: string };
 * @mutate supabase/functions/money-reconciliation/index.ts | => loadPayoutHolds(admin, ids); | => ({ ok: true as const, holds: new Map<string, unknown>(), ids });
 * @mutate supabase/functions/auto-resolve-disputes/index.ts |               const holds = await loadPayoutHolds( |               const holds = await loadPayoutHoldz(
 * @mutate supabase/functions/stripe-payouts/index.ts | stripe.balance.retrieve({ stripeAccount: accountId }), | stripe.balance.retrieve({ stripeAccount: accountId }), stripe.transfers.create({ amount: 1, currency: "usd", destination: accountId }),
 * @mutate supabase/functions/cash-out-credits/index.ts | transfer = await stripe.transfers.create( | await stripe.transfers.create({ amount: 1, currency: "usd", destination: "acct_x" });\n      transfer = await stripe.transfers.create(
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { walkSource } from "./helpers/walkSource";

const REPO = join(__dirname, "..", "..");
const FUNCTIONS = join(REPO, "supabase", "functions");
const HOLD_MODULE = "supabase/functions/_shared/payoutHold.ts";
const HOLD_CALLS = new Set(["checkPayoutHold", "loadPayoutHolds"]);

/**
 * Every file that moves money to a Helpr, with its number of money sites.
 * EXACT: derived counts must equal these, in both directions.
 */
const PAYOUT_PATHS: Record<string, number> = {
  "supabase/functions/release-payout/index.ts": 1,
  "supabase/functions/process-scheduled-payouts/index.ts": 1,
  "supabase/functions/auto-release-payment/index.ts": 1,
  // admin dispute Quick Release (transferToHelper) + the tip destination charge
  "supabase/functions/create-payment/index.ts": 2,
  "supabase/functions/auto-tip-charge/index.ts": 1,
  "supabase/functions/cash-out-credits/index.ts": 1,
  // payouts.create to the bank + the fee transfer from the Connect account
  "supabase/functions/instant-payout/index.ts": 2,
  "supabase/functions/execute-dispute-split/index.ts": 1,
  // single-Helpr cancellation fee + per-member crew shares
  "supabase/functions/void-cancelled-payments/index.ts": 2,
  // a won chargeback's re-payment
  "supabase/functions/_shared/chargebackClawback.ts": 1,
};

/**
 * Files that READ the hold and move no money: they must not page on a payout
 * a hold is keeping back on purpose (lh-money-escrow review of Q764). Exact and
 * two-way: a new reader fails until listed here with its reason, and a listed
 * file that stops reading the hold fails as stale. A reader that gains a money
 * site fails the PAYOUT_PATHS check above instead.
 */
const READ_ONLY_HOLD_READERS: Record<string, string> = {
  "supabase/functions/money-reconciliation/index.ts":
    "payout_pending_stranded skips a job a hold keeps in payout_pending (reported in payout_pending_held); an unreadable hold exempts nothing",
  "supabase/functions/auto-resolve-disputes/index.ts":
    "the stuck-split sweep sets aside a split execute-dispute-split refused for a hold (PAYOUT_HOLD_SPLIT_ERROR) while the hold stands",
};

interface Site {
  file: string;
  line: number;
  kind: string;
  gated: boolean;
}

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

function enclosingFunction(n: ts.Node): ts.Node | null {
  for (let p = n.parent; p; p = p.parent) if (isFunctionLike(p)) return p;
  return null;
}

/** The functions enclosing `n`, nearest first (null = module scope, last). */
function enclosingFunctions(n: ts.Node): Array<ts.Node | null> {
  const out: Array<ts.Node | null> = [];
  for (let p = n.parent; p; p = p.parent) if (isFunctionLike(p)) out.push(p);
  out.push(null);
  return out;
}

function calleeName(call: ts.CallExpression): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  return null;
}

/** `<x>.transfers.create` / `<x>.payouts.create` */
function stripeMoneyCall(call: ts.CallExpression): string | null {
  const c = call.expression;
  if (!ts.isPropertyAccessExpression(c) || c.name.text !== "create") return null;
  const inner = c.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  if (inner.name.text === "transfers") return "transfers.create";
  if (inner.name.text === "payouts") return "payouts.create";
  return null;
}

/** `fetch(<anything naming /release-payout>)` */
function payoutFunctionFetch(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  if (calleeName(call) !== "fetch") return false;
  const arg = call.arguments[0];
  return !!arg && /\/release-payout\b/.test(arg.getText(sf));
}

export function scanFile(file: string, text: string): { sites: Site[]; holdCalls: number } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const checks: Array<{ pos: number; fn: ts.Node | null }> = [];
  const raw: Array<{ node: ts.Node; kind: string }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name && HOLD_CALLS.has(name)) checks.push({ pos: n.getStart(sf), fn: enclosingFunction(n) });
      const money = stripeMoneyCall(n);
      if (money) raw.push({ node: n, kind: money });
      else if (payoutFunctionFetch(n, sf)) raw.push({ node: n, kind: "fetch release-payout" });
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "transfer_data") {
      raw.push({ node: n, kind: "transfer_data" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const sites = raw.map(({ node, kind }) => {
    const pos = node.getStart(sf);
    const scope = enclosingFunctions(node);
    return {
      file,
      line: sf.getLineAndCharacterOfPosition(pos).line + 1,
      kind,
      gated: checks.some((c) => scope.includes(c.fn) && c.pos < pos),
    };
  });
  return { sites, holdCalls: checks.length };
}

const files = walkSource([FUNCTIONS])
  .map((f) => relative(REPO, f))
  .filter((f) => !/\.(test|spec)\.ts$/.test(f) && f.endsWith(".ts"));
const scans = files.map((f) => ({ f, ...scanFile(f, readFileSync(join(REPO, f), "utf8")) }));
const allSites = scans.flatMap((s) => s.sites);

describe("every payout path honours the server-side payout hold (Q764)", () => {
  it("the inventory is real (floors)", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(allSites.length).toBeGreaterThan(10);
    expect(Object.keys(PAYOUT_PATHS).length).toBeGreaterThan(8);
  });

  it("every money site has a hold check before it in the same function", () => {
    const ungated = allSites.filter((s) => !s.gated).map((s) => `${s.file}:${s.line} ${s.kind}`);
    expect(ungated, "call checkPayoutHold (supabase/functions/_shared/payoutHold.ts) before moving money").toEqual([]);
  });

  it("PAYOUT_PATHS is exact, both ways", () => {
    const derived: Record<string, number> = {};
    for (const s of allSites) derived[s.file] = (derived[s.file] ?? 0) + 1;
    expect(derived).toEqual(PAYOUT_PATHS);
  });

  it("outside PAYOUT_PATHS, exactly the READ-ONLY hold readers call the hold check (two-way)", () => {
    const readers = scans
      .filter((s) => s.holdCalls > 0 && !(s.f in PAYOUT_PATHS) && s.f !== HOLD_MODULE)
      .map((s) => s.f)
      .sort();
    expect(readers).toEqual(Object.keys(READ_ONLY_HOLD_READERS).sort());
  });

  it("a fixture with an ungated transfer is caught (the scanner can fail)", () => {
    const bad = `async function pay(s, a) { await s.transfers.create({ amount: 1 }); }`;
    const good = `async function pay(s, a, h) { const x = await checkPayoutHold(a, h); await s.transfers.create({ amount: 1 }); }`;
    const other = `async function chk(a, h) { await checkPayoutHold(a, h); }\nasync function pay(s) { await s.transfers.create({ amount: 1 }); }`;
    const after = `async function pay(s, a, h) { await s.transfers.create({ amount: 1 }); await checkPayoutHold(a, h); }`;
    expect(scanFile("bad.ts", bad).sites.map((s) => s.gated)).toEqual([false]);
    expect(scanFile("good.ts", good).sites.map((s) => s.gated)).toEqual([true]);
    expect(scanFile("other.ts", other).sites.map((s) => s.gated)).toEqual([false]);
    expect(scanFile("after.ts", after).sites.map((s) => s.gated)).toEqual([false]);
    const closure = `async function run(s, a, h) { await checkPayoutHold(a, h); const go = () => s.paymentIntents.create({ transfer_data: { destination: "x" } }); await go(); }`;
    const closureFirst = `async function run(s, a, h) { const go = () => s.paymentIntents.create({ transfer_data: { destination: "x" } }); await checkPayoutHold(a, h); await go(); }`;
    expect(scanFile("closure.ts", closure).sites.map((s) => s.gated)).toEqual([true]);
    expect(scanFile("closureFirst.ts", closureFirst).sites.map((s) => s.gated)).toEqual([false]);
  });
});
