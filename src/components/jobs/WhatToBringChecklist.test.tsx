/**
 * WhatToBringChecklist — tick persistence + missing-category renders nothing.
 *
 * The component is informational; correctness for us means:
 *   - A category without a curated list collapses to NOTHING (no empty card).
 *   - Checked items survive remount (persisted to safeStorage → localStorage).
 *   - Per-job scoping: ticks for job A don't bleed into job B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// safeStorage mirrors writes to Capacitor Preferences. Stub the native
// plugin so the component doesn't pull in the Capacitor runtime under
// jsdom — we exercise the localStorage path only.
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ value: null }),
    keys: vi.fn().mockResolvedValue({ keys: [] }),
  },
}));

import { WhatToBringChecklist } from "./WhatToBringChecklist";

describe("WhatToBringChecklist", () => {
  beforeEach(() => {
    localStorage.clear();
    cleanup();
  });

  it("renders nothing for a category that has no curated checklist", () => {
    const { container } = render(
      <WhatToBringChecklist jobId="job-xyz" category="other" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when category is null", () => {
    const { container } = render(
      <WhatToBringChecklist jobId="job-xyz" category={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when category is undefined", () => {
    const { container } = render(
      <WhatToBringChecklist jobId="job-xyz" category={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a header with the category label for a known category", () => {
    render(<WhatToBringChecklist jobId="job-1" category="yard_work" />);
    expect(screen.getByText(/yard work/i)).toBeInTheDocument();
  });

  it("starts collapsed — items are not in the DOM until expanded", () => {
    render(<WhatToBringChecklist jobId="job-1" category="yard_work" />);
    expect(screen.queryByText("Work gloves")).not.toBeInTheDocument();
  });

  it("expands when the header is clicked, revealing items", () => {
    render(<WhatToBringChecklist jobId="job-1" category="yard_work" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Work gloves")).toBeInTheDocument();
  });

  it("persists ticked items to localStorage and re-hydrates on remount", () => {
    const { unmount } = render(
      <WhatToBringChecklist jobId="job-1" category="handyman" />,
    );
    // Expand
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Tick "Tape measure"
    const checkbox = screen.getByRole("checkbox", { name: /tape measure/i });
    fireEvent.click(checkbox);

    // Storage written
    const raw = localStorage.getItem("helpr_what_to_bring_job-1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toContain("Tape measure");

    // Remount fresh — tick should re-hydrate
    unmount();
    render(<WhatToBringChecklist jobId="job-1" category="handyman" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const rehydrated = screen.getByRole("checkbox", { name: /tape measure/i });
    expect(rehydrated).toHaveAttribute("data-state", "checked");
  });

  it("scopes ticks per jobId — ticks for job A do not appear on job B", () => {
    // Tick on job A
    const { unmount } = render(
      <WhatToBringChecklist jobId="job-A" category="cleaning" />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("checkbox", { name: /rubber gloves/i }));
    unmount();

    // Mount job B with the same category — its checkbox must be untouched
    render(<WhatToBringChecklist jobId="job-B" category="cleaning" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const checkbox = screen.getByRole("checkbox", { name: /rubber gloves/i });
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
  });

  it("toggles a tick off — clicking a checked item unchecks it and updates storage", () => {
    render(<WhatToBringChecklist jobId="job-1" category="pet_care" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const checkbox = screen.getByRole("checkbox", { name: /spare leash/i });
    fireEvent.click(checkbox); // on
    fireEvent.click(checkbox); // off
    const raw = localStorage.getItem("helpr_what_to_bring_job-1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).not.toContain("Spare leash (in case theirs snaps)");
  });

  it("gracefully ignores corrupted JSON in storage", () => {
    localStorage.setItem("helpr_what_to_bring_job-1", "not-json{{{");
    // Should not throw and should render an empty (unchecked) state
    expect(() =>
      render(<WhatToBringChecklist jobId="job-1" category="assembly" />),
    ).not.toThrow();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const anyCheckbox = screen.getAllByRole("checkbox")[0];
    expect(anyCheckbox).toHaveAttribute("data-state", "unchecked");
  });
});
