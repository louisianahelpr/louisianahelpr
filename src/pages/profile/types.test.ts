import { describe, it, expect } from "vitest";
import { resolveTab, TAB_TITLES, type Tab } from "./types";

describe("resolveTab", () => {
  // `searchParams.get("tab") as Tab` accepted any string, no panel matched it,
  // and /profile rendered nav chrome over an empty content area — no heading,
  // no error. Measured before the fix: /profile?tab=posted_jobs produced 70
  // characters of body text and zero <h1>. After: the landing tab, 1450 chars.
  it("falls back to landing for an unknown tab", () => {
    expect(resolveTab("posted_jobs")).toBe("landing");
    expect(resolveTab("completed_jobs")).toBe("landing");
    expect(resolveTab("bogus_tab_xyz")).toBe("landing");
    expect(resolveTab("")).toBe("landing");
    expect(resolveTab(null)).toBe("landing");
    expect(resolveTab(undefined)).toBe("landing");
  });

  it("passes through every real tab", () => {
    const all: Tab[] = [...(Object.keys(TAB_TITLES) as Exclude<Tab, "landing">[]), "landing"];
    for (const tab of all) expect(resolveTab(tab)).toBe(tab);
  });

  // Guards the derivation: a tab added to TAB_TITLES is automatically
  // resolvable, so the valid set can never drift from the union again.
  it("derives its valid set from TAB_TITLES", () => {
    for (const key of Object.keys(TAB_TITLES)) expect(resolveTab(key)).toBe(key);
  });
});
