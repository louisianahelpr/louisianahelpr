/**
 * Q328: every dynamic import() in src/main.tsx is a boot-time background load
 * (session teardown, analytics, toast dismiss) that nothing on screen waits
 * on, so each one goes through backgroundImport(). A raw import() failing
 * while offline at the first interaction reached vite:preloadError once the
 * network returned; recovery read it as a stale deploy and hard-reloaded the
 * page, losing the open thread and its typed message (slow-network run
 * 35931277278, `message · drop`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

// comments mention import() in prose; only code counts (string bodies kept)
const src = blankComments(readFileSync(resolve(__dirname, "../main.tsx"), "utf8"));

// @mutate src/main.tsx | backgroundImport(() => import("./lib/posthog"), "posthog") | import("./lib/posthog")
// @mutate src/main.tsx | backgroundImport(() => import("sonner"), "sonner") | import("sonner")
describe("boot imports never trigger the stale-chunk reload", () => {
  it("finds the boot imports", () => {
    expect((src.match(/\bimport\(/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it("every dynamic import in main.tsx is wrapped in backgroundImport", () => {
    const raw = [...src.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)]
      .filter((m) => !/backgroundImport\(\s*\(\)\s*=>\s*$/.test(src.slice(Math.max(0, m.index! - 40), m.index)))
      .map((m) => m[1]);
    expect(raw, "raw import() in main.tsx: route it through backgroundImport (Q328)").toEqual([]);
  });
});
