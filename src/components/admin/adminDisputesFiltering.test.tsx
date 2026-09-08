import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminDisputes from "./AdminDisputes";

/**
 * The Open tab count and the two empty states.
 *
 * These cannot be demonstrated against prod. The only open dispute there is
 * flagged UNSETTLED, and `passesAge`/`passesParty`/`passesCategory` each return
 * true unconditionally for an unsettled case on purpose — stuck money is never
 * hidden behind a filter chip. So driving the real console with the real data
 * can never produce a filtered-empty queue, which is exactly the state that was
 * broken. Fixtures are the only way to reach it, and this is the guard that
 * keeps it reachable.
 *
 * Two defects are pinned here:
 *  1. The tab rendered `disputes.length` — the RAW queue — while the list below
 *     rendered the filtered one, so "Open (2)" could sit above a single row.
 *  2. A queue filtered down to nothing showed the TRUE-empty state, telling the
 *     operator "Nothing is contested right now" while disputes sat hidden
 *     behind a chip.
 */

/** The Open tab renders its label and count in separate spans, so the
 * accessible name comes out unspaced. Read textContent instead. */
const openTabText = () =>
  [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .find((t) => t.trimStart().startsWith("Open")) ?? "";

const openJob = (id: string, hoursAgo: number, disputedBy: string) => ({
  id,
  title: `Job ${id}`,
  budget: 100,
  status: "disputed",
  customer_id: "poster-1",
  helper_id: "helper-1",
  stripe_payment_intent_id: `pi_${id}`,
  dispute_reason: "no_show",
  dispute_evidence_urls: [],
  disputed_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  disputed_by: disputedBy,
});

let openRows: ReturnType<typeof openJob>[] = [];

// AdminDisputes issues: jobs(status=disputed), jobs(dispute_resolved_at not
// null), disputes(job_id in ...), profiles(user_id in ...). Each is a thenable
// builder, so one chainable stub that resolves by table is enough.
vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const rowsFor = () => {
      if (table === "profiles") {
        return [
          { user_id: "poster-1", full_name: "Perry Poster", subscription_tier: "free" },
          { user_id: "helper-1", full_name: "Hallie Helper", subscription_tier: "free" },
        ];
      }
      // `disputes` returns none, so isUnsettled() is false for every row and the
      // filters actually apply — the whole point of these fixtures.
      return [];
    };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "in", "order", "limit", "is", "or", "neq", "gte", "lte"]) {
      b[m] = vi.fn(() => b);
    }
    // The open-jobs read is the only one keyed on status=disputed.
    b.then = (res: (v: unknown) => void) =>
      res({ data: table === "jobs" ? (b.__open ? openRows : []) : rowsFor(), error: null });
    b.eq = vi.fn((col: string, val: string) => {
      if (col === "status" && val === "disputed") b.__open = true;
      return b;
    });
    return b;
  };
  return { supabase: { from: vi.fn((t: string) => build(t)), auth: { getUser: vi.fn() } } };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: vi.fn(async () => true) }));

describe("AdminDisputes — Open count and the two empty states", () => {
  beforeEach(() => {
    // Both fresh (<24h) and both filed by the helper, so the ">30d" age chip
    // and the "Poster" party chip each exclude every row.
    openRows = [openJob("a", 3, "helper-1"), openJob("b", 8, "helper-1")];
  });

  it("counts the FILTERED queue in the Open tab, not the raw one", async () => {
    render(<AdminDisputes />);
    await screen.findByText(/Open Queue/);
    expect(openTabText()).toMatch(/Open\s*\(2\)/);

    fireEvent.click(screen.getByRole("radio", { name: ">30d" }));

    // Before the fix this stayed "Open (2)" — the tab describing a list the
    // admin could no longer see.
    await waitFor(() => expect(openTabText()).toMatch(/Open\s*\(0\)/));
  });

  it("shows the FILTERED-empty state, not 'nothing is contested', when filters hide every dispute", async () => {
    render(<AdminDisputes />);
    await screen.findByText(/Open Queue/);

    fireEvent.click(screen.getByRole("radio", { name: ">30d" }));

    await screen.findByText(/No disputes match your filters/);
    // The precise regression: asserting nothing is contested while two open
    // disputes sit behind the chip.
    expect(screen.queryByText(/Nothing is contested right now/)).toBeNull();
    expect(screen.getByRole("button", { name: /Clear filters/ })).toBeTruthy();
  });

  it("Clear filters restores the full queue", async () => {
    render(<AdminDisputes />);
    await screen.findByText(/Open Queue/);
    fireEvent.click(screen.getByRole("radio", { name: ">30d" }));
    await screen.findByText(/No disputes match your filters/);

    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));

    await waitFor(() => expect(openTabText()).toMatch(/Open\s*\(2\)/));
    expect(screen.queryByText(/No disputes match your filters/)).toBeNull();
  });

  it("still shows the TRUE-empty state when the queue is genuinely empty", async () => {
    openRows = [];
    render(<AdminDisputes />);

    // No filters are active, so this is the real "nothing is contested" case
    // and must NOT be replaced by the filtered-empty copy.
    await screen.findByText(/Nothing is contested right now/);
    expect(screen.queryByText(/No disputes match your filters/)).toBeNull();
  });
});
