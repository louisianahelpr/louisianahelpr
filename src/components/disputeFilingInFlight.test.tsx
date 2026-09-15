// DisputeDialog — a same-frame double submit files ONE dispute.
//
// `submitting` is React state, so it does not land until the next render: two
// clicks inside one JS task both got past it and both called
// `rpc_open_dispute`. The second blocked on that RPC's FOR UPDATE, then took
// its existing-dispute branch and appended the SAME evidence urls a second
// time — every photo stored twice, and `evidence_urls` growing on each retry.
//
// The database is set-like about that now (open_dispute_as, 20260915034822)
// and that is the guarantee. This is the other half: a synchronous ref so the
// second call is never made, matching the guard Apply Now, hire, review, tip
// and the admin dispute actions already carry.
//
// RED with `submittingRef` removed from DisputeDialog: 2 rpc calls. GREEN: 1.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";

// jsdom has no layout, and Radix Select's open effect calls all three. Stubbed
// here rather than in the shared setup so no other lane's suite changes.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
Element.prototype.releasePointerCapture = vi.fn() as never;

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // Never resolves: the first submit stays in flight for the whole test, so
    // a second call could only come from a missing guard — not from a retry.
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return new Promise(() => {});
    },
    auth: { getUser: async () => ({ data: { user: { id: "poster-1" } } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    from: () => ({ update: () => ({ eq: () => ({ in: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticHeavy: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
// Radix Select needs pointer geometry jsdom does not have. Swapped for plain
// buttons: what is under test is the submit guard, not the picker.
vi.mock("@/components/ui/select", () => {
  let onChange: ((v: string) => void) | null = null;
  return {
    Select: ({ children, onValueChange }: never) => { onChange = onValueChange; return children; },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: never) => children,
    SelectItem: ({ value, children }: never) => (
      <button type="button" data-reason={value} onClick={() => onChange?.(value)}>{children}</button>
    ),
  };
});

import { DisputeDialog } from "./DisputeDialog";
import { disputeReasonsFor, DISPUTE_DETAILS_MIN } from "./disputeReasons";

const QueryClientProviderWrap = ({ children }: { children: React.ReactNode }) => children;
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

describe("DisputeDialog — same-frame double submit files one dispute", () => {
  beforeEach(() => rpcMock.mockReset());

  it("two clicks in one task send exactly one rpc_open_dispute", async () => {
    render(
      <QueryClientProviderWrap>
        <DisputeDialog
          jobId="job-1"
          side="poster"
          open
          onClose={() => {}}
          onDisputed={() => {}}
        />
      </QueryClientProviderWrap>,
    );

    // Pick the first reason and write enough detail to clear the floor.
    const reason = disputeReasonsFor("poster")[0];
    const option = document.querySelector(`[data-reason="${reason.value}"]`) as HTMLElement;
    await act(async () => { fireEvent.click(option); });

    const details = screen.getByRole("textbox") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(details, "x".repeat(DISPUTE_DETAILS_MIN + 20));
      details.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = await screen.findByRole("button", { name: /submit|file|open/i });
    act(() => {
      submit.click();
      submit.click();
    });

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock.mock.calls.filter((c) => c[0] === "rpc_open_dispute")).toHaveLength(1);
  });
});
