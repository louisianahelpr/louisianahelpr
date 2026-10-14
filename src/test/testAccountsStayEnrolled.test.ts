/**
 * The shared test accounts stay ENROLLED in public.test_accounts (Q552).
 *
 * With the launch switch on (seed_jobs_hidden_publicly() = true on prod), an
 * is_seed job or profile is hidden from every caller that is not a row in
 * public.test_accounts, and those rows cascade away with the auth user. The
 * 2026-10-09 hand re-creation of the six shared accounts left none of them
 * enrolled (measured on prod 2026-10-12: test_accounts held one row,
 * f2098932; poster-e2e 951264df and helper-e2e 7b923b19 absent). e2e-journeys
 * 38181872855, the TestFlight gate, then failed twice on it in both engines:
 *   - browse "filter by category": as helper-e2e, open_jobs_browse returned
 *     ONE row ("GIVE AWAY!!", other); the is_seed Cleaning fixture was hidden;
 *   - "poster saves the Helpr": as poster-e2e, get_safe_profiles(helper-e2e)
 *     returned 0 rows, so /user/7b923b19… said "Profile not found".
 *
 * The CLASS is "a harness depends on an account being a test account and
 * nothing keeps it one". Three layers, each pinned here:
 *   1. repair at every session mint that accepts the Terms (the same inventory
 *      sweepMintAcceptsTerms.test.ts keeps exact), and in prod-seed --apply;
 *   2. the helper refuses a non-is_seed profile and proves the rows stuck;
 *   3. the nightly detector (check-test-account-strikes.mjs) fails on an
 *      unenrolled shared account.
 *
 * @mutate scripts/lib/testAccountEnrolment.mjs |   return (profiles ?? []).filter((p) => !enrolled.has(p?.user_id)); |   return [];
 * @mutate scripts/lib/testAccountEnrolment.mjs |   if (real.length) throw | if (false) throw
 * @mutate scripts/lib/testAccountEnrolment.mjs |   if (still.length) throw | if (false) throw
 * @mutate e2e/journeys/fixtures.ts |       await ensureTestAccountsEnrolled({ supabaseUrl: SUPABASE_URL, serviceKey: creds.serviceKey, userIds: [session.user.id], note: `e2e journeys mint (${role})` }); // TEST-ACCOUNT-ENROLMENT at mint |       // removed
 * @mutate e2e/journeys/throwaway.ts |   await ensureTestAccountsEnrolled({ supabaseUrl: SUPABASE_URL, serviceKey: key, userIds: [userId], note: `e2e journey throwaway (${label})` }); // TEST-ACCOUNT-ENROLMENT for throwaways |   // removed
 * @mutate scripts/audit/prod-seed.mjs |   await enrolTestAccounts([posterId, helperId, ...Object.values(ids)]); |   // removed
 * @mutate scripts/check-test-account-strikes.mjs |   const unenrolled = findUnenrolled(profiles, enrolledRows); |   const unenrolled = [];
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHARED_TEST_ACCOUNTS,
  ensureTestAccountsEnrolled,
  findUnenrolled,
  isSharedTestAccount,
} from "../../scripts/lib/testAccountEnrolment.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// The pinned ids live only in ACCOUNTS (Q1650, testAccountIdsLiveInOnePlace).
const POSTER = ACCOUNTS["poster-e2e"].userId;
const HELPER = ACCOUNTS["helper-e2e"].userId;

type Call = { method: string; path: string; body: unknown };
function fakeRest(state: { profiles: { user_id: string; is_seed: boolean }[]; enrolled: string[]; insertSticks?: boolean }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: { method: string; body?: string }) => {
    const path = url.split("/rest/v1/")[1];
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    let out: unknown = [];
    if (init.method === "GET" && path.startsWith("profiles")) out = state.profiles;
    else if (init.method === "GET" && path.startsWith("test_accounts")) out = state.enrolled.map((user_id) => ({ user_id }));
    else if (init.method === "POST" && path.startsWith("test_accounts")) {
      if (state.insertSticks !== false) for (const r of body as { user_id: string }[]) state.enrolled.push(r.user_id);
      return new Response("", { status: 201 });
    }
    return new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}
const run = (f: ReturnType<typeof fakeRest>, userIds: string[]) =>
  ensureTestAccountsEnrolled({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", userIds, note: "t", fetchImpl: f.impl });

describe("findUnenrolled (the detector's decision)", () => {
  it("the 2026-10-12 prod state is red: neither journey account is enrolled", () => {
    const profiles = [{ user_id: POSTER, email: SHARED_TEST_ACCOUNTS[0] }, { user_id: HELPER, email: SHARED_TEST_ACCOUNTS[1] }];
    expect(findUnenrolled(profiles, [{ user_id: "f2098932-5563-47c3-9589-1d22cca72003" }])).toEqual(profiles);
  });
  it("is green once both are enrolled", () => {
    expect(findUnenrolled([{ user_id: POSTER }, { user_id: HELPER }], [{ user_id: POSTER }, { user_id: HELPER }])).toEqual([]);
  });
});

describe("ensureTestAccountsEnrolled (the repair)", () => {
  it("enrols the missing accounts and proves they stuck", async () => {
    const f = fakeRest({ profiles: [{ user_id: POSTER, is_seed: true }, { user_id: HELPER, is_seed: true }], enrolled: [] });
    expect(await run(f, [POSTER, HELPER])).toEqual({ checked: 2, added: [POSTER, HELPER] });
    const insert = f.calls.find((c) => c.method === "POST");
    expect(insert?.path).toMatch(/^test_accounts\?on_conflict=user_id/);
    expect(insert?.body).toEqual([{ user_id: POSTER, note: "t" }, { user_id: HELPER, note: "t" }]);
  });

  it("writes nothing when every account is already enrolled", async () => {
    const f = fakeRest({ profiles: [{ user_id: HELPER, is_seed: true }], enrolled: [HELPER] });
    expect(await run(f, [HELPER])).toEqual({ checked: 1, added: [] });
    expect(f.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("REFUSES a profile that is not is_seed, and writes nothing", async () => {
    const f = fakeRest({ profiles: [{ user_id: HELPER, is_seed: true }, { user_id: "real-person", is_seed: false }], enrolled: [] });
    await expect(run(f, [HELPER, "real-person"])).rejects.toThrow(/REFUSED, not is_seed: real-person/);
    expect(f.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("throws when an id has no profile", async () => {
    const f = fakeRest({ profiles: [], enrolled: [] });
    await expect(run(f, [HELPER])).rejects.toThrow(/no profile for/);
  });

  it("throws when the insert did not stick (a zero-row write is not an enrolment)", async () => {
    const f = fakeRest({ profiles: [{ user_id: HELPER, is_seed: true }], enrolled: [], insertSticks: false });
    await expect(run(f, [HELPER])).rejects.toThrow(/still not enrolled/);
  });

  it("only the shared addresses are enrolled at mint", () => {
    expect(isSharedTestAccount("Helpr-E2E-Helper-0902@mailinator.com")).toBe(true);
    expect(isSharedTestAccount("someone@gmail.com")).toBe(false);
    expect(SHARED_TEST_ACCOUNTS.length).toBeGreaterThanOrEqual(6);
  });
});

describe("every harness that relies on the accounts keeps them enrolled", () => {
  // The mint sites: every tracked e2e/ or scripts/ file that accepts the Terms
  // at mint (that inventory is kept exact by sweepMintAcceptsTerms.test.ts).
  const minters = execFileSync("git", ["ls-files", "-z", "--", "e2e", "scripts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
    .split("\0")
    .filter((f) => /\.(ts|mts|mjs|js)$/.test(f) && !/\.d\.mts$/.test(f) && f !== "scripts/lib/acceptCurrentTerms.mjs")
    .filter((f) => /\bacceptCurrentTerms\s*\(/.test(blankComments(read(f))));

  it("finds the mint sites (inventory floor)", () => {
    expect(minters.length).toBeGreaterThanOrEqual(3);
  });

  it.each(minters)("%s enrols a shared account at mint", (f) => {
    expect(blankComments(read(f))).toMatch(/\bensureTestAccountsEnrolled\s*\(/);
  });

  it("a journey throwaway is enrolled before it is handed to a journey (e2e-journeys 38527058685: no-show apply_to_job 403 job_not_available)", () => {
    const src = blankComments(read("e2e/journeys/throwaway.ts"));
    const body = src.slice(src.indexOf("export async function createThrowaway"), src.indexOf("export async function requireThrowaway"));
    const enrol = body.search(/\bensureTestAccountsEnrolled\s*\(\{[^}]*userIds: \[userId\]/);
    expect(enrol, "createThrowaway does not enrol its account in public.test_accounts").toBeGreaterThan(-1);
    expect(enrol, "the enrolment must follow the is_seed PATCH (the helper refuses a non-seed profile)").toBeGreaterThan(body.indexOf("is_seed: true"));
    expect(body.lastIndexOf("return { userId, email, session }")).toBeGreaterThan(enrol);
  });

  it("prod-seed --apply enrols the pair and every owned account, and --verify reports it", () => {
    const src = blankComments(read("scripts/audit/prod-seed.mjs"));
    expect(src).toMatch(/await enrolTestAccounts\(\[posterId, helperId, \.\.\.Object\.values\(ids\)\]\);/);
    expect(src).toMatch(/state: "poster \+ helper enrolled in test_accounts"/);
  });

  it("the nightly detector fails on an unenrolled shared account", () => {
    const src = blankComments(read("scripts/check-test-account-strikes.mjs"));
    expect(src).toMatch(/const unenrolled = findUnenrolled\(profiles, enrolledRows\);/);
    expect(src).toMatch(/if \(problems\.length === 0 && drift\.length === 0 && unenrolled\.length === 0\) \{/);
  });
});
