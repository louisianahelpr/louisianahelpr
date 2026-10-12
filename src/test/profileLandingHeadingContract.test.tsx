/**
 * The /profile landing's heading levels are a CONTRACT with the journeys, not a
 * styling detail (src/components/profile/profileLanding/headingContract.ts).
 *
 * e2e/journeys/03-account.spec.ts "sign back in" asserted the member's name as
 * the page's h1. The owner moved the name beside the photo on 2026-10-09
 * (59f14c55a: h1 "Profile", name = IdentityHeader's h2) and the spec failed in
 * every e2e-journeys run after (38157785191, 38181872855: "not signed back in
 * as the helper", aria snapshot `heading "E2E Helper" [level=2]`), including
 * the TestFlight release gate. Nothing that runs on a PR could see it.
 *
 * The CLASS: a journey's heading-level expectation drifting from the screen it
 * reads. Here the spec reads its levels from the same constants this test
 * proves against the rendered components, and a source check pins that the
 * spec keeps reading them (a literal `level: 1` beside the name comes back red).
 *
 * @mutate src/components/profile/profileLanding/IdentityHeader.tsx | <h2 className="font-display italic font-bold text-ds-20 leading-tight break-words" style={{ color: "hsl(var(--ink-deep))" }}> | <h3 className="font-display italic font-bold text-ds-20 leading-tight break-words" style={{ color: "hsl(var(--ink-deep))" }}>
 * @mutate src/components/profile/profileLanding/headingContract.ts | export const PROFILE_NAME_HEADING_LEVEL = 2; | export const PROFILE_NAME_HEADING_LEVEL = 1;
 * @mutate e2e/journeys/03-account.spec.ts | { name, exact: true, level: PROFILE_NAME_HEADING_LEVEL } | { name, exact: true, level: 1 }
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IdentityHeader } from "@/components/profile/profileLanding/IdentityHeader";
import { PROFILE_NAME_HEADING_LEVEL, PROFILE_PAGE_TITLE } from "@/components/profile/profileLanding/headingContract";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn() }));

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function renderIdentity(displayName: string) {
  return render(
    <MemoryRouter>
      <IdentityHeader
        profile={{ user_id: "u1", full_name: displayName, avatar_url: null, location: "Lafayette, LA", bio: "SEED test account." } as never}
        userId="u1"
        displayName={displayName}
        initials="EH"
        avgRating={null}
        reviewCount={0}
        completedCount={0}
        helperBadgeStats={null}
        onSelectTab={() => {}}
        tier="free"
        hasPhoto={false}
        memberSinceLabel={null}
        earnedBadges={[]}
      />
    </MemoryRouter>,
  );
}

describe("/profile landing heading contract (journeys read it)", () => {
  it("the member's name renders at PROFILE_NAME_HEADING_LEVEL", () => {
    renderIdentity("E2E Helper");
    expect(screen.getByRole("heading", { name: "E2E Helper", level: PROFILE_NAME_HEADING_LEVEL })).toBeInTheDocument();
  });

  it("the name is not the page's h1 (the h1 is the PageHeader title)", () => {
    renderIdentity("E2E Helper");
    expect(screen.queryByRole("heading", { name: "E2E Helper", level: 1 })).toBeNull();
    expect(PROFILE_PAGE_TITLE).toBe("Profile");
    expect(blankComments(read("src/components/profile/ProfileLanding.tsx"))).toMatch(/title=\{PROFILE_PAGE_TITLE\}/);
  });

  it("the sign-back-in journey reads both levels from the contract, never a literal", () => {
    const spec = blankComments(read("e2e/journeys/03-account.spec.ts"));
    expect(spec).toMatch(/\{ name, exact: true, level: PROFILE_NAME_HEADING_LEVEL \}/);
    expect(spec).toMatch(/\{ name: PROFILE_PAGE_TITLE, exact: true, level: 1 \}/);
    // Floor + the drifted shape: no getByRole heading on the profile name with a literal level.
    expect(spec).not.toMatch(/getByRole\("heading", \{ name, exact: true, level: \d/);
  });
});
