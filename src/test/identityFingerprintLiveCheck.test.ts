// @mutate scripts/scoreboard.mjs | status: missing === 0 ? "PASS" : "FAIL" | status: "PASS"
// @mutate scripts/scoreboard.mjs | ...(await identityFingerprintRows(readOnly, now)) | ...[]
/**
 * Q240: THE IDENTITY-FINGERPRINT BACKFILL IS A LIVE NUMBER, NOT A MEMORY.
 *
 * stripe-idv-webhook writes profiles.identity_sha256 only for verifications
 * after 2026-09-08; older ones stay unfingerprinted until
 * scripts/backfill-identity-fingerprints.mjs runs (it needs STRIPE_SECRET_KEY
 * and reads Stripe, so it cannot be a migration). Measured on prod
 * 2026-09-23: 3 of 3 verified-with-session profiles had no fingerprint.
 *
 * The scoreboard (scoreboard.yml, daily) now asks prod every run and shows
 * FAIL while any verified profile lacks one. This test pins that the row is
 * wired, FAILs on a positive count, PASSes only on zero, and is UNKNOWN (never
 * PASS) when the query fails or returns a bad shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { identityFingerprintRows, IDENTITY_FP_SQL } from "../../scripts/scoreboard.mjs";

const NOW = new Date("2026-09-23T12:00:00Z");
type Row = { status: string; fail?: number; pass?: number; note: string };
const rowsFor = async (sqlFn: (q: string) => Promise<unknown[]>): Promise<Row[]> => identityFingerprintRows(sqlFn, NOW);

describe("scoreboard: verified profiles carry an identity fingerprint (Q240)", () => {
  it("asks the exact question", () => {
    expect(IDENTITY_FP_SQL).toMatch(/idv_status = 'verified' AND idv_session_id IS NOT NULL AND identity_sha256 IS NULL/);
  });

  it("FAILs while any verified profile lacks one, naming the backfill", async () => {
    const [r] = await rowsFor(async () => [{ missing: 3, verified: 3 }]);
    expect(r.status).toBe("FAIL");
    expect(r.fail).toBe(3);
    expect(r.note).toMatch(/backfill-identity-fingerprints/);
  });

  it("PASSes only on zero missing", async () => {
    const [r] = await rowsFor(async () => [{ missing: 0, verified: 3 }]);
    expect(r.status).toBe("PASS");
    expect(r.pass).toBe(3);
  });

  it("is UNKNOWN, never PASS, when the query fails or returns a bad shape", async () => {
    expect((await rowsFor(async () => { throw new Error("boom"); }))[0].status).toBe("UNKNOWN");
    expect((await rowsFor(async () => []))[0].status).toBe("UNKNOWN");
    expect((await rowsFor(async () => [{ missing: null, verified: 1 }]))[0].status).toBe("UNKNOWN");
  });

  it("is wired into liveRows", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/scoreboard.mjs"), "utf8");
    const live = src.slice(src.indexOf("export async function liveRows"));
    expect(live).toMatch(/\.\.\.\(await identityFingerprintRows\(readOnly, now\)\)/);
  });
});
