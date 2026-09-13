/**
 * Keyboard model for the suggestion popups (keyboard audit, 2026-09-12).
 * CityAutocomplete stands in for all three callers of
 * useComboboxKeyboard — the behaviour under test lives entirely in the
 * hook, and driving it through a real caller also proves the wiring.
 *
 * Before this, each option was its own tab stop and there was no arrow
 * model at all: the input advertised role="combobox" + aria-expanded and
 * then offered no way to reach what it had announced.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CityAutocomplete } from "./CityAutocomplete";

function Harness() {
  const [v, setV] = useState("");
  return (
    <>
      <button type="button">before</button>
      <CityAutocomplete value={v} onChange={setV} />
      <button type="button">after</button>
    </>
  );
}

/** Type into the field and open the popup. "new" matches New Iberia, New Orleans, … */
function openPopup(query = "new") {
  render(<Harness />);
  const input = screen.getByLabelText("City");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  return input;
}

const activeText = (input: HTMLElement) => {
  const id = input.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : undefined;
};

describe("suggestion popup keyboard model", () => {
  it("the input is the only tab stop; options are not", () => {
    const input = openPopup();
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    for (const o of options) expect(o.tabIndex).toBe(-1);
    expect((input as HTMLInputElement).tabIndex).toBe(0);
  });

  it("publishes the combobox contract on the input", () => {
    const input = openPopup();
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    // Nothing active until the user arrows — the field is still a textbox.
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("ArrowDown / ArrowUp move the active option and wrap", () => {
    const input = openPopup();
    const labels = screen.getAllByRole("option").map((o) => o.textContent);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeText(input)).toBe(labels[0]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeText(input)).toBe(labels[1]);

    // Wrap forwards past the last option, back to the first.
    for (let i = 1; i < labels.length; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeText(input)).toBe(labels[0]);

    // Wrap backwards past the first, to the last.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeText(input)).toBe(labels[labels.length - 1]);
  });

  it("the active option is the one marked selected and highlighted", () => {
    const input = openPopup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = screen.getAllByRole("option").filter((o) => o.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("aria-selected")).toBe("true");
    expect(active[0].id).toBe(input.getAttribute("aria-activedescendant"));
    expect(screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("Enter selects the active option", () => {
    const input = openPopup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const picked = activeText(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe(picked);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter with nothing active does not select", () => {
    const input = openPopup();
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("new");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("Escape closes the popup and keeps focus on the input", () => {
    const input = openPopup();
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input).toHaveAttribute("aria-expanded", "false");
    // The query the user was refining survives (a bare <input type="search">
    // would have cleared itself).
    expect((input as HTMLInputElement).value).toBe("new");
  });

  it("Tab closes the popup without trapping focus", () => {
    const input = openPopup();
    const ev = fireEvent.keyDown(input, { key: "Tab" });
    // fireEvent returns false when a handler called preventDefault.
    expect(ev).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("a changed result set clears the active option", () => {
    const input = openPopup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant");
    fireEvent.change(input, { target: { value: "new o" } });
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("clicking an option still works exactly as before", () => {
    const input = openPopup();
    const opt = screen.getAllByRole("option")[1];
    const label = opt.textContent;
    fireEvent.mouseDown(opt);
    fireEvent.click(opt);
    expect((input as HTMLInputElement).value).toBe(label);
  });
});
