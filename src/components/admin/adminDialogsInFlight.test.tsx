// Admin action dialogs — synchronous in-flight guard on submit.
//
// `busy` is React state, so two clicks dispatched in one frame (both inside
// the same act, no re-render between) both read false and both invoked
// admin-user-actions. Same class and fix as useApplyFlow.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => {
        invokeMock(...args);
        return new Promise(() => {}); // stays in flight
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ManualVerifyDialog } from "./ManualVerifyDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { FormalWarningDialog } from "./FormalWarningDialog";

const profile = { user_id: "u-1", full_name: "Test User" } as never;

function doubleClick(button: HTMLElement) {
  act(() => {
    button.click();
    button.click();
  });
}

describe("admin dialogs — same-frame double click sends one request", () => {
  beforeEach(() => invokeMock.mockReset());

  it("ManualVerifyDialog", () => {
    render(<ManualVerifyDialog profile={profile} onClose={vi.fn()} />);
    doubleClick(screen.getByRole("button", { name: "Manually Verify" }));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("ResetPasswordDialog", () => {
    render(<ResetPasswordDialog profile={profile} onClose={vi.fn()} />);
    const buttons = screen.getAllByRole("button").filter((b) => !/cancel|close/i.test(b.textContent ?? "") && b.textContent);
    doubleClick(buttons[buttons.length - 1]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("FormalWarningDialog", async () => {
    const { container } = render(<FormalWarningDialog profile={profile} onClose={vi.fn()} />);
    const textarea = (container.ownerDocument.querySelector("textarea")) as HTMLTextAreaElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(textarea, { target: { value: "note" } });
    const buttons = screen.getAllByRole("button").filter((b) => !/cancel|close/i.test(b.textContent ?? "") && b.textContent);
    doubleClick(buttons[buttons.length - 1]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
