// Q248 — the W-9 consent checkbox was a raw `<input type="checkbox">` wrapped
// in a `<label>`, so it never got the app's shared Radix control (44px HIG
// touch target CSS, checked-state gloss, keyboard/AT semantics screen readers
// expect from `role="checkbox"`). Same class of fix as ApplyConfirmDialog's
// "save as my default pitch" box and SignupStep1's policies checkbox.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import W9CollectionDialog from "./W9CollectionDialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }) },
}));

const noop = () => {};

describe("W9CollectionDialog consent checkbox is the shared accessible control (Q248)", () => {
  it("exposes an accessible checkbox role with a real name, not a raw native input", () => {
    render(
      <W9CollectionDialog open jobId="job-1" helperId="helper-1" onOpenChange={noop} />,
    );
    const box = screen.getByRole("checkbox", { name: /this typed signature is my legal signature/i });
    expect(box).toHaveAttribute("data-state", "unchecked");
    // Shared Radix control, not a native input — see ApplyConfirmDialog.test.tsx
    // for why this matters: index.css forces a 44px HIG minimum on
    // `input[type="checkbox"]` that would override the designed control.
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
