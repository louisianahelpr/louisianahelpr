/**
 * An option inside a listbox must not be its own tab stop (keyboard audit,
 * 2026-09-12). The DOB DateWheelPicker rendered each option as a tabbable
 * <button>; Tab focused one, the column scroll-snapped to it, and the scroll
 * handler adopted it as the value — two Tab presses moved 2008 -> 1906. Per
 * WAI-ARIA the listbox is the single tab stop and options carry tabIndex=-1.
 *
 * Flags every natively-tabbable (<button>/<a>) or tabIndex=0 role="option"
 * element in a file that also renders role="listbox", unless it carries
 * tabIndex={-1}.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { DateWheelPicker } from "@/components/DateWheelPicker";

function offenders(raw: string): string[] {
  // Prose that merely names the pattern (e.g. a history comment) is not code.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (!/role=["']listbox["']/.test(src)) return [];
  const out: string[] = [];
  // Opening tags; `=>` is allowed inside so arrow-function props don't end the tag.
  for (const m of src.matchAll(/<(button|a|div|li|span)\b(?:=>|[^<>])*>/gs)) {
    const tag = m[0];
    if (!/role=["']option["']/.test(tag)) continue;
    if (/tabIndex=\{\s*-1\s*\}/.test(tag)) continue;
    const natural = m[1] === "button" || m[1] === "a";
    if (natural || /tabIndex=(\{\s*0\s*\}|["']0["'])/.test(tag)) out.push(tag.replace(/\s+/g, " ").slice(0, 100));
  }
  return out;
}

/**
 * A listbox popup is only reachable by keyboard if its INPUT carries the
 * combobox contract. Flags any file that renders a listbox whose combobox
 * input is missing a piece of it. `aria-activedescendant` is the tell that
 * an arrow-key model exists at all — without it there is no active option
 * to publish. The three suggestion popups (Browse search, City, Address)
 * all shipped `role="combobox"` + `aria-expanded` with none of it, so a
 * screen reader announced a popup the user could not move through; they
 * now share src/hooks/useComboboxKeyboard.ts.
 *
 * A file may satisfy this by spreading the shared hook's props rather than
 * writing the attributes inline, so the hook's own name counts as proof.
 */
const COMBOBOX_HOOK = "useComboboxKeyboard";
/** Types you can type a query into. `time`/`date`/`file`/... cannot host a typeahead. */
const TEXT_ENTRY_TYPES = /^(text|search|tel|email|url)$/;

function hasTextEntryInput(src: string): boolean {
  for (const m of src.matchAll(/<[Ii]nput\b(?:=>|[^<>])*>/gs)) {
    const type = /\btype=["']([a-z]+)["']/.exec(m[0]);
    if (!type || TEXT_ENTRY_TYPES.test(type[1])) return true;
  }
  return false;
}

const COMBOBOX_ATTRS = [
  'role="combobox"',
  "aria-expanded",
  "aria-controls",
  "aria-activedescendant",
] as const;

function missingComboboxContract(raw: string): string[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (!/role=["']listbox["']/.test(src)) return [];
  if (src.includes(COMBOBOX_HOOK)) return [];
  // Scope is keyed on there being a TEXT-ENTRY field beside the listbox,
  // not on role="combobox": a popup that simply forgot the role is the very
  // case this must catch (BrowseSearchBar had exactly that shape). A
  // standalone listbox widget — the DOB wheel, TimePickerWheel's scroll
  // column beside its desktop `<input type="time">` — is a different
  // pattern and out of scope.
  if (!hasTextEntryInput(src)) return [];
  return COMBOBOX_ATTRS.filter((a) => !src.includes(a));
}

describe("listbox options are not tab stops", () => {
  it("catches the original DateWheelPicker option", () => {
    const lb = `<div role="listbox" tabIndex={0}>`;
    expect(offenders(`${lb}<button key={v} type="button" role="option" aria-selected={v === value} onClick={() => onChange(v)}>x</button></div>`)).toHaveLength(1);
    expect(offenders(`${lb}<button type="button" role="option" tabIndex={-1} onClick={() => f(v)}>x</button></div>`)).toEqual([]);
    expect(offenders(`${lb}<div role="option" aria-selected>x</div></div>`)).toEqual([]);
    expect(offenders(`${lb}<div role="option" tabIndex={0}>x</div></div>`)).toHaveLength(1);
  });

  it("catches a combobox popup with no arrow-key model", () => {
    const noModel = `<input role="combobox" aria-expanded={open} aria-controls={id} /><ul role="listbox" />`;
    expect(missingComboboxContract(noModel)).toEqual(["aria-activedescendant"]);
    expect(missingComboboxContract(`${noModel}useComboboxKeyboard(`)).toEqual([]);
    // A popup that never declared the role at all is the worst case, not an
    // exemption — every attribute is reported.
    expect(missingComboboxContract(`<input /><ul role="listbox" />`)).toHaveLength(4);
    // Standalone listbox widgets: no field at all, or a non-text one.
    expect(missingComboboxContract(`<div role="listbox" />`)).toEqual([]);
    expect(missingComboboxContract(`<Input type="time" /><div role="listbox" />`)).toEqual([]);
  });

  it("no tabbable option inside a listbox anywhere in src/", () => {
    const hits: string[] = [];
    const contractGaps: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) {
          const raw = readFileSync(p, "utf8");
          const gaps = missingComboboxContract(raw);
          if (gaps.length) contractGaps.push(`${p}: missing ${gaps.join(", ")}`);
          for (const t of offenders(raw)) hits.push(`${p}: ${t}`);
        }
      }
    })("src");
    expect(hits, "give options tabIndex={-1} and key-handle the listbox").toEqual([]);
    expect(contractGaps, `use ${COMBOBOX_HOOK} — a listbox popup needs an arrow-key model`).toEqual([]);
  });
});

/**
 * THE ORIGINAL DEFECT, IN THE RENDERED DOM.
 *
 * The sweep above reads source text, so it can only catch the shapes a regex
 * knows how to spell: it would miss an option rendered through a wrapper
 * component, or a `tabIndex` computed at runtime. The widget the defect
 * actually happened on is cheap to mount, so mount it and ask the browser's
 * own answer — `el.tabIndex`, which resolves whatever the JSX did.
 *
 * Two Tab presses on this control moved a user's date of birth from 2008 to
 * 1906 (keyboard audit, 2026-09-12): each option was a natively-focusable
 * <button>, Tab focused one, the column scroll-snapped to it, and the scroll
 * handler adopted it as the value. Per WAI-ARIA the listbox is the single tab
 * stop and every option carries tabIndex=-1.
 */
describe("the DOB wheel, rendered", () => {
  it("makes the listbox the only tab stop and every option unreachable by Tab", () => {
    cleanup();
    render(
      createElement(DateWheelPicker, {
        value: "2000-06-15",
        onChange: () => {},
        minDate: new Date(1920, 0, 1),
        maxDate: new Date(2008, 11, 31),
      }),
    );

    const listboxes = screen.getAllByRole("listbox");
    expect(
      listboxes.length,
      "the DOB wheel rendered no listbox at all — this assertion is looking at nothing",
    ).toBe(3); // month / day / year

    for (const lb of listboxes) {
      expect(
        (lb as HTMLElement).tabIndex,
        `the ${lb.getAttribute("aria-label")} column is not a tab stop, so the wheel is ` +
          `unreachable by keyboard`,
      ).toBe(0);
      expect(
        lb.getAttribute("aria-activedescendant"),
        `the ${lb.getAttribute("aria-label")} column publishes no active option, so there ` +
          `is no arrow-key model for a screen reader to follow`,
      ).toBeTruthy();
    }

    const options = screen.getAllByRole("option");
    expect(
      options.length,
      "no options rendered — an empty sweep would pass this vacuously",
    ).toBeGreaterThan(30);

    const tabbable = options
      .filter((o) => (o as HTMLElement).tabIndex !== -1)
      .map((o) => `${o.tagName.toLowerCase()} "${o.textContent}" tabIndex=${(o as HTMLElement).tabIndex}`);
    expect(
      tabbable,
      "options inside a listbox are tab stops. Tab moves focus to one, the column " +
        "scroll-snaps to it, and the scroll handler adopts it as the value — this is how " +
        "two Tab presses moved a date of birth from 2008 to 1906. Give every option " +
        "tabIndex={-1} and leave the keys to the listbox.",
    ).toEqual([]);
  });
});

// The original defect, restored: the option <button> is natively focusable
// again, so Tab walks into the wheel and silently rewrites the user's date of
// birth. Killed by BOTH the rendered-DOM assertion above (el.tabIndex) and the
// source sweep.
// @mutate src/components/DateWheelPicker.tsx | role="option"\n          tabIndex={-1} | role="option"
