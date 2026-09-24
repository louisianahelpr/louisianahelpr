/**
 * Q367 (owner, 2026-09-24): /user/<id> of someone you blocked shows "You
 * blocked this person" + Unblock and hides every detail of theirs.
 *
 * Before this, the page read no block at all: a blocked person's name, photo,
 * reviews and jobs rendered exactly as for anyone else. The checks below pin
 * the three things that make the hide real: the query is the blocker side
 * (me → them), the blocked state returns BEFORE any profile detail renders,
 * and a pending or failed block check shows loading/error, never the details.
 */
// @mutate src/pages/user/UserProfile.tsx | if (blockedByMe \|\| (blockCheckPending && blockError)) { | if (false) {
// @mutate src/pages/user/UserProfile.tsx | if (loading \|\| blockCheckPending) { | if (loading) {
// @mutate src/pages/user/UserProfile.tsx | .eq("blocker_id", currentUserId!) | .eq("blocked_id", currentUserId!)
// @mutate src/pages/user/UserProfile.tsx | const ok = await unblockUser(currentUserId, userId); | const ok = true;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "pages", "user", "UserProfile.tsx"), "utf8");

describe("a profile you blocked is hidden behind an Unblock screen", () => {
  it("reads the block from the blocker side: me → them", () => {
    expect(src).toMatch(/\.from\("user_blocks"\)\s*\.select\("id"\)\s*\.eq\("blocker_id", currentUserId!\)\s*\.eq\("blocked_id", userId!\)/);
  });

  it("returns the blocked state before the loading, not-found and detail renders", () => {
    const blocked = src.indexOf("if (blockedByMe || (blockCheckPending && blockError)) {");
    expect(blocked).toBeGreaterThan(0);
    const firstDetail = Math.min(
      ...["if (loading", "if (isError)", "if (!profile)", "<ProfileHeaderCard"].map((m) => {
        const i = src.indexOf(m);
        expect(i, `${m} not found`).toBeGreaterThan(0);
        return i;
      }),
    );
    expect(blocked).toBeLessThan(firstDetail);
    expect(src).toContain('title="You blocked this person"');
  });

  it("fails closed: an unresolved block check shows the skeleton, not the details", () => {
    expect(src).toContain("if (loading || blockCheckPending) {");
  });

  it("Unblock lifts the block through the checked helper and re-reads it", () => {
    const h = src.slice(src.indexOf("const handleUnblock"), src.indexOf("const handleUnblock") + 600);
    expect(h).toContain("const ok = await unblockUser(currentUserId, userId);");
    expect(h).toContain("if (!ok)");
    expect(h).toContain("invalidateQueries({ queryKey: blockedByMeKey })");
  });
});
