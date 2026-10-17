/**
 * The haul-away pieces on My listings (docs/specs/declutter-haul-away.md):
 * what each server state renders, in plain words, and where each tap goes.
 * Pure components (no Supabase); the backend proof is
 * src/test/pglite/declutterHaulAway.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |   if (group.length === 0) return null; |   if (false) return null;
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |         <Link to={haulAwayPostJobPath(group.map((r) => r.item_id))}> |         <Link to={haulAwayPostJobPath(group.slice(0, 1).map((r) => r.item_id))}>
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |       <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onPutBack(row)}> |       <Button type="button" size="sm" variant="outline" disabled={pending}>
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |   if (row.state === "paying") { |   if (false) {
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |   if (row?.state !== "unpaid") return null; |   if (!row) return null;
 * @mutate src/components/declutter/DeclutterHaulAway.tsx | onClick={() => onFinishBooking(row)}>\n        Finish booking | onClick={() => onFinishBooking(row)}>\n        Book it again
 * @mutate src/components/declutter/DeclutterHaulAway.tsx | Finish booking, or put the item back on sale. | Book it again, or put the item back on sale.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HaulAwayCard, HaulAwayItemActions, HaulAwayItemLine } from "./DeclutterHaulAway";
import type { HaulAwayRow } from "@/lib/declutter/haulAway";

const row = (over: Partial<HaulAwayRow>): HaulAwayRow => ({
  item_id: "i1",
  title: "Oak rocking chair",
  description: "",
  delivery_size: "large",
  item_status: "live",
  state: "eligible",
  eligible_at: null,
  job_id: null,
  pickup_group: "g",
  photo_paths: [],
  job_hold: null,
  ...over,
});
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("HaulAwayCard", () => {
  it("renders nothing with no items", () => {
    const { container } = wrap(<HaulAwayCard group={[]} />);
    expect(container.textContent).toBe("");
  });
  it("one tap opens Post a Job pre-filled with every item of the trip", () => {
    wrap(<HaulAwayCard group={[row({ item_id: "i1" }), row({ item_id: "i2" })]} />);
    expect(screen.getByText("2 items haven't sold")).toBeTruthy();
    expect(screen.getByText(/donation, or the dump/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Book a haul-away for 2 items" });
    expect(link.getAttribute("href")).toBe("/post-job?haulAway=i1,i2");
  });
  it("one item reads in the singular", () => {
    wrap(<HaulAwayCard group={[row({})]} />);
    expect(screen.getByText("1 item hasn't sold")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book a haul-away" })).toBeTruthy();
  });
});

describe("HaulAwayItemLine", () => {
  it("booked: says so and links the job", () => {
    wrap(<HaulAwayItemLine row={row({ state: "booked", job_id: "j9" })} />);
    expect(screen.getByText(/A Helpr is booked to haul this away/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the job" }).getAttribute("href")).toBe("/jobs/j9");
  });
  it("unpaid: says so, and the action row offers finish booking or put it back on sale", () => {
    const onPutBack = vi.fn();
    const onFinishBooking = vi.fn();
    const r = row({ state: "unpaid", item_id: "i7", job_id: "j1" });
    wrap(
      <>
        <HaulAwayItemLine row={r} />
        <HaulAwayItemActions row={r} onFinishBooking={onFinishBooking} onPutBack={onPutBack} pending={false} />
      </>,
    );
    expect(screen.getByText(/isn't booked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish booking" }));
    expect(onFinishBooking).toHaveBeenCalledWith(r);
    fireEvent.click(screen.getByRole("button", { name: "Put back on sale" }));
    expect(onPutBack).toHaveBeenCalledWith(r);
  });
  it("paying: a checkout is open; no buttons (nothing may be undone while it can be paid)", () => {
    wrap(
      <>
        <HaulAwayItemLine row={row({ state: "paying" })} />
        <HaulAwayItemActions row={row({ state: "paying" })} onFinishBooking={vi.fn()} onPutBack={vi.fn()} pending={false} />
      </>,
    );
    expect(screen.getByText(/checkout for this haul-away is still open/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("hauled: says so and links the job", () => {
    wrap(<HaulAwayItemLine row={row({ state: "hauled", job_id: "j2" })} />);
    expect(screen.getByText(/A Helpr hauled this away/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the job" }).getAttribute("href")).toBe("/jobs/j2");
  });
  it("too soon: says how many days", () => {
    const at = new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString();
    wrap(<HaulAwayItemLine row={row({ state: "too_soon", eligible_at: at })} />);
    expect(screen.getByText("Not selling? In 3 days you can have a Helpr haul it away.")).toBeTruthy();
  });
  it("eligible, in a sale, booked, hauled or no row: no extra buttons; eligible / in a sale / no row: no line either", () => {
    for (const r of [row({ state: "eligible" }), row({ state: "in_sale" }), row({ state: "booked" }), row({ state: "hauled" }), undefined]) {
      const { container, unmount } = wrap(<HaulAwayItemActions row={r} onFinishBooking={vi.fn()} onPutBack={vi.fn()} pending={false} />);
      expect(container.textContent).toBe("");
      unmount();
    }
    for (const r of [row({ state: "eligible" }), row({ state: "in_sale" }), undefined]) {
      const { container, unmount } = wrap(<HaulAwayItemLine row={r} />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});

describe("the unpaid listing's words are the spec's (re-review 2026-10-17 #5)", () => {
  it('the buttons and the line say "Finish booking" / "Put back on sale", as docs/specs/declutter-haul-away.md does', () => {
    const spec = readFileSync(join(process.cwd(), "docs/specs/declutter-haul-away.md"), "utf8");
    expect(spec).toContain('("Finish booking" / "Put back on sale")');
    expect(spec).not.toContain("Book it again");
    const r = row({ state: "unpaid", job_id: "j1", job_hold: "job_open" });
    wrap(
      <>
        <HaulAwayItemLine row={r} />
        <HaulAwayItemActions row={r} onFinishBooking={vi.fn()} onPutBack={vi.fn()} pending={false} />
      </>,
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Finish booking", "Put back on sale"]);
    expect(screen.getByText("Off sale for a haul-away that isn't booked. Finish booking, or put the item back on sale.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Book it again/);
  });
});
