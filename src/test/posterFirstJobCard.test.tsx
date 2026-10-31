/**
 * UX-5 (Growth and ops, owner approved 10-29): "First-week checklist on Home for new Helprs and posters". The Helpr half
 * shipped (FirstJobHome, "Get your first job"); the poster half was missing. PosterFirstJobCard shows a member who has
 * posted and has no posted job finished yet: Post your first job (done), Hire a Helpr (done once someone is hired),
 * Approve the work when it's done. It leaves once a posted job is finished; nothing before a first post, while loading
 * or on a failed read. HomeDashboard mounts it for every member who is not a newcomer (never role-based).
 *
 * @mutate src/pages/home/homeDashboard/PosterFirstJobCard.tsx |   if (!data \|\| !data.posted \|\| data.finished) return null; |   if (!data \|\| !data.posted) return null;
 * @mutate src/pages/home/homeDashboard/PosterFirstJobCard.tsx |     hired: jobs.some((j) => !!j.helper_id), |     hired: false,
 * @mutate src/pages/home/HomeDashboard.tsx |             {firstJob && !firstJob.isNew && <PosterFirstJobCard userId={user?.id} />} |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

let rows: { helper_id: string | null; status: string | null; poster_completed_at: string | null }[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) },
}));

import { PosterFirstJobCard, posterFirstJobState } from "@/pages/home/homeDashboard/PosterFirstJobCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PosterFirstJobCard userId="u1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const open = { helper_id: null, status: "open", poster_completed_at: null };
const hired = { helper_id: "h1", status: "in_progress", poster_completed_at: null };
const done = { helper_id: "h1", status: "completed", poster_completed_at: "2026-10-30T12:00:00Z" };

afterEach(() => { cleanup(); rows = []; });

describe("the poster's first-week checklist on Home (UX-5)", () => {
  it("reads posted / hired / finished from the member's posted jobs", () => {
    expect(posterFirstJobState([])).toEqual({ posted: false, hired: false, finished: false });
    expect(posterFirstJobState([open])).toEqual({ posted: true, hired: false, finished: false });
    expect(posterFirstJobState([open, hired])).toEqual({ posted: true, hired: true, finished: false });
    expect(posterFirstJobState([{ ...hired, status: "completed" }]).finished).toBe(true);
  });

  it("posted, nobody hired: Post done, Hire and Approve to do", async () => {
    rows = [open];
    renderCard();
    expect(await screen.findByRole("heading", { name: "Your first job posted" })).toBeTruthy();
    const steps = [...document.querySelectorAll("[data-step]")].map((b) => `${b.getAttribute("data-step")}:${b.hasAttribute("data-done")}`);
    expect(steps).toEqual(["post:true", "hire:false", "approve:false"]);
  });

  it("someone hired: Hire is ticked", async () => {
    rows = [open, hired];
    renderCard();
    await screen.findByRole("heading", { name: "Your first job posted" });
    expect(document.querySelector('[data-step="hire"]')?.hasAttribute("data-done")).toBe(true);
  });

  it("gone once a posted job is finished, and never before a first post", async () => {
    rows = [hired, done];
    renderCard();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("heading", { name: "Your first job posted" })).toBeNull();
    cleanup();
    rows = [];
    renderCard();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("poster-first-job")).toBeNull();
  });

  it("Home mounts it for every member who is not a newcomer", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));
    expect(code).toMatch(/\{firstJob && !firstJob\.isNew && <PosterFirstJobCard userId=\{user\?\.id\} \/>\}/);
  });
});
