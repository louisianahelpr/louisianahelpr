import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SaveBar } from "./SaveBar";

/**
 * VN-40 (owner, 2026-09-14): with nothing changed the bar showed a dead
 * "Up to Date" button and a Cancel with nothing to cancel. It now renders only
 * while dirty, saving, or showing the brief "Saved" confirmation.
 */
const noop = vi.fn();

describe("SaveBar", () => {
  it("renders nothing when there is nothing to save", () => {
    const { container } = render(
      <SaveBar dirty={false} saving={false} justSaved={false} onBack={noop} onSave={noop} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Up to Date/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("offers an enabled Save Changes once something changed", () => {
    render(<SaveBar dirty saving={false} justSaved={false} onBack={noop} onSave={noop} />);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });

  it("stays up while saving and for the Saved confirmation", () => {
    const { rerender } = render(<SaveBar dirty={false} saving justSaved={false} onBack={noop} onSave={noop} />);
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
    rerender(<SaveBar dirty={false} saving={false} justSaved onBack={noop} onSave={noop} />);
    expect(screen.getByRole("button", { name: /Saved/ })).toBeDisabled();
  });
});
