/**
 * Errors reach Sentry (2026-11-17: no accepted Sentry event after 2026-11-14 23:37 UTC while prod error_logs kept
 * logging real client errors). Three ways the client can go silent, each pinned here:
 *
 * 1. The init path is skipped. report() fans out to captureException(), which returned without a trace whenever
 *    main.tsx's first-interaction gate had not yet run initSentry() (every cold-launch error), and main.tsx's
 *    analytics bootstrap waited on posthog and Sentry in one Promise.all, so a blocked posthog chunk left Sentry
 *    uninitialized for the whole page. captureException() now initializes first; main.tsx starts Sentry alone.
 * 2. The DSN is missing or malformed: initSentry() returns early on an empty DSN.
 * 3. The CSP blocks the ingest host: both policies (vercel.json for the web, the index.html meta for the native
 *    shells) must allow the DSN's host in connect-src, or every envelope is refused by the browser.
 *
 * @mutate src/lib/sentry.ts |   if (!initialized) initSentry();\n  if (!initialized) return; |   if (!initialized) return;
 * @mutate src/main.tsx |         sentryAlone.initSentry(); |         void sentryAlone;
 * @mutate src/lib/sentry.ts |   "https://d3221775aacee16ad5837d44f0cbaa33@o4511265714601984.ingest.us.sentry.io/4511270677250048"; |   "";
 * @mutate vercel.json | https://*.ingest.sentry.io https://*.sentry.io | https://*.ingest.sentry.example
 * @mutate index.html | https://*.ingest.us.sentry.io https://*.sentry.io | https://*.ingest.us.sentry.example
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const initMock = vi.fn();
const captureMock = vi.fn();
vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  addIntegration: vi.fn(),
  getReplay: () => undefined,
  captureException: (...args: unknown[]) => captureMock(...args),
  breadcrumbsIntegration: () => ({}),
  globalHandlersIntegration: () => ({}),
  linkedErrorsIntegration: () => ({}),
  dedupeIntegration: () => ({}),
  httpContextIntegration: () => ({}),
  replayIntegration: () => ({}),
}));

import { captureException, SENTRY_DSN } from "@/lib/sentry";

/** CSP3 host-source matching for an https source like `https://*.sentry.io` against a host. */
function sourceAllows(source: string, host: string): boolean {
  const m = /^https:\/\/([^/:]+)$/.exec(source);
  if (!m) return false;
  const pattern = m[1];
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return host === pattern;
}

function connectSrc(policy: string): string[] {
  const directive = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src "));
  expect(directive, "connect-src directive").toBeTruthy();
  return directive!.split(/\s+/).slice(1);
}

function vercelPolicies(): string[] {
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    headers?: { headers?: { key: string; value: string }[] }[];
  };
  return (cfg.headers ?? [])
    .flatMap((h) => h.headers ?? [])
    .filter((h) => h.key.toLowerCase() === "content-security-policy")
    .map((h) => h.value);
}

function metaPolicies(): string[] {
  const html = readFileSync("index.html", "utf8");
  return [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/gi)].map((m) => m[1]);
}

describe("errors reach Sentry", () => {
  it("an error reported before the boot gate ran initSentry() still initializes and reaches Sentry", () => {
    const err = new Error("cold-launch failure");
    captureException(err, { where: "boot" }, "error");
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toBe(err);
  });

  it("main.tsx starts Sentry on its own, never behind the posthog import", () => {
    const main = blankComments(readFileSync("src/main.tsx", "utf8"));
    const alone = /const sentryAlone = await backgroundImport\(\(\) => import\("\.\/lib\/sentry"\), "sentry"\);\s*sentryAlone\.initSentry\(\);/;
    expect(main).toMatch(alone);
    // The standalone block awaits nothing else before initSentry().
    const block = main.slice(main.indexOf("const sentryAlone"), main.indexOf("sentryAlone.initSentry();"));
    expect(block).not.toMatch(/posthog|Promise\.all/);
  });

  it("the DSN is a Sentry ingest DSN", () => {
    expect(SENTRY_DSN).toMatch(/^https:\/\/[a-f0-9]{32}@o\d+\.ingest\.(?:us\.|de\.)?sentry\.io\/\d+$/);
  });

  it("every CSP (web headers and the native meta) lets the DSN's host through connect-src", () => {
    const host = new URL(SENTRY_DSN).hostname;
    const policies = [...vercelPolicies(), ...metaPolicies()];
    // Inventory floor: one header policy and one meta policy today.
    expect(vercelPolicies().length).toBeGreaterThan(0);
    expect(metaPolicies().length).toBeGreaterThan(0);
    for (const policy of policies) {
      const sources = connectSrc(policy);
      expect(sources.some((s) => sourceAllows(s, host)), `connect-src allows ${host}`).toBe(true);
    }
  });
});
