import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Legal document versions live in TWO places that Deno + Vite can't share
// at build time:
//   1. src/pages/legal/legalSections.ts       (LAST_UPDATED map — frontend)
//   2. supabase/functions/_shared/legalVersions.ts  (Deno — edge functions)
//
// This test loads both files as text and asserts the version strings agree.
// Bumping a policy is a deliberate two-place edit; drift here is a bug.

const REPO_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_PATH = path.join(REPO_ROOT, "src/pages/legal/legalSections.ts");
const EDGE_PATH = path.join(REPO_ROOT, "supabase/functions/_shared/legalVersions.ts");

function extract(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Failed to extract from source with ${pattern}`);
  return match[1];
}

const edgeSrcForKeys = readFileSync(EDGE_PATH, "utf8");
const lastUpdatedBlockForKeys = extract(
  readFileSync(FRONTEND_PATH, "utf8"),
  /LAST_UPDATED:\s*Record<TabKey,\s*string>\s*=\s*\{([\s\S]*?)\}/,
);

describe("legal versions — frontend + edge parity", () => {
  const frontendSrc = readFileSync(FRONTEND_PATH, "utf8");
  const edgeSrc = readFileSync(EDGE_PATH, "utf8");

  // Narrow to the LAST_UPDATED block first — the file has multiple
  // Record<TabKey, string> maps and `terms:`/`privacy:`/`community:` appear
  // in each, so we can't just match the first occurrence.
  const lastUpdatedBlock = extract(
    frontendSrc,
    /LAST_UPDATED:\s*Record<TabKey,\s*string>\s*=\s*\{([\s\S]*?)\}/,
  );
  const frontendTerms = extract(lastUpdatedBlock, /terms:\s*"([^"]+)"/);
  const frontendPrivacy = extract(lastUpdatedBlock, /privacy:\s*"([^"]+)"/);
  const frontendCommunity = extract(lastUpdatedBlock, /community:\s*"([^"]+)"/);

  const edgeTerms = extract(edgeSrc, /LEGAL_TERMS_VERSION\s*=\s*"([^"]+)"/);
  const edgePrivacy = extract(edgeSrc, /LEGAL_PRIVACY_VERSION\s*=\s*"([^"]+)"/);
  const edgeCommunity = extract(edgeSrc, /LEGAL_COMMUNITY_VERSION\s*=\s*"([^"]+)"/);

  it("Terms version matches on both sides", () => {
    expect(edgeTerms).toBe(frontendTerms);
  });

  it("Privacy version matches on both sides", () => {
    expect(edgePrivacy).toBe(frontendPrivacy);
  });

  it("Community rules version matches on both sides", () => {
    expect(edgeCommunity).toBe(frontendCommunity);
  });
});

/*
 * THE KEY SET, not three hand-picked keys.
 *
 * The three cases above name `terms`, `privacy` and `community` literally, so
 * a FOURTH legal document — the shape of this file's own risk — would be added
 * to LAST_UPDATED, rendered with a version in its PolicyFooter, and have no
 * edge constant at all, with this file green. The edge side is what drives
 * re-consent: a document whose version the edge runtime cannot see can never
 * prompt anyone to re-accept it.
 *
 * So derive the keys from LAST_UPDATED and require each to have a matching
 * LEGAL_<KEY>_VERSION.
 */
describe("every legal document in LAST_UPDATED has an edge counterpart", () => {
  const keys = [...lastUpdatedBlockForKeys.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => ({
    key: m[1],
    version: m[2],
  }));

  it("found the map (an empty key set would pass every case below vacuously)", () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(keys.map((k) => k.key)).toContain("terms");
  });

  it.each(keys)("'$key' is mirrored in the edge constants at the same version", ({ key, version }) => {
    const constant = `LEGAL_${key.toUpperCase()}_VERSION`;
    const found = new RegExp(`${constant}\\s*=\\s*"([^"]+)"`).exec(edgeSrcForKeys);
    expect(
      found,
      `${constant} does not exist in supabase/functions/_shared/legalVersions.ts. ` +
        `The edge side drives re-consent — a document the edge runtime cannot see a ` +
        `version for can never prompt anyone to re-accept it.`,
    ).not.toBeNull();
    expect(found?.[1], `${constant} has drifted from LAST_UPDATED.${key}`).toBe(version);
  });
});

// Drift between the two copies is the entire point of the file: the front end
// would render one date while the edge re-consent gate compared against
// another, so a bumped policy would silently stop prompting anyone.
// @mutate supabase/functions/_shared/legalVersions.ts | export const LEGAL_TERMS_VERSION = "Jun 2026"; | export const LEGAL_TERMS_VERSION = "Jul 2026";
