/**
 * Every script that enumerates Profile tabs gets EXACTLY the keys of
 * TAB_TITLES (Q279, found by Q179 2026-09-23: audit-capture parsed 23 of 24
 * and silently skipped `wrapped`, a template-literal title). One shared
 * parser, compared against the real object, and no script keeps its own copy.
 *
 * @mutate scripts/lib/profileTabs.mjs | /^\s*(\w+):\s*["'`]/gm | /^\s*(\w+):\s*"/gm
 * @mutate scripts/audit-capture.mjs | const PROFILE_TABS = parseProfileTabKeys(TAB_TITLES_SRC); | const PROFILE_TABS = parseProfileTabKeys(TAB_TITLES_SRC).slice(1);
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { TAB_TITLES } from "@/pages/profile/types";
import { parseProfileTabKeys } from "../../scripts/lib/profileTabs.mjs";

const REPO = resolve(__dirname, "..", "..");

describe("Q279 — Profile tab enumeration equals TAB_TITLES", () => {
  it("the shared parser returns exactly TAB_TITLES' keys", () => {
    const src = readFileSync(join(REPO, "src/pages/profile/types.ts"), "utf8");
    expect(parseProfileTabKeys(src).sort()).toEqual(Object.keys(TAB_TITLES).sort());
  });

  it("audit-capture's PROFILE_TABS comes from the shared parser, unmodified", () => {
    const s = readFileSync(join(REPO, "scripts/audit-capture.mjs"), "utf8");
    expect(s).toContain("const PROFILE_TABS = parseProfileTabKeys(TAB_TITLES_SRC);");
  });

  it("no script parses TAB_TITLES with its own regex", () => {
    const offenders = readdirSync(join(REPO, "scripts"))
      .filter((f) => f.endsWith(".mjs"))
      .filter((f) => {
        const s = readFileSync(join(REPO, "scripts", f), "utf8");
        return s.includes("TAB_TITLES") && /matchAll\(\/\^\\s\*\(\\w\+\):/.test(s);
      });
    expect(offenders).toEqual([]);
  });
});
