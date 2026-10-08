/**
 * Q707 — a hired crew is not offered Edit (owner, 2026-10-05).
 *
 * A crew job stays `open` while it fills, so the poster's card stays on its
 * Open step, which offered Edit to a crew that already had hired members. The
 * server refuses that edit (enforce_poster_jobs_money_lock: booked = helper_id
 * OR a group_job_helpers row naming a Helpr), so the poster met a 42501. The
 * owner's rule: once a crew is hired, date and details change only through a
 * request the crew accepts (the Q1204 rule; the request itself is Q1254).
 *
 * Held here, across the layers:
 *   - crewIsBooked (src/pages/posts/postedJobCard/crewBooked.ts) is the
 *     server's test: a roster row with helper_id NOT NULL; departed members
 *     (anonymised to NULL) do not count;
 *   - the NEWEST effective enforce_poster_jobs_money_lock (migrations replayed,
 *     any dollar tag) still decides "booked" that way, so the two cannot drift;
 *   - OpenStep renders no Edit for a booked crew, and still does otherwise;
 *   - PostedJobCard feeds it from the roster the card already holds;
 *   - and that roster is FETCHED for an open crew (postedDetailInputs). It was
 *     not: the feed covered accepted/in_progress/disputed only, so on prod
 *     2026-10-05 a funded open crew with one hired member still showed
 *     "Edit job" (seeded is_seed fixture, poster-e2e, 375 and 1440).
 */
// @mutate src/pages/posts/postedJobCard/crewBooked.ts |   return (roster ?? []).some((m) => m.helper_id != null); |   return (roster ?? []).length > 0;
// @mutate src/pages/posts/postedJobCard/steps/OpenStep.tsx |         ...(crewBooked |         ...(false
// @mutate src/pages/posts/postedJobCard/PostedJobActions.tsx |     crewBooked: crewIsBooked(job, crewRoster), |     crewBooked: false,
// @mutate src/hooks/useActivityData.ts |       .filter((j) => (isActiveStatus(j.status) \|\| j.status === "open") && j.is_group_job) |       .filter((j) => isActiveStatus(j.status) && j.is_group_job)
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { crewIsBooked } from "@/pages/posts/postedJobCard/crewBooked";
import { postedDetailInputs } from "@/hooks/useActivityData";
import { OpenStep } from "@/pages/posts/postedJobCard/steps/OpenStep";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import type { Job } from "@/components/job-card/activityConstants";
import { openMore } from "@/test/helpers/openMore";

const ROOT = resolve(__dirname, "../..");

describe("a booked crew is not offered Edit (Q707)", () => {
  it("crewIsBooked is the server's test: a roster row naming a Helpr", () => {
    expect(crewIsBooked({ is_group_job: false }, [{ helper_id: "h1" }])).toBe(false);
    expect(crewIsBooked({ is_group_job: true }, [])).toBe(false);
    expect(crewIsBooked({ is_group_job: true }, undefined)).toBe(false);
    expect(crewIsBooked({ is_group_job: true }, [{ helper_id: null }])).toBe(false);
    expect(crewIsBooked({ is_group_job: true }, [{ helper_id: null }, { helper_id: "h2" }])).toBe(true);
  });

  it("the newest money lock still calls a crew booked by a roster row with helper_id NOT NULL", () => {
    const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
    expect(defs.size).toBeGreaterThan(100);
    const body = blankSqlComments(defs.get("enforce_poster_jobs_money_lock")?.stmt ?? "").replace(/\s+/g, " ").toLowerCase();
    expect(body).toMatch(
      /old\.helper_id is not null or exists \(select 1 from public\.group_job_helpers g where g\.job_id = old\.id and g\.helper_id is not null\)/,
    );
  });

  const ctx = (crewBooked: boolean): PosterStepCtx =>
    ({
      job: { id: "j1", title: "Crew job", status: "open", budget: 100, category: "other", is_group_job: true } as unknown as Job,
      onBoost: vi.fn(),
      onEdit: vi.fn(),
      onCancel: vi.fn(),
      crewBooked,
    }) as unknown as PosterStepCtx;
  const draw = (crewBooked: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <OpenStep {...ctx(crewBooked)} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("OpenStep offers Edit on a crew nobody has joined, and not on a booked one", async () => {
    // Edit is under More (owner, 2026-10-08): open it, then look.
    const open = draw(false);
    const inOpen = await openMore(open.container);
    expect(inOpen.some((b) => b.getAttribute("aria-label")?.startsWith("Edit"))).toBe(true);
    open.unmount();
    const booked = draw(true);
    const inBooked = await openMore(booked.container);
    expect(inBooked.some((b) => b.getAttribute("aria-label")?.startsWith("Edit"))).toBe(false);
  });

  it("PostedJobCard hands its crew roster to the actions, which decide from it", () => {
    const card = blankComments(readFileSync(join(ROOT, "src/pages/posts/PostedJobCard.tsx"), "utf8"));
    expect(card).toMatch(/crewRoster=\{initialGroupHelpers\}/);
    const actions = blankComments(readFileSync(join(ROOT, "src/pages/posts/postedJobCard/PostedJobActions.tsx"), "utf8"));
    expect(actions).toMatch(/crewBooked: crewIsBooked\(job, crewRoster\)/);
  });

  it("the card's roster is fetched for every crew the server can call booked, open ones included", () => {
    // The money lock counts a roster row on any job it guards; a crew is open
    // while it fills and accepted once full. Both must reach the card.
    const crew = (id: string, status: string) => ({ id, status, is_group_job: true, helper_id: null }) as unknown as Job;
    const ids = postedDetailInputs([crew("a", "open"), crew("b", "accepted"), crew("c", "completed")]).groupIds;
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });
});
