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
