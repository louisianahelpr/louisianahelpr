/**
 * Owner, 2026-10-08 ("header and tabs should match", "same here"): the Profile
 * row "Legal — Terms, privacy, guidelines & data export" opened a screen titled
 * "Legal & Policies" with the tabs Terms / Rules / Privacy, and the row
 * "Report a bug" opened a screen titled "Help & Support".
 *
 * The class: every Profile menu row is named exactly what the screen it opens
 * is titled. The screen titles live in TAB_TITLES (src/pages/profile/types.ts);
 * a row that opens the support screen on the bug topic is titled
 * REPORT_BUG_TITLE there too.
 *
 * @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | { key: "legal", label: TAB_TITLES.legal, | { key: "legal", label: "Legal",
 * @mutate src/components/profile/SupportInline.tsx | title={openedAsBugReport ? REPORT_BUG_TITLE : "Help & Support"} | title="Help & Support"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_BUG_TITLE, TAB_TITLES } from "@/pages/profile/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ROWS_SRC = read("src/components/profile/profileLanding/useProfileLandingDerived.tsx");

/** Every row object: its key, its label expression, and its href when it has one. */
function rows(): { key: string; label: string; href: string | null }[] {
  const out: { key: string; label: string; href: string | null }[] = [];
  const starts = [...ROWS_SRC.matchAll(/key: "([a-z_-]+)"/g)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : ROWS_SRC.length;
    const body = ROWS_SRC.slice(m.index!, end);
    const label = /label: ([^,\n]+),/.exec(body)?.[1]?.trim() ?? "";
    const href = /href: "([^"]+)"/.exec(body)?.[1] ?? null;
    out.push({ key: m[1], label, href });
  });
  return out;
}

function resolveLabel(expr: string): string | null {
  const lit = /^"([^"]+)"$/.exec(expr);
  if (lit) return lit[1];
  if (expr === "REPORT_BUG_TITLE") return REPORT_BUG_TITLE;
  const t = /^TAB_TITLES\.([a-z_]+)$/.exec(expr);
  if (t) return (TAB_TITLES as Record<string, string>)[t[1]] ?? null;
  return null;
}

function expectedTitle(row: { key: string; href: string | null }): string | null {
  if (row.href) {
    const q = new URLSearchParams(row.href.split("?")[1] ?? "");
    if (q.get("tab") === "support" && q.get("topic") === "report") return REPORT_BUG_TITLE;
    const tab = q.get("tab");
    return tab ? (TAB_TITLES as Record<string, string>)[tab] ?? null : null;
  }
  return (TAB_TITLES as Record<string, string>)[row.key] ?? null;
}

describe("every Profile menu row is named what the screen it opens is titled", () => {
  it("reads a real menu (inventory floor)", () => {
    expect(rows().length).toBeGreaterThanOrEqual(20);
  });

  it("each row that opens a Profile screen carries that screen's title", () => {
    const mismatches = rows()
      .map((r) => ({ ...r, want: expectedTitle(r), got: resolveLabel(r.label) }))
      .filter((r) => r.want !== null && r.got !== r.want)
      .map((r) => `${r.key}: row says ${JSON.stringify(r.got ?? r.label)}, screen is titled ${JSON.stringify(r.want)}`);
    expect(mismatches).toEqual([]);
  });

  it("the support screen opened as a bug report is titled like its row", () => {
    expect(read("src/components/profile/SupportInline.tsx")).toMatch(
      /title=\{openedAsBugReport \? REPORT_BUG_TITLE : "Help & Support"\}/,
    );
  });
});
