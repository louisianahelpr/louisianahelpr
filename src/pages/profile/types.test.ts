import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTab, TAB_TITLES, type Tab } from "./types";
import { wrappedSeasonLabel } from "@/lib/format";

describe("resolveTab", () => {
  // `searchParams.get("tab") as Tab` accepted any string, no panel matched it,
  // and /profile rendered nav chrome over an empty content area — no heading,
  // no error. Measured before the fix: /profile?tab=posted_jobs produced 70
  // characters of body text and zero <h1>. After: the landing tab, 1450 chars.
  it("falls back to landing for an unknown tab", () => {
    expect(resolveTab("posted_jobs")).toBe("landing");
    expect(resolveTab("bogus_tab_xyz")).toBe("landing");
    expect(resolveTab("")).toBe("landing");
    expect(resolveTab(null)).toBe("landing");
    expect(resolveTab(undefined)).toBe("landing");
  });

  // F096 (owner UI audit 11-09): an old or guessed tab name opens the page that now holds it, not the You page.
  // @mutate src/pages/profile/types.ts |   privacy: "settings", |   privacy_x: "settings",
  it("F096: old tab names open the page that holds them now", () => {
    expect(resolveTab("privacy")).toBe("settings");
    expect(resolveTab("payouts")).toBe("earnings");
    expect(resolveTab("gift-cards")).toBe("gift_card");
    expect(resolveTab("gift_cards")).toBe("gift_card");
    expect(resolveTab("completed_jobs")).toBe("work_record");
    // An inherited object key is not a tab name.
    expect(resolveTab("constructor")).toBe("landing");
  });

  it("passes through every real tab", () => {
    const all: Tab[] = [...(Object.keys(TAB_TITLES) as Exclude<Tab, "landing">[]), "landing"];
    expect(all.length, "floor (Q1073, 2026-10-07)").toBeGreaterThan(15);
    for (const tab of all) expect(resolveTab(tab)).toBe(tab);
  });

  // Guards the derivation: a tab added to TAB_TITLES is automatically
  // resolvable, so the valid set can never drift from the union again.
  it("derives its valid set from TAB_TITLES", () => {
    for (const key of Object.keys(TAB_TITLES)) expect(resolveTab(key)).toBe(key);
  });
});

describe("TAB_TITLES.wrapped", () => {
  // THE DRIFT THIS GUARDS. `TAB_TITLES.wrapped` was the literal "Helpr
  // Wrapped" while HelprWrapped's own <h1> rendered `Your ${SEASON.title}` —
  // "Your 2026 so far". The tab therefore had two names: the loading header
  // and `document.title` said one, the loaded screen said the other, in the
  // same box one frame apart. The justification on record was that SEASON is
  // "computed inside the lazy chunk" and so unreachable from the registry.
  // That was false — only the BINDING is in the chunk; `wrappedSeasonLabel`
  // lives in src/lib/format.ts, which anything may import.
  //
  // Nothing here restates the wording: both assertions derive it, so the
  // December flip from "so far" to "Wrapped" needs no edit and cannot desync.

  it("tracks the season label rather than a typed-in string", () => {
    expect(TAB_TITLES.wrapped).toBe(`Your ${wrappedSeasonLabel().title}`);
  });

  it("is the string HelprWrapped actually renders, not a second copy of it", () => {
    // Source-level, because rendering HelprWrapped needs auth + a live query.
    // What matters is that the screen READS the registry: the moment it goes
    // back to building its own `Your ${SEASON.title}`, the two can disagree
    // again without any test noticing — which is exactly what happened.
    const src = readFileSync(resolve(__dirname, "HelprWrapped.tsx"), "utf8");
    const rebuilt = [...src.matchAll(/(?:title=\{|usePageTitle\()`Your \$\{SEASON\.title\}/g)];
    expect(
      rebuilt.map((m) => m[0]),
      "HelprWrapped is rebuilding the tab's name instead of reading TAB_TITLES.wrapped",
    ).toEqual([]);
    expect(src, "HelprWrapped no longer reads the registry at all").toContain("TAB_TITLES.wrapped");
  });
});

// The one production line this file exists for: an unknown ?tab= must not be
// cast straight through to a Tab. Drop the membership test and /profile paints
// nav chrome over an empty panel again.
// @mutate src/pages/profile/types.ts |   if (raw && VALID_TABS.has(raw)) return raw as Tab; |   if (raw) return raw as Tab;
