/**
 * Owner, 2026-10-08: "loading state for work record is not correct". While its
 * data loaded, Work Record drew the generic two short cards; what arrives is
 * ONE `.doc-card` letterhead. Both waits (the chunk's ProfileTabFallback and
 * the tab's own data wait) now draw WorkRecordReserve: the same sheet, with
 * the identity row's three labels and the Work Summary's four stat tiles.
 *
 * @mutate src/components/profile/ProfileTabFallback.tsx |   if (tab === "work_record") return <WorkRecordReserve />; |
 * @mutate src/pages/profile/WorkRecord.tsx | {loading && <ProfileTabBodyReserve tab="work_record" />} | {loading && <ProfileTabBodyReserve />}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));

import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";

describe("Work Record waits in the shape of its document", () => {
  it("the reserve for work_record is the letterhead sheet, not the generic cards", () => {
    const { container } = render(<ProfileTabBodyReserve tab="work_record" />);
    const sheet = screen.getByTestId("work-record-reserve");
    expect(sheet.classList.contains("doc-card")).toBe(true);
    expect(screen.queryByTestId("profile-tab-fallback")).toBeNull();
    expect(container.querySelectorAll(".doc-tile")).toHaveLength(4);
    expect(container.querySelectorAll(".doc-band")).toHaveLength(1);
  });

  it("the tab's own data wait asks for that reserve", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/profile/WorkRecord.tsx"), "utf8");
    expect(src).toContain('{loading && <ProfileTabBodyReserve tab="work_record" />}');
  });
});
