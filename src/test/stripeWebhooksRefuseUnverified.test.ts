/**
 * Every edge function that verifies a Stripe signature REFUSES what it could
 * not verify: no 2xx before verification succeeds (docs/OPEN.md Q156).
 *
 * The incident: on 2026-09-23 12:43:27Z a real Stripe delivery to
 * stripe-webhook failed signature verification and was answered 200 "to stop
 * Stripe retrying". A 200 tells Stripe the event was delivered, so it was never
 * sent again, Stripe's dashboard showed a success, and there was nothing left
 * to replay. Both Stripe webhook functions answered 200 the same way to a
 * missing key, a missing signing secret and a missing signature header.
 *
 * The CLASS: any response from the start of the handler up to the end of the
 * `catch` that follows `constructEventAsync(` is a response to an UNVERIFIED
 * request, so it must be non-2xx (an OPTIONS preflight is the one exception).
 * Inventory: every supabase/functions/<fn>/index.ts that calls
 * constructEventAsync, read from disk, never listed by hand.
 *
 * Second rule: a function a Stripe webhook endpoint delivers to must also page
 * ops (postSlackOpsAlert, which opens an ops_alert_ledger item) when a
 * signature fails, or a wrong secret is only visible in Stripe's dashboard.
 * NOT_A_STRIPE_ENDPOINT is the exact list of functions exempt from that rule;
 * it is checked in both directions.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts | return webhookRejectResponse("missing_signature_header"); | return new Response("{}", { status: 200 });
 * @mutate supabase/functions/stripe-idv-webhook/index.ts | return webhookRejectResponse("supabase_not_configured", corsHeaders); | return new Response("{}", { headers: corsHeaders });
 * @mutate supabase/functions/verification-webhook/index.ts | console.error("[verification-webhook] stripe_identity signature verification failed:", err);\n      return new Response("Unauthorized", { status: 401 }); | console.error("[verification-webhook] stripe_identity signature verification failed:", err);\n      return new Response("ok", { status: 202 });
 * @mutate supabase/functions/stripe-idv-webhook/index.ts | await postSlackOpsAlert(\n      signatureFailureAlert({\n        fn: "stripe-idv-webhook", | console.log(\n      signatureFailureAlert({\n        fn: "stripe-idv-webhook",
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FN_DIR = join(process.cwd(), "supabase/functions");

/**
 * Functions that call constructEventAsync but that no Stripe webhook endpoint
 * targets. verification-webhook's Stripe branch runs only when the caller sends
 * `x-vendor: stripe_identity`, a header Stripe never sends; the test-mode
 * endpoints (listed 2026-09-23) target stripe-webhook and stripe-idv-webhook.
 * It still must refuse (rule 1); it is exempt only from the paging rule.
 */
const NOT_A_STRIPE_ENDPOINT = ["verification-webhook"];

/** Index just past the `}` that closes the block opening at `open`. */
function blockEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Index just past the `)` that closes the call opening at `open`. */
function parenEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

type Fn = { name: string; region: string; catchBody: string };

function inventory(): Fn[] {
  const out: Fn[] = [];
  for (const name of readdirSync(FN_DIR)) {
    const file = join(FN_DIR, name, "index.ts");
    if (!existsSync(file)) continue;
    const src = blankComments(readFileSync(file, "utf8"));
    const call = src.lastIndexOf("constructEventAsync(");
    if (call < 0) continue;
    // The verification may sit in a helper (stripe-webhook's verifyAgainstAny);
    // the catch that decides the answer is the first one after the helper is
    // CALLED, i.e. after the last `await verify…()` or the call itself.
    let anchor = call;
    const helpers = [...src.slice(0, call).matchAll(/const\s+(\w+)\s*=\s*async\s*\([^)]*\)[^{=]*=>\s*\{/g)];
    const last = helpers.at(-1);
    if (last && last.index !== undefined) {
      const bodyOpen = last.index + last[0].length - 1;
      if (blockEnd(src, bodyOpen) > call) {
        // constructEventAsync sits inside this helper: the answer is decided
        // by the catch around the helper's CALL site.
        const callSite = src.indexOf(`await ${last[1]}(`, call);
        expect(callSite, `${name}: found helper ${last[1]} but not its call`).toBeGreaterThan(0);
        anchor = callSite;
      }
    }
    // Skip the helper's own inner try/catch: take the first catch after the anchor.
    const catchAt = src.indexOf("catch", anchor);
    const open = src.indexOf("{", catchAt);
    const end = blockEnd(src, open);
    out.push({ name, region: src.slice(0, end), catchBody: src.slice(open, end) });
  }
  return out;
}

/** Every Response built in `region` that is not the OPTIONS preflight, with its status. */
function responses(region: string): Array<{ line: string; status: number | null }> {
  const found: Array<{ line: string; status: number | null }> = [];
  const re = /new Response\(|webhookRejectResponse\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) {
    const lineStart = region.lastIndexOf("\n", m.index) + 1;
    const line = region.slice(lineStart, region.indexOf("\n", m.index));
    // The CORS preflight: `if (req.method === "OPTIONS") { return new Response(`
    // (either layout). It carries no event, so a 200 there drops nothing.
    const before = region.slice(Math.max(0, m.index - 120), m.index);
    if (/req\.method\s*===\s*["']OPTIONS["']\s*\)\s*\{?\s*return\s+$/.test(before)) continue;
    const args = region.slice(m.index, parenEnd(region, m.index + m[0].length - 1));
    if (m[0].startsWith("webhookRejectResponse")) {
      // The shared helper; its statuses are pinned in stripeWebhookReject.ts
      // and by the behavioural tests. Read the real number from the module.
      const reason = /webhookRejectResponse\(\s*["'](\w+)["']/.exec(args)?.[1] ?? "";
      found.push({ line: line.trim(), status: rejectStatus(reason) });
      continue;
    }
    const s = /status:\s*(\d{3})/.exec(args);
    found.push({ line: line.trim(), status: s ? Number(s[1]) : 200 /* Response defaults to 200 */ });
  }
  return found;
}

function rejectStatus(reason: string): number | null {
  const src = blankComments(readFileSync(join(FN_DIR, "_shared/stripeWebhookReject.ts"), "utf8"));
  const m = new RegExp(`\\b${reason}:\\s*(\\d{3})`).exec(src);
  return m ? Number(m[1]) : null;
}

describe("Stripe webhook functions refuse what they could not verify (Q156)", () => {
  const fns = inventory();

  it("finds every function that verifies a Stripe signature", () => {
    // Floor, not a list: stripe-webhook, stripe-idv-webhook and
    // verification-webhook on 2026-09-23.
    expect(fns.length).toBeGreaterThan(2);
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(["stripe-webhook", "stripe-idv-webhook"]));
  });

  it.each(fns.map((f) => [f.name, f] as const))("%s: no 2xx before the signature verifies", (_n, fn) => {
    const rs = responses(fn.region);
    expect(rs.length).toBeGreaterThan(0);
    const acked = rs.filter((r) => r.status === null || (r.status >= 200 && r.status < 300));
    expect(acked).toEqual([]);
  });

  it.each(fns.filter((f) => !NOT_A_STRIPE_ENDPOINT.includes(f.name)).map((f) => [f.name, f] as const))(
    "%s: a failed signature pages ops",
    (_n, fn) => {
      expect(fn.catchBody).toMatch(/\bpostSlackOpsAlert\(/);
    },
  );

  it("the paging exemption list is exact (both directions)", () => {
    for (const name of NOT_A_STRIPE_ENDPOINT) {
      const fn = fns.find((f) => f.name === name);
      expect(fn, `${name} no longer verifies a Stripe signature: drop it from NOT_A_STRIPE_ENDPOINT`).toBeDefined();
      expect(
        /\bpostSlackOpsAlert\(/.test(fn!.catchBody),
        `${name} now pages on a failed signature: drop it from NOT_A_STRIPE_ENDPOINT`,
      ).toBe(false);
    }
  });
});
