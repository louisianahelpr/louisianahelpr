import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PetPicker } from "./PetPicker";
import { supabase } from "@/integrations/supabase/client";

/**
 * VN-53 (owner, 2026-09-14): "Which pet is this for?" did not show the pets
 * saved on the pets page. The picker must read the SAME cache entry the pets
 * page invalidates (`["pet_profiles", userId]`) and filter by owner.
 */
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" } }),
}));

const eq = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

const ROWS = [
  { id: "p2", name: "Rex", species: "dog", breed: null, photo_url: null, owner_id: "user-1" },
  { id: "p1", name: "Biscuit", species: "cat", breed: null, photo_url: null, owner_id: "user-1" },
];

beforeEach(() => {
  vi.clearAllMocks();
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (...args: unknown[]) => {
      eq(...args);
      return builder;
    },
    order: () => Promise.resolve({ data: ROWS, error: null }),
  };
  vi.mocked(supabase.from).mockImplementation((() => builder) as unknown as typeof supabase.from);
});

describe("PetPicker", () => {
  it("reads the pets page's own cache entry, filtered by owner", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PetPicker selectedIds={[]} onToggle={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Rex")).toBeInTheDocument());
    expect(eq).toHaveBeenCalledWith("owner_id", "user-1");
    expect(client.getQueryData(["pet_profiles", "user-1"])).toEqual(ROWS);
    // Sorted by name for picking.
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toContain("Biscuit");
  });

  it("shows a pet added on the pets page as soon as that page invalidates", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["pet_profiles", "user-1"], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PetPicker selectedIds={[]} onToggle={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await client.invalidateQueries({ queryKey: ["pet_profiles", "user-1"] });
    await waitFor(() => expect(screen.getByText("Rex")).toBeInTheDocument());
  });
});
