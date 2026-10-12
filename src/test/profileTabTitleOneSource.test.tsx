/**
 * Q1530 (owner 2026-10-08, "header and tabs should match"), looked at on prod
 * 2026-10-12: the Profile row "Report a bug" opens /profile?tab=support&topic=report.
 * The LOADED screen was titled "Report a bug", but while its chunk loaded the
 * fallback header read TAB_TITLES.support, "Help & Support", so at 1440 the
 * title flipped from one to the other (screenshot ~/.lh-shots/now-looks/q1530-bug-1440.png).
 *
 * The class: every renderer of a Profile tab's header (the loaded tab, its
 * loading fallback, its offline gate, the browser tab title) asks ONE function,
 * profileTabTitle(tab, search), for the title. None indexes TAB_TITLES itself.
 *
 * @mutate src/components/profile/ProfileTabFallback.tsx | title={profileTabTitle(tab, currentSearch())} | title={profileTabTitle(tab, "")}
 * @mutate src/pages/profile/types.ts | if (tab === "support" && new URLSearchParams(search).get("topic") === "report") return REPORT_BUG_TITLE; |
 * @mutate src/components/profile/ProfileOfflineGate.tsx | title={profileTabTitle(tab, currentSearch())} | title={TAB_TITLES[tab]}
 * @mutate src/components/profile/SupportInline.tsx | title={profileTabTitle("support", searchParams.toString())} | title="Help & Support"
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));

import { ProfileTabFallback } from "@/components/profile/ProfileTabFallback";
import { REPORT_BUG_TITLE, TAB_TITLES } from "@/pages/profile/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("a Profile tab's header has one title, loading or loaded", () => {
  it("the loading header of the bug-report screen says Report a bug", () => {
    window.history.replaceState(null, "", "/profile?tab=support&topic=report");
    render(<MemoryRouter><ProfileTabFallback tab="support" /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(REPORT_BUG_TITLE);
  });

  it("the plain support screen still loads as Help & Support", () => {
    window.history.replaceState(null, "", "/profile?tab=support");
    render(<MemoryRouter><ProfileTabFallback tab="support" /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TAB_TITLES.support);
  });

  it("no header renderer indexes TAB_TITLES itself; each asks profileTabTitle", () => {
    const files = sources("src");
    expect(files.length).toBeGreaterThan(500);
    const direct = files.filter((f) => /ProfileTabHeader\s+title=\{\s*TAB_TITLES\[/.test(blankComments(read(f))));
    expect(direct).toEqual([]);
    const asking = files.filter((f) => /\bprofileTabTitle\(/.test(blankComments(read(f))) && !f.endsWith("pages/profile/types.ts"));
    // ProfileTabFallback, ProfileOfflineGate, SupportInline, Profile (browser tab title).
    expect(asking.sort()).toEqual([
      "src/components/profile/ProfileOfflineGate.tsx",
      "src/components/profile/ProfileTabFallback.tsx",
      "src/components/profile/SupportInline.tsx",
      "src/pages/profile/Profile.tsx",
    ]);
    expect(blankComments(read("src/components/profile/SupportInline.tsx"))).toMatch(
      /ProfileTabHeader title=\{profileTabTitle\("support", searchParams\.toString\(\)\)\}/,
    );
    expect(blankComments(read("src/components/profile/ProfileOfflineGate.tsx"))).toMatch(
      /ProfileTabHeader title=\{profileTabTitle\(tab, currentSearch\(\)\)\}/,
    );
  });
});
