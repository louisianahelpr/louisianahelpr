/**
 * prod-audit reads seeded fixtures that OTHER workflows mutate on the same
 * accounts. On 2026-09-24 poster-e2e had 0 of 2 seeded saved Helprs (the
 * 03-account journey unsaved the seeded pair as its "clean start" and never put
 * it back), so prod-audit's saved-helprs surfaces timed out on an empty tab at
 * 320/375/1440 and the messy-input sweep found "no text-like field".
 *
 * Two halves of the class:
 *  - prod-audit repairs the seed (idempotent `prod-seed.mjs --apply`) BEFORE
 *    its first playwright run, so any drifted fixture is restored, not timed out on;
 *  - a journey that removes a pre-existing save restores it.
 *
 * @mutate .github/workflows/prod-audit.yml | run: node scripts/audit/prod-seed.mjs --apply || | run: echo skipped ||
 * @mutate e2e/journeys/03-account.spec.ts | const restored = favoriteWrite("POST"); | const restored = Promise.resolve();
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("prod-audit fixtures stay seeded", () => {
  it("prod-audit runs prod-seed --apply before its first playwright run", () => {
    const wf = read(".github/workflows/prod-audit.yml");
    const seed = wf.search(/^\s*run: node scripts\/audit\/prod-seed\.mjs --apply\b/m);
    const pw = wf.indexOf("npx playwright test --project=prod-audit");
    expect(seed, "no prod-seed --apply step in prod-audit.yml").toBeGreaterThan(-1);
    expect(pw).toBeGreaterThan(-1);
    expect(seed).toBeLessThan(pw);
  });

  it("the account journey restores a Helpr save it found already there", () => {
    const spec = read("e2e/journeys/03-account.spec.ts");
    const step = spec.slice(spec.indexOf("poster saves the Helpr"), spec.indexOf("poster saves a search"));
    expect(step).toMatch(/const wasSaved = /);
    expect(step).toMatch(/if \(wasSaved\) \{\n\s*const restored = favoriteWrite\("POST"\)/);
  });
});
