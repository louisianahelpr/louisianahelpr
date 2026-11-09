// @mutate src/components/declutter/DeliverVehicleForm.tsx |   const saveHint = vehicle.isLoading ? null : !hasCar && !savedCar ? "Tick car or truck to save." : needsTruckPhoto ? "Add a photo of your truck to save." : null; |   const saveHint = null as string \| null;
/**
 * F129 (UI audit 11-09): Deliver's "Your vehicle" Save was greyed with no hint why. Nothing ticked says "Tick car or
 * truck to save."; a truck with no photo says to add one; once it can save, no hint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const vehicle = vi.hoisted(() => ({ row: null as unknown }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchMyVehicle: async () => vehicle.row,
  saveVehicle: async () => undefined,
  uploadVehiclePhoto: async () => "p",
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
import { VehicleForm } from "@/components/declutter/DeliverVehicleForm";

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><VehicleForm userId="u1" /></QueryClientProvider>);
}

afterEach(() => { cleanup(); vehicle.row = null; });

describe("F129: a greyed vehicle Save says why", () => {
  it("nothing ticked: Save is greyed and says 'Tick car or truck to save.'; ticking a car clears it", async () => {
    open();
    const hint = await screen.findByText("Tick car or truck to save.");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save.getAttribute("aria-describedby")).toBe(hint.id);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.queryByText("Tick car or truck to save.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("a truck with no photo says to add one", async () => {
    open();
    await screen.findByText("Tick car or truck to save.");
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("Add a photo of your truck to save.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
