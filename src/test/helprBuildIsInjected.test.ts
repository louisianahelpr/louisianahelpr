/**
 * NB-020: window.HELPR_BUILD was the string literal "2026-05-04-editorial-brand-polish",
 * so every push_tokens.app_version row named the same fake build whatever the
 * device ran. It must come from the build-time define (commit + build time).
 *
 * @mutate src/main.tsx |   typeof __APP_COMMIT__ === "string" ? `${__APP_COMMIT__}@${__APP_BUILT_AT__}` : "unknown"; // NB-020 build-injected |   "2026-09-24-literal"; // NB-020 build-injected
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

describe("HELPR_BUILD comes from the build, not a literal (NB-020)", () => {
  it("main.tsx assigns HELPR_BUILD from __APP_COMMIT__", () => {
    const src = readFileSync(resolve(ROOT, "src/main.tsx"), "utf8");
    const assign = src.match(/window\.HELPR_BUILD\s*=\s*([^;]+);/);
    expect(assign, "no HELPR_BUILD assignment in main.tsx").not.toBeNull();
    expect(assign![1]).toContain("__APP_COMMIT__");
    expect(assign![1]).not.toMatch(/^\s*["'`][^$]*["'`]\s*$/);
  });

  it("vite.config.ts defines the constants it reads", () => {
    const cfg = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(cfg).toMatch(/__APP_COMMIT__:\s*JSON\.stringify/);
    expect(cfg).toMatch(/__APP_BUILT_AT__:\s*JSON\.stringify/);
  });
});
