/**
 * BOARD 174, first slice (spec v2 §1.1, §2 "Sentence case everywhere"): the
 * notification settings screen wore rust on its column headers ("APP",
 * "EMAIL") and on every row's icon disc, though nothing on it is money; and
 * its rows were Title Case ("Job Offers", "Master Switch", "Quiet Hours").
 * Now: headers muted, icon discs olive, every label sentence case.
 *
 * Not yet (board 174 proper): the sections x channels grid (Jobs, Declutter,
 * Shops, Homes, Messages, Money x Push, Email, Text) needs per-section
 * preference columns the notification_preferences table does not have.
 *
 * @mutate src/components/notificationPreferences/constants.tsx | label: "Job offers" | label: "Job Offers"
 * @mutate src/components/NotificationPreferences.tsx |               Master switch\n            </Label> |               Master Switch\n            </Label>
 * @mutate src/components/NotificationPreferences.tsx | letterSpacing: "0.08em" }}\n          >\n            <Smartphone | letterSpacing: "0.08em", color: "hsl(var(--burnt-sienna))" }}\n          >\n            <Smartphone
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { rows } from "@/components/notificationPreferences/constants";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => blankComments(fs.readFileSync(path.join(ROOT, p), "utf8"));
/** Proper nouns that keep their capital mid-label. */
const PROPER = new Set(["Helpr", "Helprs"]);
const sentenceCase = (label: string) =>
  label.split(/\s+/).slice(1).every((w) => PROPER.has(w) || !/^[A-Z][a-z]/.test(w));

describe("notification settings, board 174 (first slice)", () => {
  it("every row label is sentence case", () => {
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.map((r) => r.label).filter((l) => !sentenceCase(l))).toEqual([]);
  });

  it("the fixed rows are sentence case", () => {
    const src = read("src/components/NotificationPreferences.tsx");
    for (const t of ["Master switch", "Quiet hours", "Send a test"]) expect(src).toContain(t);
    expect(src).not.toMatch(/Master Switch|Quiet Hours\b|Send a Test/);
  });

  it("no rust on the screen: nothing on it is money", () => {
    const src = read("src/components/NotificationPreferences.tsx");
    expect(src.length).toBeGreaterThan(5000);
    expect(src).not.toMatch(/--burnt-sienna|--sienna-ink|--accent-ink|--money\b/);
  });
});
