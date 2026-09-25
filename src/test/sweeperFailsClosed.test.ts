/*
 * CLASS GUARD: a sweep that could not do its job is not green.
 *
 * lh-money-escrow REVIEW-ONLY pass on the #1719 fix (2026-09-25) found the
 * sweep path green on every one of these:
 *   M1  a helper sign-in that failed in a TEARDOWN step, an unreadable
 *       HELPER_ACCESS_TOKEN, and a hired+funded row past 48h that the sweep held
 *       both seats for and still did not settle;
 *   M3  no way for a lane to hold a marker job on purpose: the sweep would
 *       settle or delete it;
 *   L2  settling forward (it ends in a real `release`) with nothing saying
 *       Stripe is in TEST mode;
 *   L3  the listing was every marker title the poster could read (not only its
 *       own seed rows), and a zero-row reopen PATCH counted as a reopen.
 *
 * These run the REAL scripts against a local HTTP stand-in for PostgREST
 * (never prod): scripts/e2e/prod-lifecycle-sweeper.mjs as a child process, and
 * scripts/e2e/sweep-both-seats.sh copied beside a stub mint and a stub sweeper.
 */

// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | if (HELPER_TOKEN && !HELPER_ID) { | if (false) {
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |   if (PHASE === "teardown") failures.push(`settle forward: ${msg}`); |   if (false) failures.push(`settle forward: ${msg}`);
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | const STRIPE_TEST_MODE = STRIPE_MODE === "test"; | const STRIPE_TEST_MODE = true;
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |     `&customer_id=eq.${POSTER_ID}&is_seed=is.true` + |
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |     return Array.isArray(rows) && rows.length === 1; |     return true;
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |   const holdWhy = heldReason(job); |   const holdWhy = null;
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | if (verdict === "settle-forward" && job.stripe_session_id == null) { | if (false) {
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | summary.stale.filter((r) => String(sessionOf.get(r.id) ?? "").startsWith("cs_test_")) | summary.stale
// @mutate scripts/e2e/sweep-both-seats.sh |     if [ "$SWEEP_PHASE" = "teardown" ]; then |     if false; then

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const SWEEPER = join(root, "scripts/e2e/prod-lifecycle-sweeper.mjs");

const POSTER = "11111111-1111-4111-8111-111111111111";
const HELPER = "22222222-2222-4222-8222-222222222222";
const jwt = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const HOURS = 3_600_000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const MARKER = "[E2E DO NOT ACCEPT]";

type Row = Record<string, unknown>;
interface Scenario {
  rows: Row[];
  patchAnswer?: unknown[];
}
interface Seen { method: string; url: string }

let server: Server;
let base = "";
let scenario: Scenario = { rows: [] };
let seen: Seen[] = [];

function body(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    await body(req);
    const url = req.url ?? "";
    seen.push({ method: req.method ?? "", url });
    const json = (code: number, v: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (url.startsWith("/rest/v1/jobs") && req.method === "GET") {
      const id = /[?&]id=eq\.([^&]+)/.exec(url)?.[1];
      return json(200, id ? scenario.rows.filter((r) => r.id === id) : scenario.rows);
    }
    if (url.startsWith("/rest/v1/jobs") && req.method === "PATCH") return json(200, scenario.patchAnswer ?? []);
    if (url.startsWith("/rest/v1/jobs") && req.method === "DELETE") {
      const id = /[?&]id=eq\.([^&]+)/.exec(url)?.[1];
      return json(200, [{ id }]);
    }
    // Every settle leg fails: the walk throws, the row stays deferred.
    if (url.startsWith("/rest/v1/rpc/")) return json(500, { message: "stand-in refuses" });
    if (url.startsWith("/storage/")) return json(200, []);
    return json(404, { message: `unrouted ${req.method} ${url}` });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(cmd: string, args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      cwd: root,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

function sweep(env: Record<string, string>, s: Scenario) {
  scenario = s;
  seen = [];
  return run("node", [SWEEPER], {
    SUPABASE_URL: base,
    SUPABASE_ANON_KEY: "anon",
    POSTER_ACCESS_TOKEN: jwt(POSTER),
    ...env,
  });
}

const staleHiredFunded: Row = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: `${MARKER} J stale`,
  status: "accepted",
  payment_status: "escrow",
  stripe_session_id: "cs_test_abc",
  created_at: iso(72 * HOURS),
  customer_id: POSTER,
  helper_id: HELPER,
  is_seed: true,
  disputed_at: null,
  has_active_dispute: false,
};

describe("the sweeper fails closed", () => {
  it("refuses an unreadable HELPER_ACCESS_TOKEN instead of sweeping poster-only (M1)", async () => {
    const r = await sweep({ HELPER_ACCESS_TOKEN: "not-a-jwt", SWEEP_PHASE: "pre" }, { rows: [] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/HELPER_ACCESS_TOKEN is set but its `sub` cannot be read/);
    expect(seen, "it must stop before touching the API").toEqual([]);
  });

  it("a teardown that held both seats in test mode FAILS on a row past 48h it could not settle (M1)", async () => {
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test" },
      { rows: [staleHiredFunded] },
    );
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/were NOT settled forward although this sweep held both seats/);
    expect(seen.some((s) => s.url.includes("/rpc/mark_helper_arrival")), "the walk was attempted").toBe(true);
  }, 30_000);

  it("never settles forward unless E2E_STRIPE_MODE says test (L2)", async () => {
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "live" },
      { rows: [staleHiredFunded] },
    );
    expect(r.out).toMatch(/E2E_STRIPE_MODE is "live", not "test"/);
    expect(seen.filter((s) => s.url.includes("/rpc/") || s.url.includes("/functions/")), r.out).toEqual([]);
    // Deferred and warned, never a walk; not a failure the sweep could have fixed.
    expect(r.code, r.out).toBe(0);
  }, 30_000);

  it("lists only this poster's seed rows (L3)", async () => {
    await sweep({ SWEEP_PHASE: "pre" }, { rows: [] });
    const listing = seen.find((s) => s.method === "GET" && s.url.startsWith("/rest/v1/jobs"));
    expect(listing?.url).toContain(`customer_id=eq.${POSTER}`);
    expect(listing?.url).toContain("is_seed=is.true");
  });

  it("a reopen PATCH that matched zero rows is a failure, not a reopen (L3)", async () => {
    const unfundedHired = { ...staleHiredFunded, id: "aaaaaaaa-0000-4000-8000-000000000002", payment_status: "unpaid", stripe_session_id: null };
    const r = await sweep({ SWEEP_PHASE: "teardown" }, { rows: [unfundedHired], patchAnswer: [] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/reopen .*could not reset status/);
    expect(seen.some((s) => s.method === "DELETE"), "no delete after a reopen that did not land").toBe(false);
  });

  it("never touches a row held on purpose (M3)", async () => {
    const heldRow = { ...staleHiredFunded, id: "aaaaaaaa-0000-4000-8000-000000000003", title: `${MARKER} [E2E HOLD] two-role fixture` };
    const heldUnfunded = { ...heldRow, id: "aaaaaaaa-0000-4000-8000-000000000004", payment_status: "unpaid", stripe_session_id: null };
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test" },
      { rows: [heldRow, heldUnfunded], patchAnswer: [{ id: "x" }] },
    );
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/held \(\[E2E HOLD\] in the title\) — not touched/);
    expect(seen.filter((s) => s.method !== "GET" || /[?&]id=eq\./.test(s.url)), r.out).toEqual([]);
  });

  it("never touches the two-role fixture, by id, even without the title marker", async () => {
    const fixture = { ...staleHiredFunded, id: "aaaaaaaa-0000-4000-8000-000000000005", title: `${MARKER} two-role, no hold marker` };
    const fixtureUnfunded = { ...fixture, payment_status: "unpaid", stripe_session_id: null };
    for (const row of [fixture, fixtureUnfunded]) {
      const r = await sweep(
        { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test", PLAYWRIGHT_LIFECYCLE_JOB_ID: row.id as string },
        { rows: [row], patchAnswer: [{ id: "x" }] },
      );
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/held \(the two-role fixture \(PLAYWRIGHT_LIFECYCLE_JOB_ID\)\) — not touched/);
      expect(seen.filter((s) => s.method !== "GET" || /[?&]id=eq\./.test(s.url)), r.out).toEqual([]);
    }
    // Control: the same row with the secret unset IS walked (it is not held by title).
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test" },
      { rows: [fixture] },
    );
    expect(seen.some((s) => s.url.includes("/rpc/mark_helper_arrival")), r.out).toBe(true);
  }, 30_000);

  it("a hired+funded row with NO Checkout Session is held with a warning, not a teardown failure", async () => {
    const giftFunded = { ...staleHiredFunded, id: "aaaaaaaa-0000-4000-8000-000000000006", stripe_session_id: null };
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test" },
      { rows: [giftFunded] },
    );
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/::warning title=Funded test job with no Checkout Session::aaaaaaaa-0000-4000-8000-000000000006/);
    expect(r.out).toMatch(/held \(no Checkout Session\)/);
    expect(seen.filter((s) => s.method !== "GET" || /[?&]id=eq\./.test(s.url)), r.out).toEqual([]);
  });

  it("a stale cs_live_ row is refused and warned about, not counted as a failed settle", async () => {
    const liveFunded = { ...staleHiredFunded, id: "aaaaaaaa-0000-4000-8000-000000000007", stripe_session_id: "cs_live_abc" };
    const r = await sweep(
      { HELPER_ACCESS_TOKEN: jwt(HELPER), SWEEP_PHASE: "teardown", E2E_STRIPE_MODE: "test" },
      { rows: [liveFunded] },
    );
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/NOT settling — not funded through a test-mode Checkout Session/);
    expect(r.out).toMatch(/::warning title=Stranded funded test jobs are not settling forward::1 /);
  }, 30_000);
});

describe("sweep-both-seats.sh: a teardown that cannot hold the helper seat fails", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sweep-both-seats-"));
    copyFileSync(join(root, "scripts/e2e/sweep-both-seats.sh"), join(dir, "sweep-both-seats.sh"));
    // The mint fails for the helper seat and succeeds for anyone else.
    writeFileSync(join(dir, "mint-poster-token.sh"), '#!/usr/bin/env bash\n[ "${MINT_LABEL:-}" = helper ] && exit 1\necho tok\n');
    // The stand-in sweeper reports what it was handed.
    writeFileSync(join(dir, "prod-lifecycle-sweeper.mjs"), 'console.log(`SWEEPER helper=[${process.env.HELPER_ACCESS_TOKEN}] phase=${process.env.SWEEP_PHASE}`);\n');
    chmodSync(join(dir, "mint-poster-token.sh"), 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const env = { POSTER_ACCESS_TOKEN: "p", HELPER_EMAIL: "h@example.com", HELPER_PASSWORD: "pw" };

  it("teardown: exit 1 and the sweeper never runs", async () => {
    const r = await run("bash", [join(dir, "sweep-both-seats.sh")], { ...env, SWEEP_PHASE: "teardown" });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/::error title=Teardown sweep could not hold the helper seat/);
    expect(r.out).not.toMatch(/SWEEPER/);
  });

  it("pre: degrades to the poster seat and says so, so the suite still runs", async () => {
    const r = await run("bash", [join(dir, "sweep-both-seats.sh")], { ...env, SWEEP_PHASE: "pre" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/::warning title=Sweep holds only the poster seat/);
    expect(r.out).toMatch(/SWEEPER helper=\[\] phase=pre/);
  });

  it("refuses to run without a phase", async () => {
    const r = await run("bash", [join(dir, "sweep-both-seats.sh")], env);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).not.toMatch(/SWEEPER/);
  });
});
