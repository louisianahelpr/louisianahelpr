// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://louisianahelpr.com/support"}
/**
 * A test runner's browser never pages as a person's error screen.
 *
 * Ledger 3a8fb52e: a HeadlessChrome (Playwright) guest booted a stale deploy
 * on 2026-09-23, index.html's watchdog showed "Helpr couldn't load.", and the
 * user-error-screen alert counted it as a real guest. The client now tags
 * every error_logs row from a WebDriver/CDP-driven browser (navigator.webdriver)
 * with automated: true, and the latest user_error_screen_is_real() skips it.
 */
// @mutate src/lib/errorLogger.ts | tags: isAutomatedBrowser() ? { ...(opts.tags ?? {}), automated: true } : (opts.tags ?? {}), | tags: opts.tags ?? {},
// @mutate supabase/migrations/20260924131430_user_error_screen_skips_automated.sql |      AND coalesce(p_tags ->> 'automated', '') <> 'true' |      AND true
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const posted = vi.hoisted(() => [] as Array<{ tags: Record<string, unknown> }>);
vi.mock("@/lib/restInsert", () => ({
  postRows: async (_t: string, _c: readonly string[], rowsFor: (asUser: boolean) => unknown[]) => {
    posted.push(...(rowsFor(false) as Array<{ tags: Record<string, unknown> }>));
    return 201;
  },
}));

const ROOT = join(__dirname, "..", "..");

async function reportUnder(webdriver: boolean) {
  Object.defineProperty(navigator, "webdriver", { value: webdriver, configurable: true });
  vi.useFakeTimers();
  vi.resetModules();
  const { report } = await import("@/lib/errorLogger");
  report(new Error(`probe webdriver=${webdriver}`), { tags: { source: "BootWatchdog" } });
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  return posted.find((r) => String((r as unknown as { message: string }).message).includes(`webdriver=${webdriver}`));
}

afterEach(() => {
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
});

describe("error_logs rows from automated browsers are tagged and skipped", () => {
  it("tags a row from a WebDriver-driven browser, and only that one", async () => {
    const auto = await reportUnder(true);
    const person = await reportUnder(false);
    expect(auto, "no row posted under webdriver").toBeDefined();
    expect(person, "no row posted for a person's browser").toBeDefined();
    expect(auto!.tags).toMatchObject({ source: "BootWatchdog", automated: true });
    expect(person!.tags).not.toHaveProperty("automated");
  });

  it("the latest user_error_screen_is_real() skips automated rows", () => {
    const dir = join(ROOT, "supabase/migrations");
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => /FUNCTION public\.user_error_screen_is_real\(/.test(readFileSync(join(dir, f), "utf8")));
    expect(defs.length).toBeGreaterThan(1);
    const latest = readFileSync(join(dir, defs[defs.length - 1]), "utf8");
    expect(latest).toMatch(/coalesce\(p_tags ->> 'automated', ''\) <> 'true'/);
  });
});
