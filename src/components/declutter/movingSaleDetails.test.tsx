/**
 * Q2269: the seller names the sale and picks its start on the move page; Save sends both (blank clears).
 *
 * @mutate src/components/declutter/DeclutterMovingSaleDetails.tsx |     mutationFn: () => setMovingSale(name.trim(), startsOn \|\| null), |     mutationFn: () => setMovingSale(name, null),
 * @mutate src/components/declutter/DeclutterMovingSaleDetails.tsx |     setName(mine.data.saleName ?? ""); |
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sent: unknown[][] = [];
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/lib/declutter/moves", () => ({
  setMovingSale: async (...a: unknown[]) => { sent.push(a); return 2; },
  // The seller's own saved values (drafts too), never the public reader.
  fetchMyMovingSale: async () => ({ saleName: "Old name", startsOn: null }),
}));

import { MovingSaleDetails } from "./DeclutterMovingSaleDetails";

describe("Q2269 sale details on the move page", () => {
  it("starts from what buyers see, and saves the trimmed name with the start date", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MovingSaleDetails userId="s1" moveOutOn="2026-11-01" today="2026-10-20" /></QueryClientProvider>);
    const name = screen.getByLabelText(/Sale name/);
    await waitFor(() => expect(name).toHaveValue("Old name"));
    fireEvent.change(name, { target: { value: "  Moving to Lafayette · everything goes  " } });
    fireEvent.change(screen.getByLabelText(/Sale starts/), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sale details" }));
    await waitFor(() => expect(sent).toEqual([["Moving to Lafayette · everything goes", "2026-10-30"]]));
  });
});
