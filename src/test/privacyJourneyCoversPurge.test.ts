/**
 * GUARD: the monthly privacy journey (docs/OPEN.md Q70) checks EVERY purge
 * step, EVERY identity bucket and EVERY export section the code has — and can
 * never delete a real account.
 *
 * Two-way against source, so the journey cannot silently fall behind:
 *   - every `step: "<name>"` accountPurge.ts reports  ==  EXPECTED_PURGE_STEPS;
 *   - purgeBuckets.ts IDENTITY_BUCKETS (accountPurge's)  ==  the journey's list;
 *   - the keys of DataExportCard's export payload       ==  EXPORT_SECTIONS;
 *   - every EXPECTED_DB_COUNTS key is a counter the NEWEST purge_user_data()
 *     returns.
 * The spec itself (e2e/privacy/privacy-requests.spec.ts) must assert each of
 * those lists (loops over them), run assertDisposable fresh from the database
 * before "Delete Forever", and be run monthly by privacy-journey.yml, which
 * reports a red run to the ops alert ledger and the nightly-red issue.
 * assertDisposable is exercised here directly: it must refuse every shape of
 * real or shared account (fail closed).
 *
 * @mutate supabase/functions/_shared/accountPurge.ts | steps.push({ step: "avatar_pointer", ok: false, | steps.push({ step: "avatar_ptr", ok: false,
 * @mutate supabase/functions/_shared/purgeBuckets.ts |   "user-documents",\n |
 * @mutate src/pages/info/legal/DataExportCard.tsx |         reviews: reviewsRes.data,\n |
 * @mutate scripts/lib/privacyJourney.mjs |   if (subject.isSeed !== true) throw | if (false) throw
 * @mutate scripts/lib/privacyJourney.mjs |   if (m[1] !== subject.runTag) throw | if (false) throw
 * @mutate scripts/lib/privacyJourney.mjs | created < subject.runStartedAt - 5 * 60_000) | false)
 * @mutate e2e/privacy/privacy-requests.spec.ts |     await requireDisposable(request, userId);\n    const [res] |     const [res]
 * @mutate .github/workflows/privacy-journey.yml | npx playwright test --project=privacy | npx playwright test --project=prod-audit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import {
  assertDisposable,
  disposableEmail,
  EXPECTED_DB_COUNTS,
  EXPECTED_PURGE_STEPS,
  EXPORT_SECTIONS,
  IDENTITY_BUCKETS,
  KNOWN_NOT_EXPORTED,
  SHARED_TEST_EMAILS,
} from "../../scripts/lib/privacyJourney.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PURGE = blankComments(read("supabase/functions/_shared/accountPurge.ts"));
// Q219 moved the list (with its existence check) out of accountPurge.ts.
const PURGE_BUCKETS = blankComments(read("supabase/functions/_shared/purgeBuckets.ts"));
const SPEC = blankComments(read("e2e/privacy/privacy-requests.spec.ts"));
const WORKFLOW = read(".github/workflows/privacy-journey.yml");

describe("privacy journey covers every purge step (Q70)", () => {
  it("purge steps: accountPurge.ts and the journey name the same set", () => {
    const inSource = [...new Set([...PURGE.matchAll(/\bstep:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(inSource.length).toBeGreaterThan(5);
    expect(inSource).toEqual([...EXPECTED_PURGE_STEPS].sort());
  });

  it("identity buckets: the purge and the journey list the same buckets", () => {
    expect(PURGE).toMatch(/import \{[^}]*\bIDENTITY_BUCKETS\b[^}]*\} from "\.\/purgeBuckets\.ts"/);
    const block = /const IDENTITY_BUCKETS = \[([\s\S]*?)\] as const/.exec(PURGE_BUCKETS)?.[1] ?? "";
    const inSource = [...block.matchAll(/"([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(inSource.length).toBeGreaterThan(2);
    expect(inSource).toEqual([...IDENTITY_BUCKETS].sort());
  });

  it("export sections: DataExportCard's payload keys == EXPORT_SECTIONS", () => {
    const card = blankComments(read("src/pages/info/legal/DataExportCard.tsx"));
    const payload = /const payload = \{([\s\S]*?)\};/.exec(card)?.[1] ?? "";
    const keys = [...payload.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(keys.length).toBeGreaterThan(3);
    expect(keys).toEqual([...EXPORT_SECTIONS].sort());
    for (const t of KNOWN_NOT_EXPORTED) expect(keys, `${t} is exported now: shrink KNOWN_NOT_EXPORTED`).not.toContain(t);
  });

  it("every purge_user_data counter the journey checks is one the NEWEST definition returns", () => {
    const body = latestFunctionDefs(join(ROOT, "supabase", "migrations")).get("purge_user_data")?.body ?? "";
    const returned = new Set([...body.matchAll(/'([a-z_]+)',\s*v_\w+/g)].map((m) => m[1]));
    expect(returned.size).toBeGreaterThan(20);
    for (const k of Object.keys(EXPECTED_DB_COUNTS)) expect(returned, `purge_user_data returns no '${k}'`).toContain(k);
  });

  it("the spec asserts each list, not a sample", () => {
    expect(SPEC).toMatch(/for \(const name of EXPECTED_PURGE_STEPS\)/);
    expect(SPEC).toMatch(/for \(const bucket of IDENTITY_BUCKETS\)\s*\n?\s*expect\(await listObjects/);
    expect(SPEC).toMatch(/for \(const section of EXPORT_SECTIONS\)/);
    expect(SPEC).toMatch(/for \(const \[counter, min\] of Object\.entries\(EXPECTED_DB_COUNTS\)\)/);
    expect(SPEC).toMatch(/toEqual\(\[\.\.\.KNOWN_NOT_EXPORTED\]\.sort\(\)\)/);
  });

  it("the spec re-checks the account is disposable, fresh, right before Delete Forever", () => {
    const press = SPEC.indexOf('getByRole("button", { name: "Delete Forever" })');
    const check = SPEC.lastIndexOf("await requireDisposable(request, userId);", press);
    expect(press).toBeGreaterThan(-1);
    expect(check, "no requireDisposable before the Delete Forever press").toBeGreaterThan(-1);
    expect(SPEC.slice(check, press)).not.toMatch(/await page\.goto/);
  });

  it("privacy-journey.yml runs the privacy project monthly and reports red to the ledger (via nightly-red)", () => {
    expect(WORKFLOW).toMatch(/cron: "\d+ \d+ \* \* \d"/);
    expect(WORKFLOW).toMatch(/date -u \+%-d/);
    expect(WORKFLOW).toMatch(/"\$day" -gt 7/);
    expect(WORKFLOW).toMatch(/npx playwright test --project=privacy /);
    // Reported through nightly-red (the ledger sync reads it, and only the
    // notify job of a DUE green run closes it). A workflow-kind ledger item
    // would close on the next green run, and the gate makes 3 of 4 weekly
    // runs green by doing nothing.
    expect(WORKFLOW).toMatch(/workflow-name: privacy-journey/);
    expect(WORKFLOW).toMatch(/needs\.gate\.outputs\.run != 'false'/);
    expect(WORKFLOW).not.toMatch(/--verify-ref "privacy-journey\.yml"/);
    expect(read("scripts/ops-alert-ledger.mjs")).toMatch(/"nightly-red"/);
    expect(read("playwright.config.ts")).toMatch(/name: "privacy",\s*\n\s*testDir: "\.\/e2e\/privacy"/);
  });
});

describe("assertDisposable fails closed (Q70)", () => {
  const tag = "abc123def456";
  const now = Date.now();
  const good = { runTag: tag, runStartedAt: now, email: disposableEmail(tag), isSeed: true, authCreatedAt: new Date(now + 1000).toISOString() };

  it("accepts this run's disposable seed account", () => {
    expect(assertDisposable(good)).toBe(true);
  });

  it.each([
    ["a real address", { email: "someone.real@gmail.com" }],
    ["a look-alike on another domain", { email: `helpr-privacy-journey-${tag}@gmail.com` }],
    ["another run's disposable account", { email: disposableEmail("zzz999yyy888") }],
    ["a non-seed profile", { isSeed: false }],
    ["a missing profile (is_seed unknown)", { isSeed: null }],
    ["an account created before this run", { authCreatedAt: new Date(now - 60 * 60_000).toISOString() }],
    ["an unknown creation time", { authCreatedAt: null }],
    ["no email", { email: null }],
  ])("refuses %s", (_name, override) => {
    expect(() => assertDisposable({ ...good, ...override })).toThrow(/REFUSED/);
  });

  it.each(SHARED_TEST_EMAILS)("refuses the shared test account %s", (email) => {
    expect(() => assertDisposable({ ...good, email })).toThrow(/REFUSED/);
  });

  it("the shared list is the real one (floor)", () => {
    expect(SHARED_TEST_EMAILS.length).toBeGreaterThan(3);
  });
});
