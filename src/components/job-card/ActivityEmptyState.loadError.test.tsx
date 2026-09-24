import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityEmptyState } from "./ActivityEmptyState";

/**
 * A FAILED TAB LOAD MUST NOT BORROW THE OTHER TAB'S ROWS.
 *
 * `useActivityData` reports `loadError` for the ACTIVE tab's core query only,
 * but hands back BOTH tabs' lists — and the inactive tab is warmed on idle as
 * soon as the active one settles, errors included. ActivityEmptyState gated
 * its error card on `postedJobsCount === 0 && appliedAppsCount === 0`, so a
 * poster whose My Jobs read failed (applications query rejected) had their
 * posts counted against it, skipped the error card, and was told "No
 * applications yet" — a claim about the account made from a failed read.
 * The same held in reverse for a helper whose My Posts read failed.
 *
 * These render the component with exactly the props Activity.tsx passes when
 * the active tab's query rejects and the other tab has rows.
 */

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const base = {
  statusFilter: "all",
  hasSearch: false,
  statusCounts: {},
  statusLabels: [],
  onRetry: vi.fn(),
  onNavigate: vi.fn(),
  onSelectStatusFilter: vi.fn(),
  onClearSearch: vi.fn(),
};

const renderState = (props: Partial<Parameters<typeof ActivityEmptyState>[0]>) =>
  render(
    <MemoryRouter>
      <ActivityEmptyState
        {...(base as unknown as Parameters<typeof ActivityEmptyState>[0])}
        {...(props as Parameters<typeof ActivityEmptyState>[0])}
      />
    </MemoryRouter>,
  );

const retryButton = () => screen.queryByRole("button", { name: /try again/i });

describe("ActivityEmptyState: the active tab's failed load shows the error card", () => {
  it("My Jobs failed, My Posts has rows → error card, not 'No applications yet'", () => {
    renderState({ tab: "applied", loadError: true, postedJobsCount: 3, appliedAppsCount: 0 });
    expect(retryButton()).not.toBeNull();
    expect(screen.queryByText(/no applications yet/i)).toBeNull();
  });

  it("My Posts failed, My Jobs has rows → error card, not the no-posts state", () => {
    renderState({ tab: "posted", loadError: true, postedJobsCount: 0, appliedAppsCount: 4 });
    expect(retryButton()).not.toBeNull();
  });

  it("control: a successful empty tab shows the empty state, not the error card", () => {
    renderState({ tab: "applied", loadError: false, postedJobsCount: 3, appliedAppsCount: 0 });
    expect(retryButton()).toBeNull();
  });
});

// The original gate: both tabs' counts, so a failed read was masked by the
// OTHER tab's rows and the reader was told "No applications yet".
// @mutate src/components/job-card/ActivityEmptyState.tsx | if (loadError && totalCount === 0) { | if (loadError && postedJobsCount === 0 && appliedAppsCount === 0) {
