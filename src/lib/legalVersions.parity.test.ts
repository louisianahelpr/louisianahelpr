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
