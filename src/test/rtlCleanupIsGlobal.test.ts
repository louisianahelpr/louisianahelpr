/**
 * Every render is unmounted after every test, whatever way the test file
 * loaded Testing Library. RTL registers its auto-cleanup only on a static
 * import; helperDisputeCopy.test.tsx used `await import("@testing-library/react")`,
 * so its renders stayed mounted, a React Query update landed after jsdom
 * teardown, and the whole Vitest shard failed with "The `document` global was
 * defined when React was initialized, but is not defined anymore"
 * (CI run 36880636360, red twice on PR #2006).
 *
 * The class fix is one `afterEach(() => cleanup())` in the setup file every
 * test loads. This holds that it stays there.
 *
 * @mutate src/test/setup.ts | afterEach(() => cleanup()); | void cleanup;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const setup = readFileSync(resolve(__dirname, "setup.ts"), "utf8")
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");

describe("RTL cleanup runs after every test in every file", () => {
  it("setup.ts imports cleanup from @testing-library/react", () => {
    expect(setup).toMatch(/import\s*\{[^}]*\bcleanup\b[^}]*\}\s*from\s*"@testing-library\/react"/);
  });

  it("setup.ts registers it in a top-level afterEach", () => {
    expect(setup).toMatch(/^afterEach\(\(\)\s*=>\s*cleanup\(\)\);/m);
  });
});
