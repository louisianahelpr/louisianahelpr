/**
 * F116 (owner UI audit 11-09): an expired listing's page at 1440 had a big white card holding only a right-aligned
 * "Post this job again". On the desktop website it is now one left-aligned button inside the status card, under "No
 * Helpr was hired in time", and the side card's row is not drawn. A phone keeps its sticky bar (JP2).
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |           {repost.inline}\n |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {isPoster && !repost.hideRow && posterActions.row( | {isPoster && posterActions.row(
 * @mutate src/pages/jobs/jobPage/ExpiredRepost.tsx |       <div data-expired-repost="" className="flex justify-start"> |       <div data-expired-repost="" className="flex justify-end">
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

const view = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => view.desktop }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));

import { useExpiredRepost } from "./ExpiredRepost";

afterEach(() => { cleanup(); view.desktop = true; });

const EXPIRED = { id: "j-1", status: "cancelled", helper_id: null, cancelled_by: null, cancellation_reason: "Job listing expired: no Helpr was hired" };
const wrap = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}

describe("an expired listing's one action sits under its line on the desktop website (F116)", () => {
  it("desktop, poster, expired: a left-aligned Post this job again, and the side row is not drawn", () => {
    const { result } = renderHook(() => useExpiredRepost(EXPIRED, true), { wrapper: wrap });
    expect(result.current.hideRow).toBe(true);
    function Probe() {
      const r = useExpiredRepost(EXPIRED, true);
      return <>{r.inline}</>;
    }
    render(<MemoryRouter><Routes><Route path="*" element={<><Probe /><Where /></>} /></Routes></MemoryRouter>);
    const box = document.querySelector("[data-expired-repost]")!;
    expect(box.className.split(" ")).toContain("justify-start");
    fireEvent.click(screen.getByRole("button", { name: "Post this job again" }));
    expect(screen.getByTestId("where").textContent).toBe("/post-job?rebook=j-1");
  });

  it.each([
    ["phone", () => { view.desktop = false; }, EXPIRED, true],
    ["not the poster", () => {}, EXPIRED, false],
    ["cancelled by someone (not expired)", () => {}, { ...EXPIRED, cancelled_by: "u-1" }, true],
    ["open job", () => {}, { ...EXPIRED, status: "open" }, true],
  ] as const)("%s: nothing inline, the usual row stays", (_name, setup, job, poster) => {
    setup();
    const { result } = renderHook(() => useExpiredRepost(job, poster), { wrapper: wrap });
    expect(result.current).toEqual({ inline: null, hideRow: false });
  });

  it("JobPage draws it inside the status card (data-job-steps) and drops the side row for it", () => {
    const page = blankComments(readFileSync(join(__dirname, "JobPage.tsx"), "utf8"));
    const steps = page.indexOf('data-job-steps=""');
    const inline = page.indexOf("{repost.inline}");
    expect(steps).toBeGreaterThan(0);
    expect(inline).toBeGreaterThan(steps);
    expect(inline).toBeLessThan(page.indexOf("</section>", steps));
    expect(page).toContain("{isPoster && !repost.hideRow && posterActions.row(");
  });
});
