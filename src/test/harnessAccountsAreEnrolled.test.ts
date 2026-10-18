/*
 * CLASS GUARD: an is_seed account a harness CREATES is enrolled in
 * public.test_accounts, or it cannot act on a test job.
 *
 * With the launch switch on (seed_jobs_hidden_publicly() = true on prod since
 * 2026-10-07, measured again 2026-10-17), enforce_application_job_state C6
 * refuses an application to an is_seed job from anyone outside test_accounts
 * (seed_hidden_for), and every browse surface hides test rows from them.
 * e2e-journeys 39020810698 (2026-10-17): the no-show journey's throwaway Helpr
 * got `apply_to_job: 403 job_not_available` on poster-e2e's is_seed job,
 * because createThrowaway marked it is_seed and never enrolled it. The shared
 * accounts were already enrolled at mint (e2e/journeys/fixtures.ts) and by
 * prod-seed; the per-run throwaways and the App Review demo account (whose row
 * a re-create cascades away, Q1649) were not.
 *
 * Inventory, from source with comments blanked: every file under scripts/ and
 * e2e/ that creates an auth user (auth/v1/admin/users, auth.admin.createUser)
 * and marks a profile is_seed: true. Each calls ensureTestAccountsEnrolled,
 * or is in NOT_ENROLLED with the measured reason it must not be. Both ways:
 * an exemption that is no longer in the inventory, or that now enrols, fails.
 */

// @mutate e2e/journeys/throwaway.ts | await ensureTestAccountsEnrolled({ supabaseUrl: SUPABASE_URL, serviceKey: key, userIds: [userId], note: `journey throwaway (${label})` }); | void label;
// @mutate scripts/create-app-review-demo-account.mjs | const enrolled = await ensureTestAccountsEnrolled( | const enrolled = { added: [] }; void (

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const root = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs|ts|mts)$/.test(name) && !name.endsWith(".d.mts")) out.push(p);
  }
  return out;
}

/** Harnesses whose created account must stay OUT of test_accounts, and why. */
const NOT_ENROLLED: Record<string, string> = {
  "scripts/feature-switch-audience.mjs":
    "its probe is the ORDINARY (non-tester) account a hidden switch must never reach; it asserts the probe is NOT in test_accounts before judging anything",
  "e2e/privacy/privacy-requests.spec.ts":
    "the disposable account only exports and deletes its own data (service-role writes for its jobs); it passed unenrolled with the switch on (privacy-journey 38520742416, 2026-10-14)",
};

const code = (abs: string) => blankComments(readFileSync(abs, "utf8"));
const FILES = [...walk(join(root, "scripts")), ...walk(join(root, "e2e"))];
const CREATES = /auth\/v1\/admin\/users|\.auth\.admin\.createUser\(/;
const SEEDS = /is_seed["']?\s*:\s*true/;
const ENROLS = /\bensureTestAccountsEnrolled\(/;
const INVENTORY = FILES.filter((f) => {
  const c = code(f);
  return CREATES.test(c) && SEEDS.test(c);
}).map((f) => relative(root, f)).sort();

describe("harness-created is_seed accounts are enrolled in test_accounts", () => {
  it("the inventory is real (floor)", () => {
    expect(INVENTORY.length).toBeGreaterThanOrEqual(5);
    expect(INVENTORY).toContain("e2e/journeys/throwaway.ts");
  });

  it("every creator enrols its account, or is exempt with a reason", () => {
    const missing = INVENTORY.filter((rel) => !(rel in NOT_ENROLLED) && !ENROLS.test(code(join(root, rel))));
    expect(missing, "call ensureTestAccountsEnrolled (scripts/lib/testAccountEnrolment.mjs) after marking the profile is_seed").toEqual([]);
  });

  it("every exemption is still a creator and still does not enrol (two-way)", () => {
    for (const [rel, why] of Object.entries(NOT_ENROLLED)) {
      expect(INVENTORY, `${rel} is no longer an is_seed account creator: drop its exemption`).toContain(rel);
      expect(ENROLS.test(code(join(root, rel))), `${rel} now enrols: drop its exemption`).toBe(false);
      expect(why.length).toBeGreaterThan(40);
    }
  });

  it("createThrowaway enrols the throwaway it made, after marking it is_seed", () => {
    const src = code(join(root, "e2e/journeys/throwaway.ts"));
    const body = src.match(/export async function createThrowaway\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(body, "createThrowaway is gone").not.toBe("");
    const seedAt = body.search(/is_seed:\s*true/);
    const enrolAt = body.search(/await ensureTestAccountsEnrolled\(\{[^}]*userIds:\s*\[userId\]/);
    expect(seedAt).toBeGreaterThan(-1);
    expect(enrolAt, "createThrowaway does not enrol [userId]").toBeGreaterThan(-1);
    expect(enrolAt, "enrol after the is_seed PATCH (it refuses a non-is_seed profile)").toBeGreaterThan(seedAt);
  });
});
