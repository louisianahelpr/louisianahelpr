/**
 * F260u (whole-app audit 2026-11-10, Suggestion): opening a job sheet on /browse wrote ?job=<id> with replace, so it
 * had no history entry of its own: Back left a stale URL or walked off the page. Now opening the sheet pushes one
 * entry; Back pops it and the sheet closes with it; the sheet's own close pops only the entry it pushed (a fresh
 * /browse?job= link just drops the param in place).
 * @mutate src/pages/home/useGuestJobSheet.ts | { state: { ...stateObject(location.state), [SHEET_ENTRY]: true } } | { replace: true, state: { ...stateObject(location.state), [SHEET_ENTRY]: true } }
 * @mutate src/pages/home/useGuestJobSheet.ts |     if (!jobParam) setDetailJob(null); |     void jobParam;
 * @mutate src/pages/home/useGuestJobSheet.ts |     if (isSheetEntry(location.state)) { |     if (false) {
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { readFileSync } from "node:fs";
import { useGuestJobSheet } from "@/pages/home/useGuestJobSheet";
import type { EnrichedJob } from "@/components/dashboard/types";

const jobs = [{ id: "job-1", title: "Rake leaves" }] as unknown as EnrichedJob[];

function setup(initial: string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ sheet: useGuestJobSheet(jobs), loc: useLocation(), nav: useNavigate() }), { wrapper });
}

describe("F260u: the /browse job sheet is its own history entry", () => {
  it("open pushes ?job=; Back pops it and closes the sheet; the next Back is the page before /browse", () => {
    const { result } = setup(["/", "/browse?sort=new"]);
    act(() => result.current.sheet.openDetailJob(jobs[0]));
    expect(result.current.sheet.detailJob?.id).toBe("job-1");
    expect(result.current.loc.pathname + result.current.loc.search).toBe("/browse?sort=new&job=job-1");
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname + result.current.loc.search).toBe("/browse?sort=new");
    expect(result.current.sheet.detailJob).toBeNull();
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/");
  });

  it("the sheet's own close pops the entry it pushed (no stale ?job= left behind)", () => {
    const { result } = setup(["/", "/browse"]);
    act(() => result.current.sheet.openDetailJob(jobs[0]));
    act(() => result.current.sheet.closeDetailJob());
    expect(result.current.loc.pathname + result.current.loc.search).toBe("/browse");
    expect(result.current.sheet.detailJob).toBeNull();
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/");
  });

  it("a fresh /browse?job= link restores the sheet, and close drops the param in place", () => {
    const { result } = setup(["/", "/browse?job=job-1"]);
    expect(result.current.sheet.detailJob?.id).toBe("job-1");
    act(() => result.current.sheet.closeDetailJob());
    expect(result.current.loc.pathname + result.current.loc.search).toBe("/browse");
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/");
  });

  it("DashboardGuest uses the hook, not a replace-only ?job= writer", () => {
    const src = readFileSync("src/pages/home/DashboardGuest.tsx", "utf8");
    expect(src).toContain("useGuestJobSheet(jobs)");
    expect(src).not.toMatch(/next\.set\("job"/);
  });
});
