/**
 * Q2691 (audit 1102e row 24): on the Helpr side of the admin Messages preview the other person was still "Eli R."
 * with a Helpr's stats, though on that side the admin is the Helpr and the other person posted the job. The Helpr side
 * now names posters and gives them a poster's record.
 * Row 17: the job preview's timelines had both day-of confirmations AFTER the Helpr set off.
 * @mutate src/pages/admin/preview/messagesPreviewSamples.ts | const people = poster ? PEOPLE : POSTERS; | const people = PEOPLE;
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts | Date.parse(job.helper_dayof_confirmed_at) > setOff) { | Date.parse(job.helper_dayof_confirmed_at) > setOff && false) {
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

import MessagesPreviewPage from "@/pages/admin/preview/MessagesPreviewPage";
import { messagesPreviewSample } from "@/pages/admin/preview/messagesPreviewSamples";
import { PREVIEW_STAGES, previewSample } from "@/pages/admin/preview/jobPreviewSamples";
import { __resetBlockReadsForTests } from "@/lib/userBlocks";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const realFetch = globalThis.fetch;
beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  __resetBlockReadsForTests();
  globalThis.fetch = (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

type Profile = { id: string; full_name: string };
type Stats = { user_id: string; completed_jobs_as_helper: number; posted_jobs_total: number };
const profilesOf = (side: "poster" | "helpr") => {
  const s = messagesPreviewSample("thread", side, ADMIN_ID);
  const rake = (s.tables.jobs as Array<{ customer_id: string; helper_id: string }>)[0];
  const other = side === "poster" ? rake.helper_id : rake.customer_id;
  const read = (k: string, body: Record<string, unknown>) => (s.reads[k] as (b: Record<string, unknown>) => unknown)(body);
  return {
    name: (read("get_safe_profiles", { user_ids: [other] }) as Profile[])[0].full_name,
    stats: (read("get_public_profile_stats", { p_user_ids: [other] }) as Stats[])[0],
  };
};

describe("admin Messages preview, the Helpr side (Q2691)", () => {
  it("the poster side's other person is the hired Helpr, with a Helpr's record", () => {
    const { name, stats } = profilesOf("poster");
    expect(name).toBe("Eli Robichaux");
    expect(stats.completed_jobs_as_helper).toBeGreaterThan(0);
  });

  it("the Helpr side's other person posted the job: a poster's name and record, not Eli's", () => {
    const { name, stats } = profilesOf("helpr");
    expect(name).not.toMatch(/Eli/);
    expect(stats.completed_jobs_as_helper).toBe(0);
    expect(stats.posted_jobs_total).toBeGreaterThan(0);
  });

  it("the Helpr side's thread names that poster", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/preview/messages?stage=thread&side=helpr"]}>
          <Routes><Route path="/admin/preview/messages" element={<MessagesPreviewPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Are the bags in the shed\?/, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect((await screen.findAllByText(/Lexi/, undefined, { timeout: 10000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Eli R/)).toBeNull();
  }, 30000);
});

describe("admin job preview timelines (Q2691, audit 1102e row 17)", () => {
  it("every stage's day-of confirmations come before the Helpr set off", () => {
    let checked = 0;
    for (const { key } of PREVIEW_STAGES) {
      for (const viewer of ["poster", "helpr"] as const) {
        const { job } = previewSample(key, viewer);
        const off = Date.parse(job.helper_on_the_way_at ?? "");
        if (Number.isNaN(off)) continue;
        for (const at of [job.helper_dayof_confirmed_at, job.poster_confirmed_at]) {
          if (!at) continue;
          expect(Date.parse(at), `${key}:${viewer}`).toBeLessThan(off);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
