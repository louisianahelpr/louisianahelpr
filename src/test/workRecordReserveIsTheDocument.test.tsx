/**
 * Owner, 2026-10-08: "loading state for work record is not correct". While its
 * data loaded, Work Record drew the generic two short cards; what arrives is
 * ONE `.doc-card` letterhead. Both waits (the chunk's ProfileTabFallback and
 * the tab's own data wait) now draw WorkRecordReserve: the same sheet, with
 * the identity row's three labels and the Work Summary's four stat tiles.
 *
 * @mutate src/components/profile/ProfileTabFallback.tsx |   if (tab === "work_record") return <WorkRecordReserve />; |
 * @mutate src/pages/profile/WorkRecord.tsx | {loading && <ProfileTabBodyReserve tab="work_record" />} | {loading && <ProfileTabBodyReserve />}
 * @mutate src/components/profile/WorkRecordReserve.tsx | [WORK_RECORD_ID_FIELD, "Not verified", "text-ds-13 font-semibold"], | ["Stripe ID verified by Stripe", "Not verified", "text-ds-13 font-semibold"],
 * @mutate src/components/profile/WorkRecordReserve.tsx | className="min-h-11 flex items-center" | className="flex items-center"
 * @mutate src/components/profile/WorkRecordReserve.tsx | <Skeleton data-testid="work-record-reserve-stat-icon" className="w-4 h-4 rounded shrink-0" /> | {null}
 * @mutate src/components/profile/WorkRecordReserve.tsx | <Ghost className="font-sans text-ds-12 mt-0.5">Generated September 30, 2026</Ghost> | <Skeleton className="h-3.5 w-40 rounded mt-1.5" />
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));

import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { WORK_RECORD_ID_FIELD } from "@/components/profile/WorkRecordReserve";

describe("Work Record waits in the shape of its document", () => {
  it("the reserve for work_record is the letterhead sheet, not the generic cards", () => {
    const { container } = render(<ProfileTabBodyReserve tab="work_record" />);
    const sheet = screen.getByTestId("work-record-reserve");
    expect(sheet.classList.contains("doc-card")).toBe(true);
    expect(screen.queryByTestId("profile-tab-fallback")).toBeNull();
    expect(container.querySelectorAll(".doc-tile")).toHaveLength(4);
    expect(container.querySelectorAll(".doc-band")).toHaveLength(1);
  });

  // loading-states-refresh 38958608457 (2026-10-16): three rows of the reserve
  // measured off the sheet (header +11px, identity -9px, stat tiles +17px).
  // Each cause is a fact about the markup, so each is pinned here; the
  // nightly measurement on prod is the pixel proof.
  it("the reserve's rows are built from what the sheet prints (Q-loading 38958608457)", () => {
    const { container } = render(<ProfileTabBodyReserve tab="work_record" />);
    const sheetSrc = readFileSync(join(process.cwd(), "src/pages/profile/WorkRecord.tsx"), "utf8");
    // Identity: the same label words the sheet prints, not the pill's wording + "by Stripe".
    expect(container.textContent).toContain(WORK_RECORD_ID_FIELD);
    expect(container.textContent).not.toMatch(/Stripe ID verified by Stripe/i);
    expect(sheetSrc).toContain("{WORK_RECORD_ID_FIELD}");
    // Header: the mark's 44px link box (HelprMark min-h-11), and the date as a text-ds-12 line.
    expect(screen.getByTestId("work-record-reserve-mark").className).toContain("min-h-11");
    expect([...container.querySelectorAll("p.text-ds-12")].map((p) => p.textContent)).toEqual([
      expect.stringMatching(/^Generated /),
    ]);
    // Stat tiles: each label sits beside an icon-sized bone, as StatBlock's does.
    expect(screen.getAllByTestId("work-record-reserve-stat-icon")).toHaveLength(4);
  });

  it("the tab's own data wait asks for that reserve", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/profile/WorkRecord.tsx"), "utf8");
    expect(src).toContain('{loading && <ProfileTabBodyReserve tab="work_record" />}');
  });
});
