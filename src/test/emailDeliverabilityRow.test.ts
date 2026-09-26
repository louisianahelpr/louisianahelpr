// @mutate scripts/scoreboard.mjs | status: b >= 2 \|\| c >= 0.1 ? "FAIL" : "PASS" | status: "PASS"
// @mutate scripts/scoreboard.mjs | else if (/;\s*p=none\b/.test(dmarc)) problems.push("DMARC policy is p=none (monitor only)"); | else if (false) problems.push("");
// @mutate scripts/scoreboard.mjs | ...(await emailDeliverabilityRows(readOnly, now)) | ...[]
/**
 * Q73: email deliverability is a LIVE scoreboard row, not a one-off look.
 * Measured 2026-09-26: SPF (send.louisianahelpr.com includes amazonses.com),
 * DKIM (resend._domainkey) and DMARC (p=quarantine) all resolve; 30 days: 954
 * sent, 1 bounce (0.10%), 0 complaints. This pins that the row FAILs on each
 * missing record, on a monitor-only DMARC, and on a bounce or complaint rate
 * over the mailbox providers' limits, and is UNKNOWN (never PASS) when it
 * cannot measure.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { emailDeliverabilityRows, EMAIL_RATES_SQL } from "../../scripts/scoreboard.mjs";

const NOW = new Date("2026-09-26T12:00:00Z");
type Row = { status: string; note: string; fail?: number };
const GOOD: Record<string, string[]> = {
  "send.louisianahelpr.com": ["v=spf1 include:amazonses.com ~all"],
  "resend._domainkey.louisianahelpr.com": ["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDGASQ2t/1h8H3EokFFUZHIqeb26QPKv17j"],
  "_dmarc.louisianahelpr.com": ["v=DMARC1; p=quarantine; rua=mailto:admin@louisianahelpr.com; fo=1"],
};
const dnsWith = (over: Record<string, string[] | Error>) => async (name: string) => {
  const v = name in over ? over[name] : GOOD[name];
  if (v instanceof Error) throw v;
  return v ?? [];
};
const okSql = async () => [{ sent: 954, bounces: 1, complaints: 0 }];
const rows = async (dns: (n: string) => Promise<string[]>, sql: (q: string) => Promise<unknown[]> = okSql): Promise<Row[]> =>
  emailDeliverabilityRows(sql, NOW, dns);
const enotfound = Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });

describe("scoreboard: email deliverability (Q73)", () => {
  it("PASSes on the records prod has today", async () => {
    const [dns, rate] = await rows(dnsWith({}));
    expect(dns.status).toBe("PASS");
    expect(rate.status).toBe("PASS");
    expect(rate.note).toMatch(/bounce 0\.10% \(1\)/);
  });

  it("FAILs when SPF, DKIM or DMARC is missing, or DMARC is monitor-only", async () => {
    expect((await rows(dnsWith({ "send.louisianahelpr.com": enotfound })))[0].status).toBe("FAIL");
    expect((await rows(dnsWith({ "resend._domainkey.louisianahelpr.com": [] })))[0].status).toBe("FAIL");
    expect((await rows(dnsWith({ "_dmarc.louisianahelpr.com": enotfound })))[0].status).toBe("FAIL");
    const none = (await rows(dnsWith({ "_dmarc.louisianahelpr.com": ["v=DMARC1; p=none"] })))[0];
    expect(none.status).toBe("FAIL");
    expect(none.note).toMatch(/p=none/);
  });

  it("FAILs on a bounce rate of 2% or a complaint rate of 0.1%", async () => {
    expect((await rows(dnsWith({}), async () => [{ sent: 100, bounces: 2, complaints: 0 }]))[1].status).toBe("FAIL");
    expect((await rows(dnsWith({}), async () => [{ sent: 1000, bounces: 0, complaints: 1 }]))[1].status).toBe("FAIL");
  });

  it("is UNKNOWN, never PASS, when it cannot measure", async () => {
    expect((await rows(dnsWith({ "send.louisianahelpr.com": Object.assign(new Error("timeout"), { code: "ETIMEOUT" }) })))[0].status).toBe("UNKNOWN");
    expect((await rows(dnsWith({}), async () => { throw new Error("boom"); }))[1].status).toBe("UNKNOWN");
    expect((await rows(dnsWith({}), async () => [{ sent: null, bounces: 0, complaints: 0 }]))[1].status).toBe("UNKNOWN");
    expect((await rows(dnsWith({}), async () => [{ sent: 0, bounces: 0, complaints: 0 }]))[1].status).toBe("UNKNOWN");
  });

  it("asks the exact question and is wired into liveRows", () => {
    expect(EMAIL_RATES_SQL).toMatch(/suppressed_emails WHERE reason = 'bounce'/);
    expect(EMAIL_RATES_SQL).toMatch(/suppressed_emails WHERE reason = 'complaint'/);
    const src = readFileSync(resolve(__dirname, "../../scripts/scoreboard.mjs"), "utf8");
    expect(src.slice(src.indexOf("export async function liveRows"))).toMatch(/\.\.\.\(await emailDeliverabilityRows\(readOnly, now\)\)/);
  });
});
