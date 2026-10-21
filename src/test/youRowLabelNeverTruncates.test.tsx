/**
 * Q2306 (board 18): at 375 the You list cut "Notifications" to "Notificat…" because the row label was
 * `flex-1 min-w-0 truncate` and its caption ("What we tell you, and how") `shrink-0`, so the caption kept
 * its width and the label gave way. Measured 2026-10-21 at 375 on the test account: label scrollWidth 99 >
 * clientWidth 81 (~/.lh-shots/shell4-you-row-fit/before-you-375-*.png).
 *
 * CLASS RULE, for EVERY row the You list can draw (the app's own inventory: YOU_ROWS plus ADMIN_ROW, never a
 * hand list): the label never shrinks or truncates (shrink-0, nowrap, no truncate / flex-1 / min-w-0), and
 * its caption is the one that gives way (flex-1 min-w-0 truncate, never shrink-0). jsdom cannot measure, so
 * this pins the classes; the 375 measurement (label scrollWidth <= clientWidth for every row) is in the
 * Q2306 shots run.
 *
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | className="shrink-0 whitespace-nowrap text-ds-15 font-semibold text-foreground" title={row.label} | className="flex-1 min-w-0 text-ds-15 font-semibold text-foreground truncate" title={row.label}
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | className={`flex-1 min-w-0 truncate text-right text-ds-13 | className={`shrink-0 text-ds-13
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | shrink-0 whitespace-nowrap text-ds-15 | whitespace-nowrap text-ds-15
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ADMIN_ROW, YOU_ROWS, YOU_STATIC_CAPTIONS, YouMenuList } from "@/components/profile/profileLanding/YouMenu";

/** Every row the list can draw, from the component's own exports. */
const INVENTORY = [...YOU_ROWS, ADMIN_ROW];

function classes(el: Element | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("Q2306: every You row's label reads in full; its caption gives way", () => {
  // A caption on EVERY row (the static ones, a long money line, and one for Admin), so each row is judged.
  const captions = Object.fromEntries(
    INVENTORY.map((r) => [r.key, YOU_STATIC_CAPTIONS[r.key as keyof typeof YOU_STATIC_CAPTIONS] ?? `A long caption for ${r.label}, long enough to crowd it`]),
  );
  // Rendered inside each test: Testing Library unmounts after every test.
  const draw = () => render(<YouMenuList captions={captions} showAdmin onSelect={() => {}} />).container;

  it("draws every row of the inventory, and nothing outside it", () => {
    const drawn = [...draw().querySelectorAll("button[data-you-row]")];
    expect(INVENTORY.length).toBeGreaterThan(4);
    expect(drawn.map((b) => b.getAttribute("data-you-row")).sort()).toEqual(INVENTORY.map((r) => r.key).sort());
  });

  it.each(INVENTORY.map((r) => [r.key, r.label] as const))("%s: the label never shrinks or truncates; the caption truncates first", (key, label) => {
    const row = draw().querySelector(`button[data-you-row="${key}"]`);
    expect(row).not.toBeNull();
    // Found by its text, not by a class or data hook, so an old markup is judged too.
    const labelEl = [...(row?.querySelectorAll("span") ?? [])].find((s) => s.textContent === label && s.children.length === 0) ?? null;
    expect(labelEl, `${key}: no label span reading "${label}"`).not.toBeNull();
    const lc = classes(labelEl);
    expect(lc, `${key} label must not shrink`).toContain("shrink-0");
    expect(lc, `${key} label must not wrap into the caption`).toContain("whitespace-nowrap");
    for (const bad of ["truncate", "flex-1", "min-w-0", "overflow-hidden", "text-ellipsis"]) {
      expect(lc, `${key} label carries ${bad}`).not.toContain(bad);
    }
    const capEl = row?.querySelector("[data-you-caption]") ?? null;
    expect(capEl, `${key}: caption not drawn`).not.toBeNull();
    const cc = classes(capEl);
    expect(cc, `${key} caption must give way`).not.toContain("shrink-0");
    for (const need of ["flex-1", "min-w-0", "truncate"]) expect(cc, `${key} caption lacks ${need}`).toContain(need);
  });
});
