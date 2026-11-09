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
 * @mutate src/components/NotificationPreferences.tsx |               All notifications\n            </Label> |               All Notifications\n            </Label>
 * @mutate src/components/NotificationPreferences.tsx | letterSpacing: "0.08em" }}\n          >\n            <Smartphone | letterSpacing: "0.08em", color: "hsl(var(--burnt-sienna))" }}\n          >\n            <Smartphone
 *
 * F103 (owner UI audit 11-09): the rows sit under group headers (Messages, Jobs, Money, Account), each group together,
 * and the screen says "app notifications" / "your notifications" (never "pushes", "phone notifications", "bell icon").
 * @mutate src/components/NotificationPreferences.tsx |         const header = item.group && item.group !== rows[i - 1]?.group ? | const header = false ?
 * @mutate src/components/notificationPreferences/QuietHoursCard.tsx | Hold app notifications overnight. | Hold pushes overnight.
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
    // The Quiet hours, saved-Helpr nudge and Send a test cards live in their own files since Q806 (2026-11-04).
    const src = read("src/components/NotificationPreferences.tsx") + read("src/components/notificationPreferences/QuietHoursCard.tsx") + read("src/components/notificationPreferences/SavedHelprNudgeCard.tsx") + read("src/components/notificationPreferences/TestSendCard.tsx");
    // F101 (owner UI audit 11-09): the top switch is "All notifications", not the technical "Master switch".
    for (const t of ["All notifications", "Quiet hours", "Send a test"]) expect(src).toContain(t);
    expect(src).not.toMatch(/Master Switch|Quiet Hours\b|Send a Test/);
  });

  it("no rust on the screen: nothing on it is money", () => {
    const src = read("src/components/NotificationPreferences.tsx") + read("src/components/notificationPreferences/QuietHoursCard.tsx") + read("src/components/notificationPreferences/SavedHelprNudgeCard.tsx") + read("src/components/notificationPreferences/TestSendCard.tsx");
    expect(src.length).toBeGreaterThan(5000);
    expect(src).not.toMatch(/--burnt-sienna|--sienna-ink|--accent-ink|--money\b/);
  });
});

describe("F103: grouped rows and one word for the app's notifications", () => {
  it("every main row has a group, and each group's rows sit together", () => {
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.group).map((r) => r.key)).toEqual([]);
    const order = rows.map((r) => r.group).filter((g, i, a) => g !== a[i - 1]);
    expect(order).toEqual(["Messages", "Jobs", "Money", "Account"]);
  });
  it("the screen draws a header where the group changes", () => {
    const src = read("src/components/NotificationPreferences.tsx");
    expect(src).toContain("<NotificationGroupHeader key={`group-${item.group}`} title={item.group} />");
    expect(src).toMatch(/const header = item\.group && item\.group !== rows\[i - 1\]\?\.group \?/);
  });
  it("no row or card says pushes, phone notifications or bell icon", () => {
    const files = ["src/components/notificationPreferences/QuietHoursCard.tsx", "src/components/notificationPreferences/DeclutterNotificationGroup.tsx", "src/components/notificationPreferences/PushDeviceHint.tsx"];
    for (const f of files) {
      const code = read(f);
      expect(code, f).not.toMatch(/pushes overnight|phone notifications|bell icon/);
    }
  });
});
