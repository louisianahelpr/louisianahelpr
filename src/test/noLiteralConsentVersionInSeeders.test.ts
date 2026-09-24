/**
 * CLASS CHECK (Q378, nightly-red #1783 privacy-journey, 2026-09-24): no test
 * seeder writes a consent version as a literal.
 *
 * The privacy journey seeded its account with `terms_version_accepted:
 * "Jun 2026"`. When the Terms bumped to "Sep 2026" the app put the
 * non-dismissible re-agree dialog over every screen and "Download My Data"
 * was never reachable. Two more seeders hard-coded "Sep 2026", which would
 * break the same way at the next bump. The version must come from
 * src/lib/consent.ts (LATEST_TERMS_VERSION, or latestConsentVersions() from
 * scripts/lib/acceptCurrentTerms.mjs).
 */
// @mutate e2e/privacy/privacy-requests.spec.ts | full_name: "SEED Privacy Incomplete",\n        terms_version_accepted: LATEST_TERMS_VERSION, | full_name: "SEED Privacy Incomplete",\n        terms_version_accepted: "Sep 2026",
import { describe, it, expect } from "vitest";
import { join, relative, resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const LITERAL = /(terms|privacy)_version_accepted["']?\s*[:=]\s*["'`][A-Z][a-z]{2,8} \d{4}["'`]/g;

describe("seeders take the consent version from the app", () => {
  const files = walkSource(["e2e", "scripts"].map((d) => join(REPO, d)), [".ts", ".tsx", ".mjs", ".js"]).map((f) => relative(REPO, f));

  it("the scan is real (floor)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("e2e/privacy/privacy-requests.spec.ts");
    expect(files).toContain("scripts/audit/prod-seed.mjs");
  });

  it("no literal terms_/privacy_version_accepted value in e2e/ or scripts/", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readSource(join(REPO, f));
      if (text === null) continue;
      for (const m of text.matchAll(LITERAL)) bad.push(`${f} :: ${m[0]}`);
    }
    expect(bad, "import LATEST_TERMS_VERSION (src/lib/consent.ts) or latestConsentVersions()").toEqual([]);
  });
});
