import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Q343 class guard: the checkout webhook never branches on a metadata key that
 * no checkout creator writes, and a full refund is a compare-and-set.
 *
 * checkoutSessionCompleted had a `metadata.repay === "true"` branch that flipped
 * a job straight to payout_pending and scheduled its payout. No
 * checkout.sessions.create call anywhere wrote `repay`: dead code on the money
 * path, which a future creator could have switched on by accident (or which
 * looked like a supported flow to the next reader). The CLASS is "the webhook
 * reads a key the creators do not write", so the inventory is built from the
 * source on both sides:
 *   - CREATORS: every file under supabase/functions that calls
 *     checkout.sessions.create; the keys of every object literal it passes as
 *     `metadata` (inline, via a named const, or shorthand), payment_intent_data
 *     and subscription_data included.
 *   - READERS: every `session.metadata…?.<key>` in checkoutSessionCompleted.ts.
 * Every read key must be written by at least one creator.
 *
 * Also pinned here (the race-class scanner credits only a `status` predicate):
 * chargeRefunded's payment_status write is a CAS on REFUND_CLOSABLE_PAYMENT_STATES
 * with an observable row count, and that set never holds 'released' or
 * 'chargeback'.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const sessionType = (session.metadata as any)?.type; | const sessionType = (session.metadata as any)?.type ?? (session.metadata as any)?.repay;
 * @mutate supabase/functions/create-payment/index.ts | metadata: { job_id: jobId, tipper_id: user.id, helper_id: helperId, type: "tip" }, | metadata: { job_id: jobId, tipper_id: user.id, helper_id: helperId },
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | .in("payment_status", [...REFUND_CLOSABLE_PAYMENT_STATES]) | .neq("id", "")
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | "escrow", "payout_pending", "cancelling", | "escrow", "payout_pending", "cancelling", "released",
 */

const REPO = resolve(__dirname, "../..");
const FN_DIR = resolve(REPO, "supabase/functions");
const HANDLER = "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts";
const REFUND = "supabase/functions/stripe-webhook/handlers/chargeRefunded.ts";

const read = (rel: string) => blankComments(readFileSync(resolve(REPO, rel), "utf8"));

/** The balanced `{…}` starting at src[open] === "{". */
function block(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced object literal");
}

/** Top-level keys of an object literal. A spread makes the key set unknowable. */
export function objectKeys(obj: string): { keys: string[]; spread: boolean } {
  const inner = obj.slice(1, -1);
  const parts: string[] = [];
  let depth = 0, cur = "", quote: string | null = null;
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
    if ("{[(".includes(ch)) depth++;
    if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const keys: string[] = [];
  let spread = false;
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    if (raw.startsWith("...")) { spread = true; continue; }
    const m = raw.match(/^["'`]?([A-Za-z_$][\w$]*)["'`]?\s*(:|$)/);
    if (m) keys.push(m[1]);
  }
  return { keys, spread };
}

/** Every metadata key one creator file writes. */
export function writtenMetadataKeys(src: string): { keys: Set<string>; spread: boolean } {
  const keys = new Set<string>();
  let spread = false;
  const add = (obj: string) => {
    const r = objectKeys(obj);
    r.keys.forEach((k) => keys.add(k));
    spread ||= r.spread;
  };
  const vars = new Set<string>();
  for (const m of src.matchAll(/\bmetadata\s*:\s*(\{|[A-Za-z_$][\w$]*)/g)) {
    if (m[1] === "{") add(block(src, m.index! + m[0].length - 1));
    else vars.add(m[1]);
  }
  // Shorthand `{ metadata }` / `{ metadata, … }`.
  if (/[{,]\s*metadata\s*[,}]/.test(src)) vars.add("metadata");
  for (const v of vars) {
    const decl = new RegExp(`(?:const|let)\\s+${v}\\b[^=]*=\\s*\\{`).exec(src);
    if (!decl) throw new Error(`metadata variable ${v} has no object-literal declaration`);
    add(block(src, decl.index + decl[0].length - 1));
  }
  return { keys, spread };
}

/** Every `session.metadata…?.<key>` the handler reads. */
export function readMetadataKeys(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/session\.metadata(?:\s+as\s+[^)]*\))?\s*\??\.\s*([A-Za-z_][\w]*)/g)) out.add(m[1]);
  for (const m of src.matchAll(/session\.metadata(?:\s+as\s+[^)]*\))?\s*\??\.?\[\s*["'`]([\w]+)["'`]\s*\]/g)) out.add(m[1]);
  return out;
}

function creatorFiles(): string[] {
  const out: string[] = [];
  for (const d of readdirSync(FN_DIR)) {
    const p = resolve(FN_DIR, d, "index.ts");
    if (existsSync(p) && /checkout\.sessions\.create\(/.test(blankComments(readFileSync(p, "utf8")))) {
      out.push(`supabase/functions/${d}/index.ts`);
    }
  }
  return out.sort();
}

describe("Q343: checkout metadata the webhook reads is metadata a creator writes", () => {
  const creators = creatorFiles();
  const written = new Set<string>();
  let anySpread = false;
  for (const f of creators) {
    const r = writtenMetadataKeys(read(f));
    r.keys.forEach((k) => written.add(k));
    anySpread ||= r.spread;
  }
  const readKeys = readMetadataKeys(read(HANDLER));

  it("inventories every checkout creator and every key read", () => {
    // 6 files / 8 create calls on 2026-09-26. A floor, so a new creator is
    // picked up rather than failing the count.
    expect(creators.length).toBeGreaterThanOrEqual(6);
    expect(creators).toContain("supabase/functions/create-payment/index.ts");
    expect(readKeys.size).toBeGreaterThanOrEqual(15);
    expect(written.size).toBeGreaterThanOrEqual(15);
  });

  it("no creator spreads unknown keys into metadata (the inventory would go blind)", () => {
    expect(anySpread).toBe(false);
  });

  it("every metadata key the handler branches on is written by some creator", () => {
    const unwritten = [...readKeys].filter((k) => !written.has(k)).sort();
    expect(unwritten, `read by ${HANDLER} but written by no checkout creator`).toEqual([]);
  });

  it("the retired repay key is neither read nor written", () => {
    expect(readKeys.has("repay")).toBe(false);
    expect(written.has("repay")).toBe(false);
  });

  it("the parser is not vacuous: an unwritten read and a shorthand/variable write are both seen", () => {
    expect(readMetadataKeys(`const x = (session.metadata as any)?.repay;`).has("repay")).toBe(true);
    const w = writtenMetadataKeys(`const meta = { a: 1, "b": 2, c }; create({ metadata: meta, payment_intent_data: { metadata: { d: 1 } } });`);
    expect([...w.keys].sort()).toEqual(["a", "b", "c", "d"]);
    expect(writtenMetadataKeys(`create({ metadata: { ...x, e: 1 } })`).spread).toBe(true);
  });
});

describe("Q343: a full refund is a compare-and-set on the refundable states", () => {
  const src = read(REFUND);

  it("the payment_status write carries the CAS filter and an observable row count", () => {
    expect(src).toMatch(
      /\.update\(\{ payment_status: "refunded" \}\)\s*\n\s*\.eq\("id", refundedJob\.id\)\s*\n\s*\.in\("payment_status", \[\.\.\.REFUND_CLOSABLE_PAYMENT_STATES\]\)\s*\n\s*\.select\("id"\)/,
    );
    // It is the only payment_status write in the file.
    expect(src.match(/payment_status: "refunded"/g)).toHaveLength(1);
  });

  it("the closable set never holds a state a refund must not overwrite", () => {
    const m = src.match(/REFUND_CLOSABLE_PAYMENT_STATES = \[([\s\S]*?)\] as const/);
    expect(m).not.toBeNull();
    const states = [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(states).toContain("escrow");
    for (const never of ["released", "chargeback", "refunded"]) expect(states).not.toContain(never);
  });
});
