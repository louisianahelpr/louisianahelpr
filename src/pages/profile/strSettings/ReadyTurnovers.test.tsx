import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ReadyTurnovers } from "./ReadyTurnovers";
import { todayYmd } from "@/lib/jobDate";

/**
 * Q1521 (lh-authz-rls review of Q768, finding f2e3e3797#4): an imported STR
 * checkout could only be found through its notice. /str-settings now lists
 * every checkout from today on that is not yet posted, each opening Post a Job
 * pre-filled; "posted" is the same funded rule Post a Job reads
 * (isTurnoverPosted), so the two can never disagree.
 *
 * @mutate src/pages/post-job/turnoverPrefill.ts |     .filter((r) => r.str_calendar_connections?.is_active !== false && !isTurnoverPosted(r)) |     .filter((r) => r.str_calendar_connections?.is_active !== false)
 * @mutate src/pages/post-job/turnoverPrefill.ts |       .gte("checkout_date", todayYmd) |       .gte("checkout_date", "1970-01-01")
 * @mutate src/pages/post-job/turnoverPrefill.ts |       .order("checkout_date", { ascending: true }), |       .order("checkout_date", { ascending: true }).limit(50),
 * @mutate src/pages/profile/StrSettings.tsx |                 {connections.length > 0 && <ReadyTurnovers />}\n | \n
 * @mutate src/pages/profile/strSettings/ReadyTurnovers.tsx |   if (isError) { |   if (false) {
 */

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as unknown,
  gte: [] as Array<[string, string]>,
  eq: [] as Array<[string, unknown]>,
  limited: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {
      select: () => b,
      gte: (col: string, v: string) => {
        state.gte.push([col, v]);
        return b;
      },
      eq: (col: string, v: unknown) => {
        state.eq.push([col, v]);
        return b;
      },
      order: () => b,
      limit: () => {
        state.limited = true;
        return b;
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: state.error ? null : state.rows, error: state.error }),
    };
    return b;
  };
  return { supabase: { from: (t: string) => (t === "str_processed_events" ? builder() : null) } };
});

const conn = (name: string | null, active = true) => ({ property_name: name, is_active: active });

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReadyTurnovers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Ready to post on /str-settings (Q1521)", () => {
  beforeEach(() => {
    state.rows = [];
    state.error = null;
    state.gte = [];
    state.eq = [];
    state.limited = false;
  });

  it("lists checkouts not yet posted, each opening Post a Job pre-filled; a funded one is left out", async () => {
    state.rows = [
      { id: "ev-1", checkout_date: "2030-05-02", job_id: null, jobs: null, str_calendar_connections: conn("Bayou Cottage") },
      { id: "ev-2", checkout_date: "2030-05-03", job_id: "j-2", jobs: { status: "open", payment_status: "escrow" }, str_calendar_connections: conn("Funded Place") },
      { id: "ev-3", checkout_date: "2030-05-04", job_id: "j-3", jobs: { status: "open", payment_status: "unpaid" }, str_calendar_connections: conn(null) },
      { id: "ev-4", checkout_date: "2030-05-05", job_id: null, jobs: null, str_calendar_connections: conn("Removed Calendar", false) },
    ];
    renderList();
    const links = await screen.findAllByTestId("ready-turnover");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/post-job?turnover=ev-1", "/post-job?turnover=ev-3"]);
    expect(screen.getByText("Bayou Cottage")).toBeInTheDocument();
    expect(screen.getByText("Unnamed property")).toBeInTheDocument();
    expect(screen.queryByText("Funded Place")).not.toBeInTheDocument();
    expect(screen.queryByText("Removed Calendar")).not.toBeInTheDocument();
    // Only checkouts from today (Louisiana) on.
    expect(state.gte).toEqual([["checkout_date", todayYmd()]]);
    // Inactive calendars are filtered in the query, and nothing caps the rows
    // before the client-side "already posted" filter (a cap could hide a
    // pending checkout behind posted ones).
    expect(state.eq).toEqual([["str_calendar_connections.is_active", true]]);
    expect(state.limited).toBe(false);
  });

  it("a failed read says so, with a retry", async () => {
    state.error = { message: "permission denied", code: "42501" };
    renderList();
    expect(await screen.findByText("We couldn't load the checkouts waiting to be posted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("nothing to post draws nothing", async () => {
    const { container } = renderList();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });

  it("Post a Job and the list read the one funded rule, and the page mounts the list", () => {
    const prefill = blankComments(readFileSync("src/pages/post-job/turnoverPrefill.ts", "utf8"));
    expect(prefill).toMatch(/alreadyPosted: isTurnoverPosted\(row\),/);
    expect(prefill).toMatch(/!isTurnoverPosted\(r\)/);
    expect(prefill.match(/FUNDED\.has\(/g)?.length).toBe(1);
    expect(blankComments(readFileSync("src/pages/profile/StrSettings.tsx", "utf8"))).toMatch(/<ReadyTurnovers \/>/);
  });
});
