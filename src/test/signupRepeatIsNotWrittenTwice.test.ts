/**
 * Q2089: a repeated complete-signup (Q1810's second send after a lost answer)
 * must not write a second identical legal_acceptances row, and must answer
 * referralRecorded true when the first run recorded the referral.
 *
 * Two layers: the shared reads (supabase/functions/_shared/signupRepeat.ts),
 * run against a fake client, and the function itself, read as source, which
 * must gate its consent insert and its referral answer on those reads.
 *
 * @mutate supabase/functions/complete-signup/index.ts | const { error: legalErr } = consentRepeat | const { error: legalErr } = false
 * @mutate supabase/functions/complete-signup/index.ts | referralRecorded = referralOk === true \|\| (await referralAlreadyRecorded(supabase, userId)); | referralRecorded = referralOk === true;
 * @mutate supabase/functions/_shared/signupRepeat.ts | .gte("created_at", since) | .gte("created_at", "1970-01-01T00:00:00.000Z")
 * @mutate supabase/functions/_shared/signupRepeat.ts | return rows(result) > 0; | return rows(result) >= 0;
 * @mutate supabase/functions/_shared/signupRepeat.ts | return rows(result) !== 0; | return true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  CONSENT_REPEAT_WINDOW_MS,
  consentAlreadyRecorded,
  referralAlreadyRecorded,
  type RepeatReadClient,
} from "../../supabase/functions/_shared/signupRepeat";

type Row = Record<string, string>;

/** A tiny in-memory PostgREST: eq / gte / limit over the named table. */
function fakeClient(tables: Record<string, Row[]>, failWith?: string): RepeatReadClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    from(table: string) {
      return {
        select(_cols: string) {
          const filters: Array<(r: Row) => boolean> = [];
          const chain = {
            eq(column: string, value: string) {
              calls.push(`${table}.${column}=${value}`);
              filters.push((r) => r[column] === value);
              return chain;
            },
            gte(column: string, value: string) {
              calls.push(`${table}.${column}>=${value}`);
              filters.push((r) => r[column] >= value);
              return chain;
            },
            limit(n: number) {
              if (failWith) return Promise.resolve({ data: null, error: { message: failWith } });
              const data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, n);
              return Promise.resolve({ data, error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return client;
}

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("consentAlreadyRecorded (Q2089)", () => {
  const row = { user_id: "u1", terms_version: "T1", privacy_version: "P1", created_at: iso(60_000) };

  it("a row for the same user and versions inside the window is the same completion", async () => {
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [row] }), "u1", "T1", "P1", NOW)).toBe(true);
  });

  it("no row, another user, other versions, or an older row is a new consent", async () => {
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [] }), "u1", "T1", "P1", NOW)).toBe(false);
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [row] }), "u2", "T1", "P1", NOW)).toBe(false);
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [row] }), "u1", "T2", "P1", NOW)).toBe(false);
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [row] }), "u1", "T1", "P2", NOW)).toBe(false);
    const old = { ...row, created_at: iso(CONSENT_REPEAT_WINDOW_MS + 60_000) };
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [old] }), "u1", "T1", "P1", NOW)).toBe(false);
  });

  it("a failed read writes the row anyway (a duplicate beats a missing consent record)", async () => {
    expect(await consentAlreadyRecorded(fakeClient({ legal_acceptances: [row] }, "boom"), "u1", "T1", "P1", NOW)).toBe(false);
  });
});

describe("referralAlreadyRecorded (Q2089)", () => {
  it("a referrals row naming this user as referred means the first run recorded it", async () => {
    const c = fakeClient({ referrals: [{ referred_id: "u1" }] });
    expect(await referralAlreadyRecorded(c, "u1")).toBe(true);
    expect(c.calls).toEqual(["referrals.referred_id=u1"]);
  });

  it("no row, a row for someone else, or a failed read is not recorded", async () => {
    expect(await referralAlreadyRecorded(fakeClient({ referrals: [] }), "u1")).toBe(false);
    expect(await referralAlreadyRecorded(fakeClient({ referrals: [{ referred_id: "u2" }] }), "u1")).toBe(false);
    expect(await referralAlreadyRecorded(fakeClient({ referrals: [{ referred_id: "u1" }] }, "boom"), "u1")).toBe(false);
  });
});

describe("complete-signup uses them (Q2089)", () => {
  const fn = blankComments(
    readFileSync(resolve(__dirname, "../../supabase/functions/complete-signup/index.ts"), "utf8"),
  );

  it("the legal_acceptances insert is skipped on a repeat", () => {
    const inserts = [...fn.matchAll(/from\("legal_acceptances"\)\s*\.insert\(/g)];
    expect(inserts.length, "one consent insert").toBe(1);
    const before = fn.slice(Math.max(0, inserts[0].index! - 400), inserts[0].index!);
    expect(before).toMatch(/const consentRepeat = await consentAlreadyRecorded\(supabase, userId, LEGAL_TERMS_VERSION, LEGAL_PRIVACY_VERSION\)/);
    expect(before).toMatch(/=\s*consentRepeat\s*\?\s*\{\s*error:\s*null\s*\}\s*:\s*await supabase\.$/);
  });

  it("a FALSE from record_referral_signup is checked against an existing referral", () => {
    expect(fn).toMatch(/referralRecorded = referralOk === true \|\| \(await referralAlreadyRecorded\(supabase, userId\)\);/);
    const assigns = [...fn.matchAll(/\breferralRecorded\s*=(?!=)/g)];
    expect(assigns.length, "declaration + the one answer").toBe(2);
  });
});
