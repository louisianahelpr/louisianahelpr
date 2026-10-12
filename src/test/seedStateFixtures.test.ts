/**
 * Q946 / Q593 / Q1554 / Q1561 / Q1562 / Q1402 / Q1327 / Q1286 / Q1427: the
 * durable seed STATE fixtures (scripts/e2e/seedStateFixtures.mjs) hold one
 * state each, on prod, between the shared test accounts, with no money behind
 * them. What must hold, and why:
 *   1. no fixture row ever carries a Stripe id: every money mover refuses a
 *      job with no PaymentIntent before calling Stripe, and that refusal is
 *      the safety (a row with a PI could be released from the LIVE balance);
 *   2. other tools leave them alone: titles start with "SEED " (press never
 *      mutates a SEED row), ids are v5 (press clean-up never deletes one), no
 *      title carries a sweeper's marker, and prod-seed neither reviews nor
 *      disputes one;
 *   3. a freshly built fixture is healthy by its own predicate at every hour of
 *      the week it is built in (else --apply would rebuild it forever), and the
 *      scheduled pair stop being healthy when the clock moves them out of
 *      their state (else --apply would keep a stale one);
 *   4. teardown deletes only this module's own is_seed rows.
 *
 * @mutate scripts/e2e/seedStateFixtures.mjs |   if (job.stripe_payment_intent_id \|\| job.stripe_session_id) return "carries a Stripe id (must never)"; |   if (false) return "";
 * @mutate scripts/e2e/seedStateFixtures.mjs |     created_at: new Date(now - DAY).toISOString(), |     created_at: new Date(now).toISOString(),
 * @mutate scripts/e2e/seedStateFixtures.mjs |       if (now >= confirmWindowOpensMs(job)) return "confirm window already open (no longer 4 days out)"; |       // removed
 * @mutate scripts/e2e/seedStateFixtures.mjs |   { key: "helper-completed", title: "SEED Trim two crepe myrtles", |   { key: "helper-completed", title: "Trim two crepe myrtles",
 * @mutate scripts/e2e/seedStateFixtures.mjs |     if (!stateFixtureJobIds().includes(job.id) \|\| job.is_seed !== true \|\| job.customer_id !== POSTER.userId) { |     if (false) {
 * @mutate scripts/audit/prod-seed.mjs | j.payment_status === "released" && !stateFixtures.has(j.id) | j.payment_status === "released"
 * @mutate scripts/audit/prod-seed.mjs | && !j.has_active_dispute && !stateFixtures.has(j.id)); | && !j.has_active_dispute);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { hasStreetAddress } from "@/pages/jobs/appliedJobCard/JobAddressLine";
import {
  CREW_MATE,
  HELPER,
  JOB_FIXTURES,
  POSTER,
  confirmWindowOpensMs,
  fixtureId,
  fixtureJobRow,
  fixtureProblem,
  jobStartMs,
  runStateFixtures,
  stateFixtureJobIds,
} from "../../scripts/e2e/seedStateFixtures.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as press from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "../..");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A Monday 00:00 UTC two weeks before DST ends (2026-11-01), so the hourly
// walk below crosses the change.
const WEEK_START = Date.UTC(2026, 9, 19, 0, 0, 0);

/** The row as --apply leaves it, for the keys a pure predicate can judge. */
function builtRow(key: string, now: number): Record<string, unknown> {
  const fixture = JOB_FIXTURES.find((f) => f.key === key)!;
  const row: Record<string, unknown> = { ...fixtureJobRow(fixture, now), stripe_payment_intent_id: null, stripe_session_id: null };
  const at = new Date(now).toISOString();
  if (key.startsWith("helper-") || key === "dispute-refiled") Object.assign(row, { status: "accepted", helper_id: HELPER.userId, helper_confirmed_at: at });
  if (key === "helper-arrived-photo" || key === "helper-completed" || key === "dispute-refiled") {
    Object.assign(row, { status: "in_progress", helper_on_the_way_at: at, helper_arrived_at: at, helper_arrival_verified_at: at, proof_before_urls: null });
  }
  if (key === "helper-completed") Object.assign(row, { status: "completed", payment_status: "released" });
  if (key === "dispute-refiled") Object.assign(row, { status: "disputed" });
  if (key === "crew-unconfirmed") Object.assign(row, { status: "accepted" });
  return row;
}
const builtExtra = (now: number) => ({
  disputes: [
    { status: "withdrawn", helper_response: "answer" },
    { status: "open", helper_response: null },
  ],
  roster: [{ helper_id: HELPER.userId, helper_confirmed_at: null, response_deadline: new Date(now + 48 * HOUR).toISOString() }],
});

describe("seed state fixtures (Q946)", () => {
  it("covers every state the items need (inventory floor)", () => {
    expect(JOB_FIXTURES.length).toBeGreaterThan(5);
    expect(new Set(JOB_FIXTURES.flatMap((f) => f.items))).toEqual(new Set(["Q1554", "Q1561", "Q1562", "Q1327", "Q1402", "Q593", "Q1427"]));
  });

  it("no fixture row carries a Stripe id, and a row that does is never healthy", () => {
    for (const f of JOB_FIXTURES) {
      const row = fixtureJobRow(f, WEEK_START);
      expect(row, f.key).not.toHaveProperty("stripe_payment_intent_id");
      expect(row, f.key).not.toHaveProperty("stripe_session_id");
      expect(row.payment_status, f.key).toBe("escrow");
      expect(row.is_seed, f.key).toBe(true);
      expect(row.customer_id, f.key).toBe(POSTER.userId);
      const built = builtRow(f.key, WEEK_START);
      expect(fixtureProblem(f.key, built, builtExtra(WEEK_START), WEEK_START), f.key).toBeNull();
      expect(fixtureProblem(f.key, { ...built, stripe_payment_intent_id: "pi_x" }, builtExtra(WEEK_START), WEEK_START), f.key).toMatch(/Stripe/);
      expect(fixtureProblem(f.key, { ...built, stripe_session_id: "cs_live_x" }, builtExtra(WEEK_START), WEEK_START), f.key).toMatch(/Stripe/);
    }
  });

  it("is born past the early-access window, at a real street address", () => {
    for (const f of JOB_FIXTURES) {
      const row = fixtureJobRow(f, WEEK_START);
      expect(WEEK_START - Date.parse(String(row.created_at)), f.key).toBeGreaterThanOrEqual(DAY);
      expect(hasStreetAddress(String(row.location)), f.key).toBe(true);
    }
  });

  it("stays out of the other tools' way", () => {
    const markers = new Set<string>();
    for (const file of [
      ...readdirSync(join(ROOT, "scripts/e2e")).filter((x) => x.endsWith(".mjs")).map((x) => join(ROOT, "scripts/e2e", x)),
      join(ROOT, "scripts/audit/pressProdSafety.mjs"),
    ]) {
      for (const m of blankComments(readFileSync(file, "utf8")).matchAll(/export const \w*MARKER\s*=\s*"([^"]+)"/g)) markers.add(m[1]);
    }
    expect(markers.size).toBeGreaterThan(3);
    const ids = stateFixtureJobIds();
    expect(new Set(ids).size).toBe(JOB_FIXTURES.length);
    for (const f of JOB_FIXTURES) {
      expect(press.isSharedSeed(f.title), `${f.key}: press treats it as a shared SEED row`).toBe(true);
      for (const m of markers) expect(f.title.includes(m) || f.title.includes(m.replace(/[[\]]/g, "")), `${f.key} carries ${m}`).toBe(false);
      expect(press.isSeedRowId(fixtureId(`job:${f.key}`)), `${f.key}: press clean-up never deletes a v5 id`).toBe(true);
    }
    const seed = blankComments(readFileSync(join(ROOT, "scripts/audit/prod-seed.mjs"), "utf8"));
    expect(seed).toMatch(/stateFixtureJobIds\(\)/);
    expect(seed).toMatch(/const releasedJob = [^\n]*!stateFixtures\.has\(j\.id\)/);
    expect(seed).toMatch(/const disputeTarget = [^\n]*!stateFixtures\.has\(j\.id\)/);
    expect(seed).toMatch(/const openDispute = [^\n]*!stateFixtures\.has\(j\.id\)/);
  });

  it("a fixture built at any hour of the week is healthy right after it is built", () => {
    for (let now = WEEK_START; now < WEEK_START + 14 * DAY; now += HOUR) {
      for (const f of JOB_FIXTURES) {
        expect(fixtureProblem(f.key, builtRow(f.key, now), builtExtra(now), now), `${f.key} built at ${new Date(now).toISOString()}`).toBeNull();
      }
    }
  });

  it("the scheduled pair leave their state when the clock does", () => {
    const fourDays = builtRow("helper-scheduled-4d", WEEK_START);
    const opens = confirmWindowOpensMs(fourDays as { date_needed: string; start_time: string });
    expect(fixtureProblem("helper-scheduled-4d", fourDays, {}, opens - HOUR)).toBeNull();
    expect(fixtureProblem("helper-scheduled-4d", fourDays, {}, opens)).toMatch(/confirm window already open/);

    const dayBefore = builtRow("helper-scheduled-daybefore", WEEK_START);
    const start = jobStartMs(dayBefore as { date_needed: string; start_time: string });
    expect(fixtureProblem("helper-scheduled-daybefore", dayBefore, {}, start - 4 * HOUR)).toBeNull();
    expect(fixtureProblem("helper-scheduled-daybefore", dayBefore, {}, start - 2 * HOUR)).toMatch(/within 3 hours/);
    expect(fixtureProblem("helper-scheduled-daybefore", dayBefore, {}, confirmWindowOpensMs(dayBefore as { date_needed: string }) - HOUR)).toMatch(/not open yet/);

    const crew = builtRow("crew-unconfirmed", WEEK_START);
    expect(fixtureProblem("crew-unconfirmed", crew, builtExtra(WEEK_START), WEEK_START + 47 * HOUR)).toMatch(/answer window/);
    expect(fixtureProblem("crew-unconfirmed", crew, { roster: [{ helper_id: HELPER.userId, helper_confirmed_at: "x", response_deadline: new Date(WEEK_START + 48 * HOUR).toISOString() }] }, WEEK_START)).toMatch(/already confirmed/);
    expect(fixtureProblem("dispute-refiled", builtRow("dispute-refiled", WEEK_START), { disputes: [{ status: "open" }] }, WEEK_START)).toMatch(/withdrawn/);
  });

  it("teardown refuses a row that is not this module's own is_seed job", async () => {
    const id = stateFixtureJobIds()[0];
    const fake = (job: Record<string, unknown>) => (async (url: string, init?: { method?: string }) => {
      const u = String(url);
      const body = (() => {
        if (u.includes("/profiles?")) return [
          { user_id: POSTER.userId, email: POSTER.email, is_seed: true, stripe_account_id: null },
          { user_id: HELPER.userId, email: HELPER.email, is_seed: true, stripe_account_id: null },
          { user_id: CREW_MATE.userId, email: "eli.test.helper@louisianahelpr.com", is_seed: true, stripe_account_id: null },
        ];
        if (u.includes("/test_accounts?")) return [{ user_id: POSTER.userId }, { user_id: HELPER.userId }, { user_id: CREW_MATE.userId }];
        if (u.includes("/jobs?") && init?.method === "GET") return [job];
        if (u.includes("/jobs?") && init?.method === "DELETE") return [{ id }];
        return [];
      })();
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const run = (job: Record<string, unknown>) => runStateFixtures({ mode: "--teardown", only: [JOB_FIXTURES[0].key], serviceKey: "k", fetchImpl: fake(job), log: () => {} });
    await expect(run({ id, is_seed: false, customer_id: POSTER.userId })).rejects.toThrow(/REFUSED/);
    await expect(run({ id, is_seed: true, customer_id: HELPER.userId })).rejects.toThrow(/REFUSED/);
    await expect(run({ id, is_seed: true, customer_id: POSTER.userId, stripe_payment_intent_id: "pi_x" })).rejects.toThrow(/REFUSED/);
    const ok = await run({ id, is_seed: true, customer_id: POSTER.userId });
    expect(ok.report[0].action).toBe("deleted");
  });
});
