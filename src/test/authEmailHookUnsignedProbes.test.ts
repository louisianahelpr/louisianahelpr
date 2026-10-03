// @mutate supabase/functions/_shared/standardWebhookHeaders.ts | STANDARD_WEBHOOK_HEADERS.every( | STANDARD_WEBHOOK_HEADERS.some(
// @mutate supabase/functions/auth-email-hook/index.ts | if (!carriesStandardWebhookHeaders((name) => req.headers.get(name))) { | if (false) {
/*
 * The auth email hook pages only for a SIGNED call that fails verification.
 *
 * Ledger d5ceb038 ("auth email hook: bad signature", 2x by 2026-10-02): the
 * function URL is public, and the hook alerted on ANY call that failed
 * verification. 2026-10-02's one alert was a GET from python-httpx at a
 * Helsinki host with no Standard Webhooks headers, while Supabase Auth's four
 * POSTs (Go-http-client, AWS) that day all sent (function_edge_logs). An
 * unsigned call is refused before verification without paging; a signed one
 * that fails still alerts, because that is what a stale SEND_EMAIL_HOOK_SECRET
 * looks like.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { carriesStandardWebhookHeaders, STANDARD_WEBHOOK_HEADERS } from "../../supabase/functions/_shared/standardWebhookHeaders";

const headersOf = (h: Record<string, string>) => (name: string) => h[name] ?? null;
const SIGNED = { "webhook-id": "msg_1", "webhook-timestamp": "1790000000", "webhook-signature": "v1,abc=" };

describe("auth-email-hook refuses unsigned calls without paging", () => {
  it("a call carrying all three Standard Webhooks headers counts as signed", () => {
    expect(STANDARD_WEBHOOK_HEADERS).toHaveLength(3);
    expect(carriesStandardWebhookHeaders(headersOf(SIGNED))).toBe(true);
  });

  it("a call missing, emptying or blanking any one of them does not", () => {
    for (const name of STANDARD_WEBHOOK_HEADERS) {
      const rest = Object.fromEntries(Object.entries(SIGNED).filter(([k]) => k !== name));
      expect(carriesStandardWebhookHeaders(headersOf(rest)), `${name} missing`).toBe(false);
      expect(carriesStandardWebhookHeaders(headersOf({ ...SIGNED, [name]: "" })), `${name} empty`).toBe(false);
      expect(carriesStandardWebhookHeaders(headersOf({ ...SIGNED, [name]: "   " })), `${name} blank`).toBe(false);
    }
    expect(carriesStandardWebhookHeaders(headersOf({}))).toBe(false);
  });

  it("the hook checks for them before verifying, and that refusal pages no one", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/auth-email-hook/index.ts"), "utf8"));
    const gate = src.indexOf("if (!carriesStandardWebhookHeaders((name) => req.headers.get(name))) {");
    const verify = src.indexOf("new Webhook(secretValue)");
    expect(gate, "the unsigned-call gate is gone").toBeGreaterThan(0);
    expect(verify, "signature verification is gone").toBeGreaterThan(gate);
    expect(src.slice(gate, verify)).not.toMatch(/alertAuthEmail\(/);
    expect(src.slice(gate, verify)).toMatch(/status: 401/);
    // A signed call that fails verification still pages.
    const badSig = src.indexOf("alertAuthEmail('bad signature'");
    expect(badSig, "the bad-signature alert is gone").toBeGreaterThan(verify);
  });
});
