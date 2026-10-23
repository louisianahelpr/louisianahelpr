/**
 * PayPal webhook verification (supabase/functions/_shared/payments/paypalWebhookVerify.ts):
 * FAIL CLOSED. The fixture is a delivery signed with a self-signed TEST
 * certificate (openssl, 2026-10-23; private key discarded), so the certificate
 * path is proved green on a real RSA signature and red on one flipped byte.
 *
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | return `${h.transmissionId}\|${h.transmissionTime}\|${webhookId}\|${crc32(rawBody)}`; | return `${h.transmissionId}\|${h.transmissionTime}\|${webhookId}\|0`;
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | && PAYPAL_CERT_HOSTS[env].includes(u.hostname) | && u.hostname.length > 0
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | if (nowMs < info.notBefore \|\| nowMs > info.notAfter) return false; | if (false) return false;
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | if (r?.verification_status === "FAILURE") return { ok: false, final: true, reason: "postback_failure" }; | if (r?.verification_status === "FAILURE") postbackError = "x";
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | { rawJsonBody: post, idempotencyKey: `lh:whverify:${await sha256Hex(post)}` }, | { rawJsonBody: post, idempotencyKey: `lh:whverify:${h.transmissionId}` },
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | if (status === 401 \|\| status === 403) return { ok: false, final: false, reason: `paypal_auth_failed_${status}` }; | void status;
 * @mutate supabase/functions/_shared/payments/paypalWebhookVerify.ts | if (nowMs - sentAt > MAX_DELIVERY_AGE_MS \|\| sentAt - nowMs > MAX_CLOCK_SKEW_MS) { | if (false) {
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  certInfoFromPem,
  clearCertCache,
  crc32,
  isAllowedCertUrl,
  verifyPayPalWebhook,
  verifyWithCertificate,
  readSignatureHeaders,
} from "../../supabase/functions/_shared/payments/paypalWebhookVerify.ts";
import { ProviderApiError } from "../../supabase/functions/_shared/payments/types.ts";

const FX = JSON.parse(readFileSync("src/test/fixtures/paypalWebhook/signedDelivery.json", "utf8")) as {
  certPem: string; rawBody: string; webhookId: string; headers: Record<string, string>; crc32: number;
};
const NOW = Date.UTC(2026, 9, 24);
const enc = (s: string) => new TextEncoder().encode(s);
const sigHeaders = (over: Record<string, string> = {}) => new Headers({ ...FX.headers, ...over });

type Answer = { verification_status: string } | ProviderApiError;
function deps(answer: Answer, certCalls: string[] = [], posted: Array<{ key?: string; raw?: string }> = []) {
  return {
    env: "sandbox" as const,
    webhookId: FX.webhookId,
    now: () => NOW,
    fetchCert: async (url: string) => { certCalls.push(url); return FX.certPem; },
    client: {
      request: async (_m: string, _p: string, opts: { idempotencyKey?: string; rawJsonBody?: string }) => {
        posted.push({ key: opts.idempotencyKey, raw: opts.rawJsonBody });
        if (answer instanceof ProviderApiError) throw answer;
        return answer;
      },
    } as never,
  };
}

beforeEach(() => clearCertCache());

describe("crc32 and the signed message", () => {
  it("is IEEE CRC-32 (check value) and matches the fixture", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc(FX.rawBody))).toBe(FX.crc32);
  });
});

describe("cert URL allowlist", () => {
  it("accepts only PayPal's HTTPS cert path for the right environment", () => {
    expect(isAllowedCertUrl("https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox")).toBe(true);
    expect(isAllowedCertUrl("https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox")).toBe(true);
    expect(isAllowedCertUrl("https://api.paypal.com/v1/notifications/certs/CERT-1", "sandbox")).toBe(false);
    expect(isAllowedCertUrl("http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox")).toBe(false);
    expect(isAllowedCertUrl("https://api.sandbox.paypal.com.evil.test/v1/notifications/certs/C", "sandbox")).toBe(false);
    expect(isAllowedCertUrl(`https://api.sandbox.paypal.com:${8443}/v1/notifications/certs/CERT-1`, "sandbox")).toBe(false);
    expect(isAllowedCertUrl("https://x@api.sandbox.paypal.com/v1/notifications/certs/C", "sandbox")).toBe(false);
    expect(isAllowedCertUrl("https://api.sandbox.paypal.com/v1/other", "sandbox")).toBe(false);
    expect(isAllowedCertUrl("not a url", "sandbox")).toBe(false);
  });
});

describe("certificate verification", () => {
  const h = readSignatureHeaders(sigHeaders())!;
  it("reads the leaf certificate's key and validity", () => {
    const info = certInfoFromPem(FX.certPem);
    expect(info.spki.length).toBeGreaterThan(250);
    expect(info.notAfter).toBeGreaterThan(info.notBefore);
  });
  it("green on the signed fixture", async () => {
    expect(await verifyWithCertificate(FX.certPem, h, FX.webhookId, enc(FX.rawBody), NOW)).toBe(true);
  });
  it("red on one flipped body byte, another webhook id, a wrong algo, or an expired certificate", async () => {
    const flipped = FX.rawBody.replace("105.70", "105.71");
    expect(await verifyWithCertificate(FX.certPem, h, FX.webhookId, enc(flipped), NOW)).toBe(false);
    expect(await verifyWithCertificate(FX.certPem, h, "OTHERWEBHOOKID", enc(FX.rawBody), NOW)).toBe(false);
    expect(await verifyWithCertificate(FX.certPem, { ...h, authAlgo: "SHA1withRSA" }, FX.webhookId, enc(FX.rawBody), NOW)).toBe(false);
    expect(await verifyWithCertificate(FX.certPem, h, FX.webhookId, enc(FX.rawBody), Date.UTC(2040, 0, 1))).toBe(false);
  });
});

describe("verifyPayPalWebhook: postback first, certificate only when PayPal is unreachable", () => {
  it("missing headers or a foreign cert URL is final, and asks nobody", async () => {
    const certCalls: string[] = []; const posted: unknown[] = [];
    const h = sigHeaders(); h.delete("paypal-transmission-sig");
    expect(await verifyPayPalWebhook(h, FX.rawBody, deps({ verification_status: "SUCCESS" }, certCalls, posted as never)))
      .toEqual({ ok: false, final: true, reason: "missing_signature_headers" });
    const foreign = sigHeaders({ "paypal-cert-url": "https://evil.test/v1/notifications/certs/C" });
    expect((await verifyPayPalWebhook(foreign, FX.rawBody, deps({ verification_status: "SUCCESS" }, certCalls, posted as never))).ok).toBe(false);
    expect(certCalls).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("postback SUCCESS passes; FAILURE is final with no fallback", async () => {
    const certCalls: string[] = [];
    expect(await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps({ verification_status: "SUCCESS" }, certCalls)))
      .toEqual({ ok: true, via: "postback" });
    expect(await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps({ verification_status: "FAILURE" }, certCalls)))
      .toEqual({ ok: false, final: true, reason: "postback_failure" });
    expect(certCalls).toEqual([]);
  });

  it("a 4xx from the postback is final (never downgraded to the local check)", async () => {
    const certCalls: string[] = [];
    const r = await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps(new ProviderApiError("bad", 400, "INVALID_REQUEST", null, null), certCalls));
    expect(r).toEqual({ ok: false, final: true, reason: "postback_refused_400" });
    expect(certCalls).toEqual([]);
  });

  it("PayPal unreachable: the certificate decides (green on the fixture, red on a flipped byte)", async () => {
    const down = new ProviderApiError("down", 503, null, null, null);
    expect(await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps(down))).toEqual({ ok: true, via: "certificate" });
    clearCertCache();
    const r = await verifyPayPalWebhook(sigHeaders(), FX.rawBody.replace("105.70", "105.71"), deps(down));
    expect(r).toEqual({ ok: false, final: true, reason: "certificate_signature_mismatch" });
  });

  it("neither reachable: not final (the caller answers 503 so PayPal redelivers)", async () => {
    const down = new ProviderApiError("down", 0, null, null, null);
    const d = { ...deps(down), fetchCert: async () => { throw new Error("cert host down"); } };
    const r = await verifyPayPalWebhook(sigHeaders(), FX.rawBody, d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.final).toBe(false);
  });

  it("the postback carries the raw event, keyed by a hash of everything posted (a copied transmission id cannot replay a cached SUCCESS)", async () => {
    const posted: Array<{ key?: string; raw?: string }> = [];
    await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps({ verification_status: "SUCCESS" }, [], posted));
    await verifyPayPalWebhook(sigHeaders(), FX.rawBody.replace("105.70", "1.00"), deps({ verification_status: "FAILURE" }, [], posted));
    expect(posted[0].raw).toContain(`"webhook_event":${FX.rawBody}}`);
    expect(posted[0].key).toMatch(/^lh:whverify:[0-9a-f]{64}$/);
    expect(posted[1].key).not.toBe(posted[0].key);
  });

  it("our own credentials failing (401/403) is NOT final: 503, PayPal redelivers, the caller alerts", async () => {
    const certCalls: string[] = [];
    const r = await verifyPayPalWebhook(sigHeaders(), FX.rawBody, deps(new ProviderApiError("paypal token: 401 invalid_client", 401, "invalid_client", null, null), certCalls));
    expect(r).toEqual({ ok: false, final: false, reason: "paypal_auth_failed_401" });
    expect(certCalls).toEqual([]);
  });

  it("a delivery outside PayPal's retry window is refused before any call", async () => {
    const posted: Array<{ key?: string }> = [];
    const old = await verifyPayPalWebhook(sigHeaders(), FX.rawBody, { ...deps({ verification_status: "SUCCESS" }, [], posted), now: () => Date.UTC(2026, 9, 29) });
    expect(old).toEqual({ ok: false, final: true, reason: "transmission_time_out_of_window" });
    const future = await verifyPayPalWebhook(sigHeaders(), FX.rawBody, { ...deps({ verification_status: "SUCCESS" }, [], posted), now: () => Date.UTC(2026, 9, 23, 22, 0) });
    expect(future).toEqual({ ok: false, final: true, reason: "transmission_time_out_of_window" });
    const bad = await verifyPayPalWebhook(sigHeaders({ "paypal-transmission-time": "yesterday" }), FX.rawBody, deps({ verification_status: "SUCCESS" }, [], posted));
    expect(bad).toEqual({ ok: false, final: true, reason: "transmission_time_invalid" });
    expect(posted).toEqual([]);
  });

  it("a body that is not JSON is final", async () => {
    expect(await verifyPayPalWebhook(sigHeaders(), "not json", deps({ verification_status: "SUCCESS" })))
      .toEqual({ ok: false, final: true, reason: "body_not_json" });
  });
});
