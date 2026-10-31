/**
 * AUD31-10 (Declutter delivery audit 10-31): the Deliver page said "3 deliveries are waiting." while the Busy right now
 * card under it said "No deliveries are waiting right now.": the card turns rows into parishes (busyAreas) and dropped
 * the ones whose area names none (prod's helpr_tasks.pickup_area "Mid City", read-only 10-31). Those are counted as
 * elsewhere and said, so the card never says none while rows wait.
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |       {top.length === 0 && summary.elsewhere === 0 ? ( |       {top.length === 0 ? (
 * @mutate src/components/busyAreas/BusyAreasCard.tsx |           {summary.elsewhere > 0 && ( |           {false && (
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));

import { BusyAreasCard } from "./BusyAreasCard";

describe("Busy right now never says none while deliveries wait (AUD31-10)", () => {
  it("rows whose area names no parish are said as not on the map, not dropped", () => {
    render(<BusyAreasCard deliveries={[{ pickup_area: "Mid City", open_count: 3 }]} />);
    expect(screen.queryByText("No deliveries are waiting right now.")).toBeNull();
    expect(screen.getByText("3 deliveries in areas not on the map")).toBeInTheDocument();
  });
  it("placed rows list their parish, and the rest are counted after them", () => {
    render(<BusyAreasCard deliveries={[{ pickup_area: "Downtown, Baton Rouge", open_count: 2 }, { pickup_area: "Mid City", open_count: 1 }]} />);
    expect(screen.getByText("1 more in areas not on the map")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
  });
  it("no rows: none waiting", () => {
    render(<BusyAreasCard deliveries={[]} />);
    expect(screen.getByText("No deliveries are waiting right now.")).toBeInTheDocument();
  });
});
