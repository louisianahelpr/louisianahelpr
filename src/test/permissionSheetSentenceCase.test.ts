/**
 * Q2575 (Auditor 1 Declutter audit 1102a, pB-loc-375.png): the location sheet's
 * buttons read "Share Location" / "Not Now" while the rest of the app is
 * sentence case (owner 2026-10-21). Lead 11-02: change it everywhere.
 *
 * 1. Every permission sheet button (each `cta` in usePermissionRationale's copy
 *    and the sheet's own dismiss) is sentence case.
 * 2. No shipped source file shows "Not Now": inventory from source, every
 *    tracked .ts/.tsx under src/ outside tests, comments blanked.
 *
 * @mutate src/hooks/usePermissionRationale.ts | cta: "Share location", | cta: "Share Location",
 * @mutate src/hooks/usePermissionRationale.ts | cta: "Turn on notifications", | cta: "Turn On Notifications",
 * @mutate src/components/PermissionRationaleDialog.tsx | Not now | Not Now
 * @mutate src/components/AwardGateDialog.tsx | pendingMissing ? "Later" : "Not now" | pendingMissing ? "Later" : "Not Now"
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { sentenceCaseProblems } from "./helpers/sentenceCase";

const read = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("Q2575 permission sheets are sentence case; nothing shows 'Not Now'", () => {
  it("every permission sheet button is sentence case", () => {
    const ctas = [...read("src/hooks/usePermissionRationale.ts").matchAll(/\bcta:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ctas.length).toBeGreaterThan(5);
    expect(ctas).toContain("Share location");

    const dialog = read("src/components/PermissionRationaleDialog.tsx");
    const dismiss = dialog.match(/>\s*([A-Za-z][^<>{}]*?)\s*<\/DialogSecondaryAction>/)?.[1];
    expect(dismiss).toBeTruthy();

    const bad = [...ctas, dismiss!].filter((t) => sentenceCaseProblems(t).length);
    expect(bad).toEqual([]);
  });

  it("no shipped source file shows 'Not Now'", () => {
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(1000);
    const hits = files.filter((f) => /\bNot Now\b/.test(read(f)));
    expect(hits).toEqual([]);
  });
});
