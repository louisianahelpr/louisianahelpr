/**
 * The calendar platform chips are the shared ChoicePill (owner 2026-10-29: "nothing should be
 * hand made"). Behaviour kept: picking a chip sets the platform that Add sends. Semantics: a
 * labelled single choice (radiogroup "Platform", one radio checked), every chip a pill.
 *
 * @mutate src/pages/profile/strSettings/AddCalendarForm.tsx | <ChoicePill key={p} selected={form.platform === p} onClick={() => set("platform", p)}> | <ChoicePill key={p} selected={form.platform === p} onClick={() => set("platform", "airbnb")}>
 * @mutate src/pages/profile/strSettings/AddCalendarForm.tsx | <div role="radiogroup" aria-label="Platform" className="flex flex-wrap gap-2 mt-1.5"> | <div className="flex flex-wrap gap-2 mt-1.5">
 * @mutate src/components/ui/spinner.tsx | { role: "status" as const, "aria-label": label } | { "aria-label": label }
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AddCalendarForm } from "./AddCalendarForm";
import { Spinner } from "@/components/ui/spinner";

describe("calendar platform chips use the shared ChoicePill", () => {
  it("is a labelled radiogroup, one chip checked, and the picked platform is what Add sends", () => {
    const onAdd = vi.fn();
    render(<AddCalendarForm onAdd={onAdd} loading={false} />);
    const group = screen.getByRole("radiogroup", { name: "Platform" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Airbnb", "VRBO", "Booking.com", "Other"]);
    for (const r of radios) expect(r.className).toMatch(/(^|\s)rounded-full(\s|$)/);
    fireEvent.click(within(group).getByRole("radio", { name: "VRBO" }));
    expect(within(group).getByRole("radio", { name: "VRBO" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    fireEvent.change(document.getElementById("ical-url")!, { target: { value: "https://www.vrbo.com/icalendar/abc.ics" } });
    fireEvent.click(screen.getByRole("button", { name: /Connect calendar/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].platform).toBe("vrbo");
  });

  it("the shared Spinner is decorative without a label and a named status with one", () => {
    const { container, rerender } = render(<Spinner className="w-4 h-4" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.getAttribute("class")).toMatch(/animate-spin/);
    rerender(<Spinner label="Saving" />);
    expect(screen.getByRole("status", { name: "Saving" })).toBeInTheDocument();
  });
});
