/**
 * Design audit A D3 (owner approved 11-08): a new member's Dashboard is ONE welcome card ("What brings you here?":
 * Post a job / Find work near me / Sell something) in place of "You're all caught up" and an empty "Coming up";
 * the jobs near them follow from FirstJobHome's existing read. "Post a job" goes through the age gate, like the
 * Create pill; "Sell something" only while Declutter is live.
 *
 * @mutate src/pages/home/homeDashboard/WelcomeCard.tsx |           onClick={gate.gate("post", post)} |           onClick={post}
 * @mutate src/pages/home/HomeDashboard.tsx | ) : welcome && summary.upcoming.length === 0 ? null : ( | ) : (
 * @mutate src/pages/home/HomeDashboard.tsx |   const welcome = !!firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && !next | const welcome = false && !!firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && !next
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const ageGate = vi.hoisted(() => ({ underAge: false, explain: vi.fn() }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({
    underAge: ageGate.underAge,
    explain: ageGate.explain,
    gate: (kind: string, go: () => void) => () => (ageGate.underAge ? ageGate.explain(kind) : go()),
    gatedProps: () => ({}),
  }),
}));
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticLight: vi.fn() }));

import { WelcomeCard } from "@/pages/home/homeDashboard/WelcomeCard";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
const draw = (sell: boolean) =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes><Route path="*" element={<><WelcomeCard sell={sell} /><Where /></>} /></Routes>
    </MemoryRouter>,
  );

const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));

describe("a new member's Dashboard is one welcome card (design audit A D3)", () => {
  afterEach(() => {
    cleanup();
    ageGate.underAge = false;
    ageGate.explain.mockReset();
  });

  it("three starting actions, each going where it says", () => {
    draw(true);
    expect(screen.getByText("What brings you here?")).toBeTruthy();
    fireEvent.click(screen.getByText("Find work near me"));
    expect(screen.getByTestId("where").textContent).toBe("/jobs");
    fireEvent.click(screen.getByText("Post a job"));
    expect(screen.getByTestId("where").textContent).toBe("/post-job");
    fireEvent.click(screen.getByText("Sell something"));
    expect(screen.getByTestId("where").textContent).toMatch(/^\/declutter/);
  });

  it("Post a job goes through the age gate; Sell something only while Declutter is live", () => {
    ageGate.underAge = true;
    draw(false);
    fireEvent.click(screen.getByText("Post a job"));
    expect(ageGate.explain).toHaveBeenCalledWith("post");
    expect(screen.getByTestId("where").textContent).toBe("/home");
    expect(screen.queryByText("Sell something")).toBeNull();
  });

  it("the Dashboard swaps it in for the empty Next up and hides an empty Coming up, for a new member only", () => {
    expect(home).toContain("const welcome = !!firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && !next && !summary.todosLoading && !summary.waiting;");
    expect(home).toMatch(/\{welcome \? <WelcomeCard sell=\{visible\.filter\(isLive\)\.some\(\(v\) => v\.key === "declutter"\)\} \/> : \(\s*<section ref=\{nextUpRef\} data-testid="next-up"/);
    expect(home).toContain(') : welcome && summary.upcoming.length === 0 ? null : (');
    // The jobs near them still follow (FirstJobHome's read), no new request.
    expect(home).toContain("{firstJob?.isNew && !summary.usesDeclutter && !summary.declutterPending && <FirstJobHome");
  });
});
