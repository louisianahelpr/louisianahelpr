/**
 * acceptCurrentTerms never writes an OLDER Terms version over a newer one
 * (2026-10-07: a shared checkout behind origin/main read "Sep 2026" from its
 * stale consent.ts and wrote it over the test accounts' "Oct 2026", so every
 * sweep and agent hit the re-agree modal).
 *
 * @mutate scripts/lib/acceptCurrentTerms.mjs | if (held !== null && ours !== null && held > ours) { | if (false) {
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptCurrentTerms, latestConsentVersions, versionRank } from "../../scripts/lib/acceptCurrentTerms.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("acceptCurrentTerms never downgrades", () => {
  it("ranks 'Mon YYYY' versions in time order", () => {
    expect(versionRank("Oct 2026")).toBeGreaterThan(versionRank("Sep 2026")!);
    expect(versionRank("Jan 2027")).toBeGreaterThan(versionRank("Dec 2026")!);
    expect(versionRank("not a version")).toBeNull();
  });

  it("refuses, writing nothing, when the account already holds a newer version", async () => {
    const { terms } = latestConsentVersions();
    const newer = `Dec ${Number(terms.slice(-4)) + 1}`;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return { ok: true, status: 200, json: async () => [{ terms_version_accepted: newer }] };
    }));
    await expect(acceptCurrentTerms("https://x.supabase.co", "anon", "tok", "u1")).rejects.toThrow(/refusing to downgrade/);
    expect(calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
  });

  it("still brings an account on an OLDER version up to current", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string }) => {
      methods.push(init?.method ?? "GET");
      return { ok: true, status: 200, json: async () => (init?.method === "PATCH" ? [{ user_id: "u1" }] : [{ terms_version_accepted: "Jan 2020" }]) };
    }));
    await acceptCurrentTerms("https://x.supabase.co", "anon", "tok", "u1");
    expect(methods).toContain("PATCH");
  });
});
