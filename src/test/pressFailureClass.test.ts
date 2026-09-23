/**
 * Q128 (docs/OPEN.md): press-every-control run 35837735324 counted failures
 * that were not the pressed control's (or hid the run's result). One case per
 * class, each built from the run's own measured line, and each holding the
 * rule NARROW: the neighbouring shape that must stay a failure stays one.
 * Rules live in scripts/audit/pressFailureClass.mjs; the wiring into the
 * harness is pinned at the end.
 *
 * @mutate scripts/audit/pressFailureClass.mjs | export const TELEMETRY_HOST_RX = /(^\|\.)(sentry\.io\|posthog\.com)$/i; | export const TELEMETRY_HOST_RX = /^$/;
 * @mutate scripts/audit/pressFailureClass.mjs | if (owner === "vendor" && Number(status) >= 500) return "vendor-5xx"; | if (owner === "vendor") return "vendor-5xx";
 * @mutate scripts/audit/pressFailureClass.mjs | return text.includes(FOREIGN_FIXTURE_MARKER) && !text.includes(OWN_FIXTURE_MARKER); | return text.includes(FOREIGN_FIXTURE_MARKER);
 * @mutate scripts/audit/pressFailureClass.mjs | return exp === null \|\| exp > now; | return true;
 * @mutate scripts/audit/pressFailureClass.mjs | return now - startedAt >= budgetMs; | return false;
 * @mutate scripts/audit/press-every-control.mjs | if (cls !== "app") { nonAppFails.push(`${cls}: ${s} | if (false) { nonAppFails.push(`${cls}: ${s}
 * @mutate scripts/audit/press-every-control.mjs | failedPresses > 0 \|\| undocumented > 0 \|\| sessionDeaths.length > 0 \|\| totalFound === 0 \|\| uncoveredPersonas.length > 0 \|\| notReached.length > 0 | failedPresses > 0 \|\| undocumented > 0 \|\| sessionDeaths.length > 0 \|\| totalFound === 0 \|\| uncoveredPersonas.length > 0
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cls from "../../scripts/audit/pressFailureClass.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SENTRY = "https://o4511265714601984.ingest.us.sentry.io/api/4511270677250048/envelope/";
const jwt = (expSec: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url")}.y`;

describe("Q128 class 1: our own telemetry refused is not a control failure", () => {
  it("429 POST envelope/ (Sentry) and its console mirror are telemetry", () => {
    expect(cls.classifyFailedResponse({ url: SENTRY, status: 429 })).toBe("telemetry");
    expect(cls.classifyConsoleError({
      text: "Failed to load resource: the server responded with a status of 429 ()",
      locationUrl: SENTRY,
    })).toBe("telemetry");
    expect(cls.classifyFailedResponse({ url: "https://us.i.posthog.com/e/", status: 429 })).toBe("telemetry");
  });
  it("the same 429 from our own backend is still the app's", () => {
    expect(cls.classifyFailedResponse({ url: "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/create-payment", status: 429 })).toBe("app");
    expect(cls.classifyConsoleError({
      text: "Failed to load resource: the server responded with a status of 429 ()",
      locationUrl: "https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/jobs",
    })).toBe("app");
    // a lookalike host is not telemetry
    expect(cls.classifyFailedResponse({ url: "https://sentry.io.evil.example/envelope/", status: 429 })).toBe("app");
  });
});

describe("Q128 class 2: a known vendor's 5xx is not a control failure", () => {
  it("500 GET apay-us.amazon.com/amazonpayMerchantId (Stripe's sheet) is vendor-5xx", () => {
    expect(cls.classifyFailedResponse({ url: "https://apay-us.amazon.com/amazonpayMerchantId", status: 500 })).toBe("vendor-5xx");
    expect(cls.classifyFailedResponse({ url: "https://api.stripe.com/v1/elements/sessions", status: 503 })).toBe("vendor-5xx");
  });
  it("a vendor 4xx, an unknown host's 5xx and a status-less DNS failure stay the app's", () => {
    expect(cls.classifyFailedResponse({ url: "https://api.stripe.com/v1/payment_intents", status: 402 })).toBe("app");
    expect(cls.classifyFailedResponse({ url: "https://cdn.example.org/photo.jpg", status: 500 })).toBe("app");
    // /jobs/:id "Photos": net::ERR_NAME_NOT_RESOLVED is a broken reference, not a vendor outage
    expect(cls.classifyConsoleError({ text: "Failed to load resource: net::ERR_NAME_NOT_RESOLVED", locationUrl: "https://apay-us.amazon.com/x" })).toBe("app");
    expect(cls.classifyConsoleError({ text: "TypeError: x is undefined", locationUrl: SENTRY })).toBe("app");
  });
});

describe("Q128 class 3: another sweep's live fixture moved on between loads", () => {
  const chain = ["[E2E DO NOT ACCEPT] J c78urb Completed Released Cleaning 100", "Refund Poster"];
  it("a missing control reached through an [E2E DO NOT ACCEPT] row is a documented skip", () => {
    expect(cls.isForeignSweepFixture(chain)).toBe(true);
    expect(harness.missingControlDisposition({ scope: "overlay", onSameScreen: true, consumed: false, foreignFixture: true }))
      .toBe(cls.FOREIGN_FIXTURE_SKIP);
    expect(harness.DOCUMENTED_SKIPS.has(cls.FOREIGN_FIXTURE_SKIP)).toBe(true);
  });
  it("this harness's own fixture, or a plain row, is still a failure", () => {
    expect(cls.isForeignSweepFixture(["[PRESS DO NOT ACCEPT] press-every-control 358 [E2E DO NOT ACCEPT]", "Refund Poster"])).toBe(false);
    expect(cls.isForeignSweepFixture(["Deep clean — Baton Rouge", "Refund Poster"])).toBe(false);
    expect(harness.missingControlDisposition({ scope: "page", onSameScreen: true, consumed: false, foreignFixture: false })).toBeNull();
  });
});

describe("Q128 class 4: NOT CLICKABLE says why", () => {
  it("lifts the reason out of the call log, the last one winning", () => {
    const log = `locator.click: Timeout 16000ms exceeded. Call log: - waiting for locator('body > div') - locator resolved to <button type="button">Done</button> - attempting click action - waiting for element to be visible, enabled and stable - element is not stable - retrying click action - <div class="fixed inset-0 z-50"></div> intercepts pointer events`;
    expect(cls.clickFailureReason(log)).toMatch(/^covered: <div class="fixed inset-0 z-50"><\/div> intercepts pointer events/);
    expect(cls.clickFailureReason("... - element is not visible - retrying")).toBe("not visible");
    expect(cls.clickFailureReason("Timeout 16000ms exceeded.")).toBe("reason not in the call log");
  });
});

describe("Q128 class 5: routine token expiry is not a session death", () => {
  const now = 1_790_000_000_000;
  it("a token within the refresh margin is refreshed before the row", () => {
    expect(cls.tokenNeedsRefresh(jwt(now / 1000 + 10 * 60), now)).toBe(true);
    expect(cls.tokenNeedsRefresh(jwt(now / 1000 + 50 * 60), now)).toBe(false);
    expect(cls.tokenNeedsRefresh("not-a-jwt", now)).toBe(false);
  });
  it("a refusal of an expired token is not a death; a refusal of a live one is", () => {
    expect(cls.refusalIsDeath(jwt(now / 1000 - 60), now)).toBe(false);
    expect(cls.refusalIsDeath(jwt(now / 1000 + 600), now)).toBe(true);
    expect(cls.refusalIsDeath("not-a-jwt", now)).toBe(true);
  });
});

describe("Q128 class 6: the sweep stops inside its own budget instead of being cancelled", () => {
  it("over budget only once the budget is spent; no budget means no limit", () => {
    expect(cls.overTimeBudget({ startedAt: 0, now: 135 * 60_000, budgetMs: 135 * 60_000 })).toBe(true);
    expect(cls.overTimeBudget({ startedAt: 0, now: 134 * 60_000, budgetMs: 135 * 60_000 })).toBe(false);
    expect(cls.overTimeBudget({ startedAt: 0, now: 10 ** 12, budgetMs: 0 })).toBe(false);
  });
  it("the workflow's budget is below its job timeout", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/press-every-control.yml"), "utf8");
    const budget = Number(/TIME_BUDGET_MIN:\s*"(\d+)"/.exec(wf)?.[1]);
    const timeout = Number(/timeout-minutes:\s*(\d+)\n\s*strategy:/.exec(wf)?.[1] ?? /Press every control \(shard[\s\S]*?timeout-minutes:\s*(\d+)/.exec(wf)?.[1]);
    expect(budget).toBeGreaterThan(60);
    expect(timeout).toBeGreaterThan(budget + 10);
  });
});

describe("Q128: the harness uses every rule (wiring)", () => {
  const press = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
  it("responses and console mirrors are classified before they reach netFails / consoleErrors", () => {
    expect(press).toContain("const cls = classifyFailedResponse({ url: r.url(), status: s });");
    expect(press).toContain("const cls = classifyConsoleError({ text: t, locationUrl: m.location()?.url });");
    expect(press).toMatch(/if \(cls !== "app"\) \{ nonAppFails\.push\([^\n]*\); return; \}\s*netFails\.push\(line\);/);
  });
  it("both missing-control sites pass foreignFixture; NOT CLICKABLE carries its reason", () => {
    expect(press.split("foreignFixture: isForeignSweepFixture(entry.chain),").length - 1).toBe(2);
    expect(press).toContain("NOT CLICKABLE (${clickFailureReason(last.message)}): ");
  });
  it("tokens are refreshed before a row and before clean-up; expiry refusals are not deaths", () => {
    expect(press).toContain("if (tokenNeedsRefresh(s.accessToken)) { const fresh = await refresh(); if (fresh) return fresh; }");
    expect(press).toContain("if (!refusalIsDeath(s.accessToken)) { const fresh = await refresh(); if (fresh) return fresh; }");
    expect(press).toMatch(/for \(const p of Object\.keys\(sessions\)\) \{ noticedOn = "clean-up"; await ensureLiveSession\(p\); \}\s*const cleaned = await cleanup/);
  });
  it("rows not reached are reported and fail the run", () => {
    expect(press.split("overTimeBudget({ startedAt: runStart, budgetMs: TIME_BUDGET_MS })").length - 1).toBe(2);
    expect(press).toContain("uncoveredPersonas.length > 0 || notReached.length > 0");
  });
  it("inventory: the run's measured classes are all covered (floor)", () => {
    const classes = ["telemetry", "vendor-5xx", cls.FOREIGN_FIXTURE_SKIP, "clickFailureReason", "tokenNeedsRefresh", "overTimeBudget"];
    expect(classes.length).toBeGreaterThan(5);
  });
});
