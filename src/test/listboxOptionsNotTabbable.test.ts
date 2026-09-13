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
 * Known offenders NOT fixed with the DOB change: combobox suggestion popups
 * whose input has no arrow-key model yet, so removing the options' tab stops
 * today would leave them keyboard-unreachable. Each entry must still offend
 * (asserted below), so this list cannot silently rot.
 */
const PENDING = new Set([
  join("src", "components", "dashboard", "browseTasksToolbar", "BrowseSearchBar.tsx"),
  join("src", "components", "postjob", "CityAutocomplete.tsx"),
  join("src", "components", "postjob", "AddressAutocomplete.tsx"),
]);

describe("listbox options are not tab stops", () => {
  it("catches the original DateWheelPicker option", () => {
    const lb = `<div role="listbox" tabIndex={0}>`;
    expect(offenders(`${lb}<button key={v} type="button" role="option" aria-selected={v === value} onClick={() => onChange(v)}>x</button></div>`)).toHaveLength(1);
    expect(offenders(`${lb}<button type="button" role="option" tabIndex={-1} onClick={() => f(v)}>x</button></div>`)).toEqual([]);
    expect(offenders(`${lb}<div role="option" aria-selected>x</div></div>`)).toEqual([]);
    expect(offenders(`${lb}<div role="option" tabIndex={0}>x</div></div>`)).toHaveLength(1);
  });

  it("no tabbable option inside a listbox anywhere in src/", () => {
    const hits: string[] = [];
    const pendingSeen = new Set<string>();
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) {
          const o = offenders(readFileSync(p, "utf8"));
          if (!o.length) continue;
          if (PENDING.has(p)) pendingSeen.add(p);
          else for (const t of o) hits.push(`${p}: ${t}`);
        }
      }
    })("src");
    expect(hits, "give options tabIndex={-1} and key-handle the listbox").toEqual([]);
    expect([...PENDING].filter((p) => !pendingSeen.has(p)), "fixed? remove it from PENDING").toEqual([]);
  });
});
