/**
 * Q845 (found in Q655, 2026-09-28): a local Playwright run reuses whatever
 * `vite preview` holds the port (`reuseExistingServer: !CI`), and the shared
 * checkout's preview was a 2026-09-24 build while prod kept receiving uploads
 * made by that old code. e2e/globalSetup.ts now compares the served
 * index.html's `build-commit` stamp (vite.config.ts) with this checkout's HEAD
 * and refuses a mismatch with the command that frees the port.
 *
 * @mutate e2e/previewBuildCheck.ts |   if (served && head.startsWith(served.slice(0, 7)) && (served.length < 40 \|\| served === head)) return null; |   return null;
 * @mutate e2e/globalSetup.ts |   await assertPreviewIsThisCheckout(LOCAL_BASE_URL); |
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { previewMismatch, servedBuildCommit } from "../../e2e/previewBuildCheck";

const ROOT = join(__dirname, "..", "..");
const HEAD = "a146d196b1234567890abcdef1234567890abcde";
const page = (sha: string) => `<!doctype html><head>\n  <meta name="build-commit" content="${sha}">\n    <meta name="build-time" content="x"></head>`;

describe("a reused local preview must be this checkout's build (Q845)", () => {
  it("reads the build stamp vite.config.ts writes", () => {
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain('<meta name="build-commit" content="${appCommitFull}">');
    expect(servedBuildCommit(page(HEAD))).toBe(HEAD);
  });

  it("refuses another commit's build and an unstamped page, naming the port to free", () => {
    const old = previewMismatch(page("d00b1c348aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), HEAD, "http://127.0.0.1:4173");
    expect(old).toMatch(/serves commit d00b1c348/);
    expect(old).toMatch(/kill \$\(lsof -ti:4173\)/);
    expect(previewMismatch("<html></html>", HEAD, "http://127.0.0.1:4173")).toMatch(/no build-commit stamp/);
  });

  it("accepts this checkout's own build", () => {
    expect(previewMismatch(page(HEAD), HEAD, "http://127.0.0.1:4173")).toBeNull();
  });

  it("runs before every local Playwright run, ahead of the browser lock", () => {
    const setup = readFileSync(join(ROOT, "e2e", "globalSetup.ts"), "utf8");
    const check = setup.indexOf("await assertPreviewIsThisCheckout(LOCAL_BASE_URL);");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(setup.indexOf("await acquireBrowserLock();"));
    expect(readFileSync(join(ROOT, "playwright.config.ts"), "utf8")).toMatch(/globalSetup:\s*"\.\/e2e\/globalSetup\.ts"/);
  });
});
