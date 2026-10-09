/**
 * Owner, 2026-10-09: "I pressed Log Out and nothing happened." The Log Out
 * dialog closed on the press and sign-out then ran with nothing on screen.
 * Pressed, this dialog must stay open, say "Logging Out…", refuse a second
 * press and refuse Escape/Cancel until sign-out has finished.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";

let finish: (r: { error: unknown }) => void = () => {};
const signOutWithPushCleanup = vi.fn(
  (_o?: unknown) => new Promise<{ error: unknown }>((resolve) => { finish = resolve; }),
);
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: (o?: unknown) => signOutWithPushCleanup(o) }));
vi.mock("@/lib/haptics", () => ({
  hapticMedium: vi.fn(), hapticHeavy: vi.fn(), hapticSuccess: vi.fn(), hapticWarning: vi.fn(), hapticError: vi.fn(),
}));

import { SignOutConfirmDialog } from "./SignOutConfirmDialog";

afterEach(() => { cleanup(); signOutWithPushCleanup.mockClear(); });

function Harness({ after }: { after: (r: unknown) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SignOutConfirmDialog open={open} onOpenChange={setOpen} title="Log Out?" description="d" label="Log Out" after={after} />
  );
}

describe("SignOutConfirmDialog", () => {
  it("stays open on a disabled 'Logging Out…' until sign-out finishes, then runs after()", async () => {
    const after = vi.fn();
    render(<Harness after={after} />);
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    const pending = screen.getByRole("button", { name: "Logging Out…" });
    expect(pending).toBeDisabled();
    // Escape and Cancel cannot close it mid-sign-out.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // A second press does nothing.
    fireEvent.click(pending);
    expect(signOutWithPushCleanup).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
    await act(async () => { finish({ error: null }); });
    expect(after).toHaveBeenCalledWith({ error: null });
  });

  it("Cancel still closes it when nothing is pending", () => {
    render(<Harness after={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(signOutWithPushCleanup).not.toHaveBeenCalled();
  });
});

// @mutate src/components/auth/SignOutConfirmDialog.tsx | e.preventDefault(); |
// @mutate src/components/auth/SignOutConfirmDialog.tsx | onOpenChange={(next) => { if (!signingOut) onOpenChange(next); }} | onOpenChange={onOpenChange}
// @mutate src/components/auth/SignOutConfirmDialog.tsx | primaryLabel={signingOut ? "Logging Out…" : label} | primaryLabel={label}
