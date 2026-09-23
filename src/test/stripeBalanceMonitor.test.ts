// @mutate scripts/lib/stripeBalanceMonitor.mjs | return { status: availableCents < threshold ? "low" : "ok", | return { status: availableCents < threshold - 1 ? "low" : "ok",
// @mutate scripts/lib/stripeBalanceMonitor.mjs | return Math.max(FLOOR_CENTS, Math.ceil(up * MULTIPLIER)); | return Math.max(FLOOR_CENTS, Math.ceil(up));
// @mutate scripts/lib/stripeBalanceMonitor.mjs | export const FLOOR_CENTS = 10_000; | export const FLOOR_CENTS = 0;
// @mutate scripts/lib/stripeBalanceMonitor.mjs | if (usd.length === 0) throw new Error( | if (false) throw new Error(
// @mutate scripts/lib/stripeBalanceMonitor.mjs | if (body.livemode !== false) throw | if (false) throw
// @mutate scripts/check-stripe-balance.mjs |     process.exit(1); |     process.exit(0);
// @mutate scripts/check-stripe-balance.mjs |   if (!/^(sk\|rk)_test_/.test(key)) { |   if (false) {
// @mutate .github/workflows/quota-monitor.yml |         run: node scripts/check-stripe-balance.mjs |         run: echo skipped
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLOOR_CENTS, MULTIPLIER, WINDOW_HOURS, TOP_UP_HOW, UPCOMING_SQL,
  evaluateBalance, parseAvailableUsdCents, thresholdCents,
} from "../../scripts/lib/stripeBalanceMonitor.mjs";

/**
 * Q3 / Q145: the Stripe TEST balance ran to $0 on 2026-09-22 and scheduled
 * payouts failed with "insufficient available funds" before anything warned.
 * Pins (1) the threshold maths: alert when available < max($100, 1.5 x due in
 * 72h), (2) that an unreadable / empty / live-mode balance is UNREADABLE (a
 * red run), never "ok", (3) that a non-test key is refused before any request,
 * and (4) the CLI end to end against a stub Stripe + Management API.
 */

const ROOT = join(__dirname, "..", "..");

describe("threshold maths", () => {
  it("is max($100, 1.5 x upcoming)", () => {
    expect(FLOOR_CENTS).toBe(10_000);
    expect(MULTIPLIER).toBe(1.5);
    expect(WINDOW_HOURS).toBe(72);
    expect(thresholdCents(0)).toBe(10_000);
    expect(thresholdCents(null)).toBe(10_000);
    expect(thresholdCents(6_666)).toBe(10_000); // 1.5x = 9,999 < floor
    expect(thresholdCents(6_667)).toBe(10_001); // 1.5x = 10,000.5 -> ceil
    expect(thresholdCents(40_000)).toBe(60_000);
    expect(thresholdCents(-5)).toBe(10_000);
  });

  it("alerts strictly below the threshold, not at it", () => {
    expect(evaluateBalance({ availableCents: 9_999, upcomingCents: 0 }).status).toBe("low");
    expect(evaluateBalance({ availableCents: 10_000, upcomingCents: 0 }).status).toBe("ok");
    expect(evaluateBalance({ availableCents: 0, upcomingCents: null }).status).toBe("low");
    // 2026-09-23 after Q145: $428.00 available. 20 x $22 due -> $440 x 1.5 = $660 -> low.
    expect(evaluateBalance({ availableCents: 42_800, upcomingCents: 44_000 })).toEqual({ status: "low", threshold: 66_000, availableCents: 42_800, upcomingCents: 44_000 });
    expect(evaluateBalance({ availableCents: 42_800, upcomingCents: 2_200 }).status).toBe("ok");
    expect(evaluateBalance({ availableCents: 59_999, upcomingCents: 40_000 }).status).toBe("low");
    expect(evaluateBalance({ availableCents: 60_000, upcomingCents: 40_000 }).status).toBe("ok");
  });

  it("an unreadable upcoming read falls back to the $100 floor", () => {
    expect(evaluateBalance({ availableCents: 9_000, upcomingCents: null })).toMatchObject({ status: "low", threshold: 10_000, upcomingCents: null });
  });

  it("a missing balance is unreadable, never ok", () => {
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(evaluateBalance({ availableCents: v as number, upcomingCents: 0 }).status, String(v)).toBe("unreadable");
    }
  });
});

describe("parseAvailableUsdCents", () => {
  const bal = (over: object) => ({ object: "balance", livemode: false, available: [{ amount: 42_800, currency: "usd" }], pending: [], ...over });
  it("reads the USD available amount", () => {
    expect(parseAvailableUsdCents(bal({}))).toBe(42_800);
    expect(parseAvailableUsdCents(bal({ available: [{ amount: 0, currency: "usd" }] }))).toBe(0);
    expect(parseAvailableUsdCents(bal({ available: [{ amount: 5, currency: "eur" }, { amount: -300, currency: "usd" }] }))).toBe(-300);
  });
  it("refuses empty, malformed and live-mode bodies", () => {
    for (const b of [[], {}, null, "x", bal({ available: [] }), bal({ available: [{ amount: 5, currency: "eur" }] }), bal({ available: [{ amount: "abc", currency: "usd" }] })]) {
      expect(() => parseAvailableUsdCents(b), JSON.stringify(b)).toThrow();
    }
    expect(() => parseAvailableUsdCents(bal({ livemode: true }))).toThrow(/TEST mode only/);
    expect(() => parseAvailableUsdCents(bal({ livemode: undefined }))).toThrow(/TEST mode only/);
  });
});

describe("the upcoming SQL and the alert text", () => {
  it("reads payout_pending jobs due within the window, overdue included", () => {
    expect(UPCOMING_SQL).toMatch(/payment_status = 'payout_pending'/);
    expect(UPCOMING_SQL).toMatch(/payout_scheduled_at <= now\(\) \+ interval '72 hours'/);
    expect(UPCOMING_SQL).not.toMatch(/payout_scheduled_at\s*>=?\s*now\(\)/);
  });
  it("says how to top up in TEST mode (0077 card, Q145), never live", () => {
    expect(TOP_UP_HOW).toMatch(/TEST mode/);
    expect(TOP_UP_HOW).toMatch(/4000 0000 0000 0077/);
    expect(TOP_UP_HOW).toMatch(/pm_card_bypassPending/);
    expect(TOP_UP_HOW).toMatch(/Q145/);
    expect(TOP_UP_HOW).toMatch(/Never use a live key/);
  });
});

// ── CLI against stub APIs ────────────────────────────────────────────────────
type Mode = { stripe: "ok" | "low" | "fail" | "empty" | "live"; sql: "ok" | "big" | "fail" };
let mode: Mode = { stripe: "ok", sql: "ok" };
let server: Server;
let base = "";
let stripeHits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = req.url ?? "";
    if (url.startsWith("/v1/balance")) {
      stripeHits++;
      const s = mode.stripe;
      if (s === "fail") return void ((res.statusCode = 403), res.end(JSON.stringify({ error: { message: "restricted key lacks balance read" } })));
      if (s === "empty") return void res.end("[]");
      const amount = s === "low" ? 4_000 : 42_800;
      return void res.end(JSON.stringify({ object: "balance", livemode: s === "live", available: [{ amount, currency: "usd" }], pending: [{ amount: 61_648, currency: "usd" }] }));
    }
    if (url.includes("/database/query")) {
      if (mode.sql === "fail") return void ((res.statusCode = 500), res.end("{}"));
      return void res.end(JSON.stringify([mode.sql === "big" ? { jobs: 20, cents: 44_000 } : { jobs: 1, cents: 2_200 }]));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function runCli(m: Mode, key = "sk_test_stub"): Promise<{ code: number; out: string }> {
  mode = m;
  // A clean env: no real key or token may leak in and reach Stripe or prod.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp",
    STRIPE_TEST_SECRET_KEY: key, SUPABASE_ACCESS_TOKEN: "stub", SUPABASE_PROJECT_REF: "stub",
    LH_STRIPE_API_BASE: base, LH_SUPABASE_API_BASE: base,
  };
  return new Promise((done) => {
    execFile(process.execPath, ["scripts/check-stripe-balance.mjs", "--no-ledger"], { cwd: ROOT, env, timeout: 60_000 }, (err, stdout, stderr) => {
      done({ code: err ? Number((err as NodeJS.ErrnoException).code ?? 1) : 0, out: `${stdout}\n${stderr}` });
    });
  });
}

describe("check-stripe-balance.mjs (stub APIs)", () => {
  it("healthy balance, small upcoming -> exit 0, OK, no alert", async () => {
    const { code, out } = await runCli({ stripe: "ok", sql: "ok" });
    expect(code, out).toBe(0);
    expect(out).toMatch(/available: \$428\.00/);
    expect(out).toMatch(/due in 72h: 1 job\(s\), up to \$22\.00/);
    expect(out).toMatch(/threshold: \$100\.00/);
    expect(out).toMatch(/status: \*\*OK\*\*/);
    expect(out).not.toMatch(/balance low/);
  }, 60_000);

  it("upcoming x 1.5 above the balance -> LOW alert with TEST top-up text, run green", async () => {
    const { code, out } = await runCli({ stripe: "ok", sql: "big" });
    expect(code, out).toBe(0);
    expect(out).toMatch(/threshold: \$660\.00/);
    expect(out).toMatch(/status: \*\*LOW\*\*/);
    expect(out).toMatch(/::warning title=Stripe TEST balance low::Stripe TEST available balance \$428\.00 is below \$660\.00/);
    expect(out).toMatch(/4000 0000 0000 0077/);
  }, 60_000);

  it("below the $100 floor with the DB unreadable -> LOW on the floor, plus a warning", async () => {
    const { code, out } = await runCli({ stripe: "low", sql: "fail" });
    expect(code, out).toBe(0);
    expect(out).toMatch(/::warning title=Upcoming payouts unreadable::.*Management API SQL 500/);
    expect(out).toMatch(/Stripe TEST available balance \$40\.00 is below \$100\.00/);
  }, 60_000);

  it("Stripe refuses -> red, named", async () => {
    const { code, out } = await runCli({ stripe: "fail", sql: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/Stripe balance unreadable::could not read the Stripe TEST balance: Stripe GET \/v1\/balance 403/);
  }, 60_000);

  it("an EMPTY balance body -> red, not $0", async () => {
    const { code, out } = await runCli({ stripe: "empty", sql: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/did not return a balance object — refusing to report clean/);
  }, 60_000);

  it("a live-mode answer -> red", async () => {
    const { code, out } = await runCli({ stripe: "live", sql: "ok" });
    expect(code).toBe(1);
    expect(out).toMatch(/livemode=true; this monitor reads TEST mode only/);
  }, 60_000);

  it("a live key is refused BEFORE any request", async () => {
    const before = stripeHits;
    const { code, out } = await runCli({ stripe: "ok", sql: "ok" }, "sk_live_stub");
    expect(code).toBe(1);
    expect(out).toMatch(/not a test-mode key/);
    expect(stripeHits).toBe(before);
  }, 60_000);
});

describe("quota-monitor.yml wiring", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/quota-monitor.yml"), "utf8");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("runs the balance check daily with the test key and the Management API token, and its result reaches notify", () => {
    expect(code).toMatch(/-\s*cron:\s*"\d+ \d+ \* \* \*"/);
    expect(code).toMatch(/run: node scripts\/check-stripe-balance\.mjs\s*$/m);
    for (const s of ["STRIPE_TEST_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]) expect(code, s).toContain(`secrets.${s}`);
    expect(code).not.toMatch(/STRIPE_SECRET_KEY|sk_live/);
    expect(code).toMatch(/needs: \[[^\]]*stripe-balance[^\]]*\]/);
    expect(code).toMatch(/needs\['stripe-balance'\]\.result == 'success'/);
  });
});
