import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { RecipientPicker } from "./RecipientPicker";

const rpcResult = {
  data: [] as Array<{ user_id: string; full_name: string | null; avatar_url: string | null }>,
  error: null as { message: string } | null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
  },
}));

function Harness(props: Partial<React.ComponentProps<typeof RecipientPicker>> = {}) {
  return (
    <RecipientPicker
      selected={null}
      onSelect={vi.fn()}
      onClearSelected={vi.fn()}
      mode="search"
      onModeChange={vi.fn()}
      emailValue=""
      onEmailChange={vi.fn()}
      emailValid={false}
      isSelfGiftEmail={false}
      {...props}
    />
  );
}

// The picker is now a single smart input that auto-detects a name query vs
// an email address from the text itself (no more mode toggle), so every
// test drives the one `Recipient — name or email` field.
describe("RecipientPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcResult.data = [];
    rpcResult.error = null;
  });

  it("does not search below the minimum query length", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "a" },
    });
    await new Promise((r) => setTimeout(r, 350));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/Keep typing/)).toBeInTheDocument();
  });

  it("searches (debounced) once the query reaches the minimum length and renders results", async () => {
    rpcResult.data = [{ user_id: "u1", full_name: "Jamie B.", avatar_url: null }];
    const { supabase } = await import("@/integrations/supabase/client");
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "Jamie" },
    });

    await waitFor(
      () => {
        expect(supabase.rpc).toHaveBeenCalledWith("search_profiles_by_name", { query: "Jamie" });
      },
      { timeout: 1000 },
    );
    await waitFor(() => expect(screen.getByText("Jamie B.")).toBeInTheDocument());
  });

  it("selecting a result invokes onSelect with only user_id/full_name/avatar_url", async () => {
    rpcResult.data = [{ user_id: "u2", full_name: "Alex T.", avatar_url: null }];
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "Alex" },
    });
    await waitFor(() => expect(screen.getByText("Alex T.")).toBeInTheDocument(), {
      timeout: 1000,
    });
    fireEvent.click(screen.getByText("Alex T."));
    expect(onSelect).toHaveBeenCalledWith({ user_id: "u2", full_name: "Alex T.", avatar_url: null });
  });

  it("shows the selected recipient chip and clears it on request", () => {
    const onClear = vi.fn();
    render(
      <Harness
        selected={{ user_id: "u3", full_name: "Casey L.", avatar_url: null }}
        onClearSelected={onClear}
      />,
    );
    expect(screen.getByText("Casey L.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear selected recipient"));
    expect(onClear).toHaveBeenCalled();
  });

  it("routes text containing an email shape to the email path and validates it", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const onEmailChange = vi.fn();
    const onModeChange = vi.fn();
    render(<Harness onEmailChange={onEmailChange} onModeChange={onModeChange} emailValid={false} />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "notanemail@" },
    });
    expect(onModeChange).toHaveBeenCalledWith("email");
    expect(onEmailChange).toHaveBeenCalledWith("notanemail@");
    // Name search never fires once the text looks like an email.
    await new Promise((r) => setTimeout(r, 350));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("shows validation copy for an invalid but email-shaped address", () => {
    render(<Harness mode="email" emailValue="notanemail@x" emailValid={false} />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "notanemail@x" },
    });
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("shows the self-gift warning under an email typed by the sender themself", () => {
    render(<Harness mode="email" emailValue="me@example.com" emailValid isSelfGiftEmail />);
    fireEvent.change(screen.getByLabelText("Recipient — name or email"), {
      target: { value: "me@example.com" },
    });
    expect(screen.getByText("You can't send a gift to yourself.")).toBeInTheDocument();
  });
});
