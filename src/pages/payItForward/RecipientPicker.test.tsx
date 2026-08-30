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

function Harness() {
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
    />
  );
}

describe("RecipientPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcResult.data = [];
    rpcResult.error = null;
  });

  it("does not search below the minimum query length", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search for a recipient by name"), {
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
    fireEvent.change(screen.getByLabelText("Search for a recipient by name"), {
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
    render(
      <RecipientPicker
        selected={null}
        onSelect={onSelect}
        onClearSelected={vi.fn()}
        mode="search"
        onModeChange={vi.fn()}
        emailValue=""
        onEmailChange={vi.fn()}
        emailValid={false}
        isSelfGiftEmail={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search for a recipient by name"), {
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
      <RecipientPicker
        selected={{ user_id: "u3", full_name: "Casey L.", avatar_url: null }}
        onSelect={vi.fn()}
        onClearSelected={onClear}
        mode="search"
        onModeChange={vi.fn()}
        emailValue=""
        onEmailChange={vi.fn()}
        emailValid={false}
        isSelfGiftEmail={false}
      />,
    );
    expect(screen.getByText("Casey L.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear selected recipient"));
    expect(onClear).toHaveBeenCalled();
  });

  it("email mode renders the typed-email fallback with validation copy", () => {
    render(
      <RecipientPicker
        selected={null}
        onSelect={vi.fn()}
        onClearSelected={vi.fn()}
        mode="email"
        onModeChange={vi.fn()}
        emailValue="notanemail"
        onEmailChange={vi.fn()}
        emailValid={false}
        isSelfGiftEmail={false}
      />,
    );
    expect(screen.getByLabelText("Recipient's email")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });
});
