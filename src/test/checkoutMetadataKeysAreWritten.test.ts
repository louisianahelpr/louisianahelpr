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
 * Every read key must be written by at least one creator, in the SESSION's own
 * metadata: the handler reads `session.metadata`, so a key written only into
 * payment_intent_data/subscription_data metadata lands on a different Stripe
 * object and is invisible to it.
 *
 * Every string literal the handler compares a metadata value against
 * (`sessionType === "tip"`, `kind === "job_boost"`, ...) must likewise be
 * written as that value into some creator's session metadata (or as a
 * non-literal value the creator computes). Key names alone could not see a
 * creator dropping `type: "tip"` from its session metadata: other creators
 * still write `type`, and the tip's own payment_intent_data still writes
 * `type: "tip"`, yet the webhook would then settle the tip as a JOB payment.
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
    // A conditional spread of an object LITERAL, `...(cond ? { k: v } : {})`, adds only the keys it spells out, so the
    // key set stays known (train 1, 11-02: declutter-checkout's ship flag, the gift checkout's test-mode recipient_id).
    // Anything else spread (a variable, a call, a nested spread) still makes the set unknowable.
    const cond = /^\.\.\.\(([\s\S]*?)\?\s*(\{[\s\S]*\})\s*:\s*\{\s*\}\s*\)$/.exec(raw);
    if (cond && !cond[1].includes("{")) {
      const inner = objectKeys(cond[2]);
      inner.keys.forEach((k) => keys.push(k));
      spread ||= inner.spread;
      continue;
    }
    if (raw.startsWith("...")) { spread = true; continue; }
    const m = raw.match(/^["'`]?([A-Za-z_$][\w$]*)["'`]?\s*(:|$)/);
    if (m) keys.push(m[1]);
  }
  return { keys, spread };
}

/** Every metadata key one creator file writes. */
/**
 * `...name` where the same file declares `const name … = cond ? { … } : {}` is the conditional spread of a literal
 * written in two steps (11-04: create-payment's giftTaxMetadata), so it is expanded in place; its computed keys
 * `[NAME]` resolve through a `const NAME = "…"` in the file or in supabase/functions/_shared. Any other spread is
 * left as is and still blinds the inventory.
 */
export function expandLocalSpreads(src: string, obj: string, shared: string = sharedConsts()): string {
  return obj.replace(/\.\.\.([A-Za-z_$][\w$]*)(?=\s*[,}])/g, (whole, name: string) => {
    const decl = new RegExp(`(?:const|let)\\s+${name}\\b[^=]*=\\s*([^?;{}]+?)\\?\\s*\\{`).exec(src);
    if (!decl || decl[1].includes("(")) return whole;
    const lit = block(src, decl.index + decl[0].length - 1);
    const rest = src.slice(decl.index + decl[0].length - 1 + lit.length);
    if (!/^\s*:\s*\{\s*\}\s*;/.test(rest)) return whole;
    const resolved = lit.replace(/\[\s*([A-Z_][A-Z0-9_]*)\s*\]\s*:/g, (k, c: string) => {
      const v = new RegExp(`const\\s+${c}\\s*=\\s*"([\\w]+)"`).exec(src + "\n" + shared);
      return v ? `${v[1]}:` : k;
    });
    return `...(x ? ${resolved} : {})`;
  });
}

let sharedCache: string | null = null;
function sharedConsts(): string {
  if (sharedCache === null) {
    const dir = resolve(FN_DIR, "_shared");
    sharedCache = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => blankComments(readFileSync(resolve(dir, f), "utf8"))).join("\n");
  }
  return sharedCache;
}

export function writtenMetadataKeys(src: string): { keys: Set<string>; spread: boolean } {
  const keys = new Set<string>();
  let spread = false;
  const add = (obj: string) => {
    const r = objectKeys(expandLocalSpreads(src, obj));
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
    // `= cond ? { … } : undefined` (create-payment escrowTaxBackMetadata) counts: the object is what is written.
    const decl = new RegExp(`(?:const|let)\\s+${v}\\b[^=]*=\\s*(?:[^;{}]*\\?\\s*)?\\{`).exec(src);
    if (!decl) throw new Error(`metadata variable ${v} has no object-literal declaration`);
    add(block(src, decl.index + decl[0].length - 1));
  }
  return { keys, spread };
}

/** True when the `{…}` enclosing src[at] is the value of payment_intent_data / subscription_data. */
function nestedInSubObject(src: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") {
      if (depth === 0) return /(?:payment_intent_data|subscription_data)\s*[:=]\s*$/.test(src.slice(Math.max(0, i - 60), i));
      depth--;
    }
  }
  return false;
}

/** key -> literal value, or "*" when the value is computed (shorthand, variable, call). */
export function objectEntries(obj: string): Map<string, string> {
  const out = new Map<string, string>();
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
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    if (raw.startsWith("...")) continue;
    const m = raw.match(/^["'`]?([A-Za-z_$][\w$]*)["'`]?\s*(?::\s*([\s\S]*))?$/);
    if (!m) continue;
    const lit = m[2]?.trim().match(/^"([^"]*)"$|^'([^']*)'$/);
    out.set(m[1], lit ? (lit[1] ?? lit[2]) : "*");
  }
  return out;
}

/** key -> values written into a checkout SESSION's own metadata (not payment_intent_data / subscription_data). */
export function sessionMetadataValues(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (obj: string) => {
    for (const [k, v] of objectEntries(obj)) {
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(v);
    }
  };
  const varAt = (v: string) => {
    // `= cond ? { … } : undefined` (create-payment escrowTaxBackMetadata) counts: the object is what is written.
    const decl = new RegExp(`(?:const|let)\\s+${v}\\b[^=]*=\\s*(?:[^;{}]*\\?\\s*)?\\{`).exec(src);
    if (!decl) throw new Error(`metadata variable ${v} has no object-literal declaration`);
    add(block(src, decl.index + decl[0].length - 1));
  };
  for (const m of src.matchAll(/\bmetadata\s*:\s*(\{|[A-Za-z_$][\w$]*)/g)) {
    if (nestedInSubObject(src, m.index!)) continue;
    if (m[1] === "{") add(block(src, m.index! + m[0].length - 1));
    else varAt(m[1]);
  }
  for (const m of src.matchAll(/[{,]\s*metadata\s*[,}]/g)) {
    if (!nestedInSubObject(src, m.index! + 1)) varAt("metadata");
  }
  return out;
}

/** Every string literal the handler compares a `session.metadata` value against. */
export function comparedMetadataValues(src: string): Array<{ key: string; value: string }> {
  const READ = String.raw`\(?\s*session\.metadata(?:\s+as\s+[^)]*\))?\s*\??\.\s*([A-Za-z_]\w*)`;
  const out: Array<{ key: string; value: string }> = [];
  for (const m of src.matchAll(new RegExp(READ + String.raw`\s*[!=]==?\s*["'](\w+)["']`, "g"))) out.push({ key: m[1], value: m[2] });
  for (const a of src.matchAll(new RegExp(String.raw`(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*` + READ + String.raw`\s*;`, "g"))) {
    for (const c of src.matchAll(new RegExp(String.raw`(?<!typeof\s+)\b${a[1]}\s*[!=]==?\s*["'](\w+)["']`, "g"))) out.push({ key: a[2], value: c[1] });
  }
  return out;
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
  const sessionWritten = new Map<string, Set<string>>();
  for (const f of creators) {
    for (const [k, vs] of sessionMetadataValues(read(f))) {
      if (!sessionWritten.has(k)) sessionWritten.set(k, new Set());
      vs.forEach((v) => sessionWritten.get(k)!.add(v));
    }
  }
  const compared = comparedMetadataValues(read(HANDLER));

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

  // @mutate src/test/checkoutMetadataKeysAreWritten.test.ts |     if (cond && !cond[1].includes("{")) {\n      const inner | if (cond) {\n      const inner
  it("a conditional spread of a literal adds its keys; any other spread still blinds the inventory", () => {
    expect(objectKeys(`{ kind: "x", ...(mode === "test" && id ? { recipient_id: id } : {}) }`)).toEqual({ keys: ["kind", "recipient_id"], spread: false });
    expect(objectKeys(`{ kind: "x", ...extra }`).spread).toBe(true);
    expect(objectKeys(`{ kind: "x", ...(a ? b : {}) }`).spread).toBe(true);
    expect(objectKeys(`{ kind: "x", ...(a ? { ...b } : {}) }`).spread).toBe(true);
    expect(objectKeys(`{ ...(f({ a: 1 }) ? { k: 1 } : {}) }`).spread).toBe(true);
  });

  // @mutate src/test/checkoutMetadataKeysAreWritten.test.ts | .test(rest)) return whole;\n    const resolved | .test(rest) && false) return whole;\n    const resolved
  it("a spread of a local const that is a conditional literal adds its keys; any other local spread still blinds", () => {
    const shared = `export const TAX_KEY = "tax_calculation_id";`;
    const ok = `const extra: Record<string, string> = tax ? { [TAX_KEY]: id, job_tax_cents: c } : {};\nmetadata: { job_id: j, ...extra }`;
    expect(objectKeys(expandLocalSpreads(ok, `{ job_id: j, ...extra }`, shared))).toEqual({ keys: ["job_id", "tax_calculation_id", "job_tax_cents"], spread: false });
    const notEmpty = `const extra = tax ? { a: 1 } : { b: 2 };`;
    expect(objectKeys(expandLocalSpreads(notEmpty, `{ ...extra }`, shared)).spread).toBe(true);
    const call = `const extra = f(x) ? { a: 1 } : {};`;
    expect(objectKeys(expandLocalSpreads(call, `{ ...extra }`, shared)).spread).toBe(true);
    expect(objectKeys(expandLocalSpreads(`const extra = build();`, `{ ...extra }`, shared)).spread).toBe(true);
  });

  it("every metadata key the handler branches on is written by some creator", () => {
    const unwritten = [...readKeys].filter((k) => !written.has(k)).sort();
    expect(unwritten, `read by ${HANDLER} but written by no checkout creator`).toEqual([]);
  });

  it("every metadata key the handler reads is written into some creator's SESSION metadata", () => {
    const unwritten = [...readKeys].filter((k) => !sessionWritten.has(k)).sort();
    expect(unwritten, `read from session.metadata by ${HANDLER} but no creator puts it in session metadata`).toEqual([]);
  });

  it("every value the handler branches on is written into some creator's SESSION metadata", () => {
    // tip, the five kinds, one_time, "true" on 2026-10-01. A floor.
    expect(compared.length).toBeGreaterThanOrEqual(8);
    expect(compared).toContainEqual({ key: "type", value: "tip" });
    expect(compared).toContainEqual({ key: "kind", value: "job_boost" });
    const unwritten = compared
      .filter(({ key, value }) => {
        const vs = sessionWritten.get(key);
        return !vs || !(vs.has(value) || vs.has("*"));
      })
      .map(({ key, value }) => `${key}=${value}`);
    expect(unwritten, `branched on by ${HANDLER} but no creator writes that value into session metadata`).toEqual([]);
  });

  it("the session-level parsers are not vacuous", () => {
    const src = `const m = { kind: "x", y }; create({ payment_intent_data: { metadata: { type: "tip", only_pi: "1" } }, metadata: { job_id: id, type: "tip" } }); create({ payment_intent_data: { metadata: m } }); p.payment_intent_data = { metadata: { z: "1" } };`;
    const v = sessionMetadataValues(src);
    expect([...v.keys()].sort()).toEqual(["job_id", "type"]);
    expect([...v.get("type")!]).toEqual(["tip"]);
    expect([...v.get("job_id")!]).toEqual(["*"]);
    const shorthand = sessionMetadataValues(`const metadata = { kind: "k" }; create({ payment_intent_data: { metadata }, metadata, });`);
    expect([...shorthand.get("kind")!]).toEqual(["k"]);
    expect(
      comparedMetadataValues(`const t = (session.metadata as any)?.type;\nif (typeof t === "string" && t === "tip") {}\nif ((session.metadata as Record<string, string> | null)?.kind === "rv") {}`),
    ).toEqual([{ key: "kind", value: "rv" }, { key: "type", value: "tip" }]);
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
