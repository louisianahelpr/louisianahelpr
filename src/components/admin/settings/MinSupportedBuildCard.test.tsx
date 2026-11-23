import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MinSupportedBuildCard } from "./MinSupportedBuildCard";

/**
 * Audit NL-05 (2026-11-23): the App Store's 1.0.4 (build 8502) was built while
 * the listing 404'd, so its "Update Helpr to continue" screen tells App Store
 * users to open TestFlight and has no store button. Raising the minimum build
 * above 8502 would strand them. The card says so next to the control (it used
 * to warn about a 404 that stopped being true on 2026-11-19).
 */
// @mutate src/components/admin/settings/MinSupportedBuildCard.tsx |             Do not set this above 8502 while people still use 1.0.4 (build 8502). |             Before setting this above 0, confirm the App Store listing loads.

describe("MinSupportedBuildCard warns about the TestFlight copy in build 8502", () => {
  it("names the build and says App Store users would be stuck", () => {
    render(<MinSupportedBuildCard minBuild="7117" setMinBuild={() => {}} saveMinBuild={() => {}} savingMinBuild={false} />);
    const warning = screen.getByText(/Do not set this above 8502 while people still use 1\.0\.4/);
    expect(warning.textContent).toMatch(/open TestFlight/);
    expect(warning.textContent).toMatch(/no App Store button/);
    // The stale "the listing returns a 404" caution is gone: the listing is live.
    expect(screen.queryByText(/returns a 404/)).toBeNull();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
