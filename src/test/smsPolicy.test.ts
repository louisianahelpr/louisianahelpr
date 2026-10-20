/**
 * SMS alerts: the pure policy (supabase/functions/_shared/smsPolicy.ts).
 * The privacy rule: a text is only ever a fixed phrase plus our own link.
 */
// @mutate supabase/functions/_shared/smsPolicy.ts | if (typeof jobId === "string" && UUID_RE.test(jobId)) return | if (typeof jobId === "string") return
// @mutate supabase/functions/_shared/smsPolicy.ts | if (input.firstText) parts.push("Reply STOP to stop."); |
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildSmsBody,
  classifyInboundKeyword,
  smsLinkPath,
  twilioConfig,
  twilioSignature,
  twiml,
  SMS_HELP_REPLY,
  type SmsKind,
} from "../../supabase/functions/_shared/smsPolicy";

const KINDS: SmsKind[] = ["message", "job_match", "job_offer", "job_update", "confirm"];
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APP = "https://www.louisianahelpr.com";

describe("buildSmsBody", () => {
  it("every kind fits one GSM-7 segment (<=160 chars, ASCII only) even on the first text", () => {
    expect(KINDS.length).toBeGreaterThan(3);
    for (const kind of KINDS) {
      const body = buildSmsBody({ kind, jobId: JOB, firstText: true, appUrl: APP });
      expect(body.length, body).toBeLessThanOrEqual(160);
      expect(/^[\x20-\x7e]*$/.test(body), body).toBe(true);
      expect(body.startsWith("Louisiana Helpr: ")).toBe(true);
    }
  });

  it("says how to stop on the first text only", () => {
    expect(buildSmsBody({ kind: "message", firstText: true, appUrl: APP })).toMatch(/Reply STOP to stop\.$/);
    expect(buildSmsBody({ kind: "message", firstText: false, appUrl: APP })).not.toMatch(/STOP/);
  });

  it("only a real uuid reaches the link; anything else falls back to /jobs", () => {
    expect(smsLinkPath("job_offer", JOB)).toBe(`/jobs?job=${JOB}`);
    expect(smsLinkPath("job_offer", "123 Main St, Baton Rouge")).toBe("/jobs");
    expect(smsLinkPath("job_offer", `${JOB}&x=Lexi`)).toBe("/jobs");
    expect(smsLinkPath("message", JOB)).toBe("/messages");
  });

  it("the signature takes no free text at all (title/body cannot be passed)", () => {
    // A compile-time property, checked at run time too: extra fields are ignored.
    const body = buildSmsBody({ kind: "job_update", jobId: JOB, firstText: false, appUrl: APP, ...({ title: "Lexi Lombas is on the way", message: "123 Main St" } as object) } as Parameters<typeof buildSmsBody>[0]);
    expect(body).not.toMatch(/Lexi|Main St/);
  });
});

describe("the double opt-in text", () => {
  it("asks for YES and carries the disclosures, with no link", () => {
    const t = buildSmsBody({ kind: "confirm", firstText: false, appUrl: APP });
    expect(t).toMatch(/Reply YES/);
    expect(t).toMatch(/Msg frequency varies/);
    expect(t).toMatch(/Msg&data rates may apply/);
    expect(t).toMatch(/HELP/);
    expect(t).toMatch(/STOP/);
    expect(t).not.toMatch(/https?:/);
    expect(classifyInboundKeyword("Yes")).toBe("start");
  });
});

describe("classifyInboundKeyword", () => {
  it("matches the whole body, any case", () => {
    expect(classifyInboundKeyword(" Stop ")).toBe("stop");
    expect(classifyInboundKeyword("UNSUBSCRIBE")).toBe("stop");
    expect(classifyInboundKeyword("stop.")).toBe("stop");
    expect(classifyInboundKeyword("start")).toBe("start");
    expect(classifyInboundKeyword("help")).toBe("help");
    expect(classifyInboundKeyword("don't stop")).toBeNull();
    expect(classifyInboundKeyword(undefined)).toBeNull();
  });
});

describe("twilioConfig", () => {
  it("is null unless all three secrets are present and well-formed", () => {
    const full: Record<string, string> = {
      TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_MESSAGING_SERVICE_SID: "MG" + "b".repeat(32),
    };
    expect(twilioConfig((k) => full[k])).not.toBeNull();
    for (const k of Object.keys(full)) {
      const partial = { ...full, [k]: "" };
      expect(twilioConfig((x) => partial[x]), k).toBeNull();
    }
    expect(twilioConfig((k) => (k === "TWILIO_ACCOUNT_SID" ? "PN123" : full[k]))).toBeNull();
  });
});

describe("twilioSignature", () => {
  it("matches Twilio's documented algorithm (independent HMAC-SHA1 in node:crypto)", async () => {
    const url = "https://example.supabase.co/functions/v1/twilio-inbound";
    const params = { To: "+18005550100", From: "+12255550123", Body: "STOP", AccountSid: "AC1" };
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const expected = createHmac("sha1", "secret").update(data).digest("base64");
    expect(await twilioSignature("secret", url, params)).toBe(expected);
    expect(await twilioSignature("other", url, params)).not.toBe(expected);
  });
});

describe("twiml", () => {
  it("escapes the reply", () => {
    expect(twiml("a & <b>")).toContain("<Message>a &amp; &lt;b&gt;</Message>");
    expect(twiml()).toContain("<Response></Response>");
    expect(SMS_HELP_REPLY.length).toBeLessThanOrEqual(160);
  });
});
