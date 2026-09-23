import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CLASS CHECK — Q107 (docs/OPEN.md). `saveBusinessName` on the Credentials
 * tab (src/components/profile/CredentialsTab.tsx) sent
 * `profiles.update({ business_name })` and only checked `error`. An UPDATE
 * that matches ZERO rows (stale `userId`, RLS) is not an error in Postgres —
 * PostgREST answers `{ data: null, error: null }` — so the toast said
 * "Saved." for a write that never touched a row.
 *
 * `business_name` is not itself money/moderation/verification, so it is
 * deliberately outside mutationRowGuard.test.ts's RISK_COLUMNS (that guard
 * would need a false-positive-prone new column just for this one call site).
 * This is the narrower, per-call-site guard CLAUDE.md's zero-row-write rule
 * asks for instead: `saveBusinessName` must chain `.select(...)` and unwrap
 * the result through `unwrapMutationRow` (src/lib/mutationResult.ts), the
 * pattern the rest of this file uses since 2a1964cc5.
 *
 * @mutate src/components/profile/CredentialsTab.tsx | await supabase.from("profiles").update({ business_name: next }).eq("user_id", userId).select(SELECT_COLS), | await supabase.from("profiles").update({ business_name: next }).eq("user_id", userId),
 */

const REPO = resolve(__dirname, "..", "..");
const FILE = resolve(REPO, "src/components/profile/CredentialsTab.tsx");

/** The body of `const saveBusinessName = async () => { … };`. */
function saveBusinessNameBody(src: string): string {
  const start = src.indexOf("const saveBusinessName = async () => {");
  if (start === -1) throw new Error("saveBusinessName not found in CredentialsTab.tsx — did it move or get renamed?");
  const braceOpen = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(braceOpen, i + 1);
    }
  }
  throw new Error("saveBusinessName body never closes — unbalanced braces");
}

describe("saveBusinessName observes its own row count (Q107)", () => {
  const src = readFileSync(FILE, "utf8");

  it("the function still exists (inventory is not vacuous)", () => {
    expect(src).toContain("const saveBusinessName = async () => {");
  });

  it("chains .select(...) on the profiles.business_name write and unwraps it with unwrapMutationRow", () => {
    const body = saveBusinessNameBody(src);

    const updatesBusinessName = /\.from\(\s*["']profiles["']\s*\)\s*\.update\(\s*\{[^}]*business_name/.test(body);
    expect(updatesBusinessName, "saveBusinessName no longer writes profiles.business_name directly — re-point this guard").toBe(true);

    const chainsSelect = /\.update\(\s*\{[^}]*business_name[^}]*\}\s*\)[\s\S]*?\.select\(/.test(body);
    expect(
      chainsSelect,
      "saveBusinessName's profiles.update({ business_name }) has no .select() in its chain — a zero-row " +
        "write (stale userId, RLS) returns { data: null, error: null } and the caller cannot tell it " +
        "matched no row. Add .select(SELECT_COLS).",
    ).toBe(true);

    const usesUnwrapMutationRow = /unwrapMutationRow[\s\S]*business_name|business_name[\s\S]*unwrapMutationRow/.test(
      body,
    );
    expect(
      usesUnwrapMutationRow,
      "saveBusinessName's write is not passed through unwrapMutationRow() (src/lib/mutationResult.ts) — " +
        "a bare { error } check lets a zero-row write reach the success path and show \"Saved.\"",
    ).toBe(true);
  });

  it("does not fall back to a bare `const { error } =` check on this write (the exact regressed shape)", () => {
    const body = saveBusinessNameBody(src);
    expect(
      /const\s*\{\s*error\s*\}\s*=\s*await\s+supabase[\s\S]*?business_name/.test(body),
      "saveBusinessName reverted to checking only { error } on the business_name write — that is the " +
        "exact Q107 regression: a zero-row match returns error === null and still shows \"Saved.\"",
    ).toBe(false);
  });
});
