/**
 * CLASS GUARD (PayPal Plan A phase 1): PayPal is spoken to in ONE layer, every
 * write there is idempotent, and the webhook stores nothing it has not verified.
 *
 * (a) No source file outside supabase/functions/_shared/payments/ names a
 *     PayPal API host or a PayPal money path. The app (src/) never does; an edge
 *     function goes through the provider seam. A second, hand-rolled PayPal
 *     call is exactly how a retry without PayPal-Request-Id would pay twice.
 * (b) Inside the layer, every POST/PATCH `request(...)` passes an
 *     idempotencyKey (the client also refuses at runtime; this catches it in CI).
 * (c) paypal-webhook verifies before it parses the body or writes the inbox,
 *     and returns on a failed verification before either.
 *
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts | const r = await client.request<{ id: string; status: string; amount: Money }>(\n        "POST",\n        `/v2/payments/captures/${input.providerCaptureId}/refund`,\n        {\n          idempotencyKey: input.idempotencyKey, | const r = await client.request<{ id: string; status: string; amount: Money }>(\n        "POST",\n        `/v2/payments/captures/${input.providerCaptureId}/refund`,\n        {
 * @mutate supabase/functions/paypal-webhook/index.ts | if (!outcome.ok) { | if (outcome.ok === "never") {
 * @mutate supabase/functions/paypal-webhook/index.ts | const bytes = new Uint8Array(await req.arrayBuffer()); | const bytes = new Uint8Array(await req.arrayBuffer()); await createClient("", "").from("paypal_webhook_events").insert({});
 * @mutate supabase/functions/_shared/money.ts | export function formatPayoutDollars(amount: number): string { | export const PAYPAL_PROBE = "https://api-m.sandbox.paypal.com/v2/checkout/orders"; export function formatPayoutDollars(amount: number): string {
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const LAYER = path.join("supabase", "functions", "_shared", "payments") + path.sep;
const PAYPAL_REF = /api(?:-m)?\.(?:sandbox\.)?paypal\.com|\/v2\/checkout\/orders|\/v2\/payments\/|\/v1\/payments\/payouts|\/v1\/notifications\/verify-webhook-signature/;

const rel = (f: string) => path.relative(ROOT, f);
const code = (f: string) => blankComments(readFileSync(f, "utf8"));

/** The argument text of each call starting at `open` (index of "("), balanced. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

describe("PayPal is called only from the payments layer", () => {
  const files = walkSource([path.join(ROOT, "src"), path.join(ROOT, "supabase", "functions")])
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`));

  it("reads a real inventory (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.filter((f) => rel(f).startsWith(LAYER)).length).toBeGreaterThan(5);
  });

  it("(a) no PayPal host or money path outside supabase/functions/_shared/payments/", () => {
    const offenders = files.filter((f) => !rel(f).startsWith(LAYER) && PAYPAL_REF.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("(b) every POST/PATCH request in the layer passes an idempotencyKey", () => {
    const writes: string[] = [];
    const unkeyed: string[] = [];
    for (const f of files.filter((x) => rel(x).startsWith(LAYER))) {
      const src = code(f);
      for (const m of src.matchAll(/\.request(?:<[\s\S]*?>)?\(\s*"(POST|PATCH)"/g)) {
        const args = argsAt(src, m.index! + m[0].search(/\(\s*"(?:POST|PATCH)"$/));
        writes.push(`${rel(f)}@${m.index}`);
        if (!/\bidempotencyKey\b/.test(args)) unkeyed.push(`${rel(f)}@${m.index}: ${args.slice(0, 80)}`);
      }
    }
    expect(writes.length).toBeGreaterThan(6);
    expect(unkeyed).toEqual([]);
  });

  it("(c) paypal-webhook verifies, and returns on failure, before it parses or stores", () => {
    const f = path.join(ROOT, "supabase", "functions", "paypal-webhook", "index.ts");
    expect(existsSync(f)).toBe(true);
    const src = code(f);
    const verify = src.indexOf("await verifyPayPalWebhook(");
    const refuse = src.indexOf("if (!outcome.ok) {");
    const parse = src.indexOf("JSON.parse(rawBody)");
    const firstStore = src.search(/\.from\(\s*["']paypal_webhook_events["']\s*\)/);
    expect(verify).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(verify);
    expect(parse).toBeGreaterThan(refuse);
    expect(firstStore).toBeGreaterThan(refuse);
    // The refusal branch really returns (400 final, 503 otherwise).
    const branch = src.slice(refuse, parse);
    expect(branch).toMatch(/return json\(400/);
    expect(branch).toMatch(/return json\(503/);
  });
});
