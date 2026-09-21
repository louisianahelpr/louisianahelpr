import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SaveBar } from "./SaveBar";

/**
 * VN-40 (owner, 2026-09-14): with nothing changed the bar showed a dead
 * "Up to Date" button and a Cancel with nothing to cancel. It now renders only
 * while dirty, saving, or showing the brief "Saved" confirmation.
 *
 * Three properties, and the third was missing until 2026-09-21: the bar's
 * VISIBILITY, the in-flight latch in BOTH directions (engaged while saving and
 * during the Saved confirmation, RELEASED once merely dirty), and the fact that
 * the two buttons are WIRED. Without the last one, `onClick` could be deleted
 * off either button and every assertion here stayed green — a Save Changes
 * button that is present, enabled, correctly labelled and does nothing.
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

  it("both buttons are wired — Save Changes saves, Cancel backs out", () => {
    const onSave = vi.fn();
    const onBack = vi.fn();
    render(<SaveBar dirty saving={false} justSaved={false} onBack={onBack} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSave, "Save Changes did not call onSave").toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBack, "Cancel did not call onBack").toHaveBeenCalledTimes(1);
  });

  it("the latch really is released — a dirty Save is clickable, a saving one is not", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <SaveBar dirty saving justSaved={false} onBack={noop} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
    expect(onSave, "a save in flight fired a second save").not.toHaveBeenCalled();
    rerender(<SaveBar dirty saving={false} justSaved={false} onBack={noop} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSave, "the in-flight latch was never released").toHaveBeenCalledTimes(1);
  });
});

// VN-40 itself, plus the wiring of each button.
// @mutate src/components/profile/profileEditForm/SaveBar.tsx | if (!dirty && !saving && !justSaved) return null;
// @mutate src/components/profile/profileEditForm/SaveBar.tsx | onClick={(e) => onSave(e as unknown as React.FormEvent)}
// @mutate src/components/profile/profileEditForm/SaveBar.tsx | onClick={onBack}
