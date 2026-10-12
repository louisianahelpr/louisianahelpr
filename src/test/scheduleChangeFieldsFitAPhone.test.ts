/**
 * Owner, 2026-10-08 (iPhone): in "New date or time for ...", the Date and Start
 * time fields overlapped and ran off the dialog's right edge. iOS gives native
 * date/time inputs an intrinsic width wider than half a phone dialog, and a
 * grid item will not shrink below its content without min-width: 0.
 * Desktop WebKit does not reproduce the iOS width (measured: no overlap
 * either way), so this pins the fix in source.
 *
 * MEASURED ON iOS, 2026-10-11 (Q1548, iOS 26.5 simulator, the real component
 * in Mobile Safari and its markup inside the app's own WKWebView with the
 * built CSS): before the fix, at 402 px each field was 188 px wide in a 162 px
 * column, the pair overlapped by 14 px and the time field ran 9 px past the
 * dialog; after, 162 px each, 0 overlap, 0 past the edge. At 375 px the grid
 * is one column either way. The same run showed the fix's second half: with
 * no native appearance iOS pins the value to the TOP of the 44 px box and
 * centres it (text-left on the input is ignored), so an appearance-none
 * date/time field also needs vertical padding and the
 * ::-webkit-date-and-time-value alignment rule.
 *
 * CLASS (every native date/time field in src/, found from source): a field
 * that can sit in a narrow column must be able to shrink (min-w-0); a field
 * that drops the native appearance must re-centre and left-align its value.
 *
 * @mutate src/components/schedule/ScheduleChangeControl.tsx |           <label className="min-w-0 space-y-1 text-ds-12 text-foreground">\n            <span className="block font-semibold">Date</span> |           <label className="space-y-1 text-ds-12 text-foreground">\n            <span className="block font-semibold">Date</span>
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | px-3 py-2.5 bg-background text-left [&::-webkit-date-and-time-value]:text-left"\n            />\n          </label>\n        </div> | px-3 bg-background text-left [&::-webkit-date-and-time-value]:text-left"\n            />\n          </label>\n        </div>
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | py-2.5 bg-background text-left [&::-webkit-date-and-time-value]:text-left"\n            />\n          </label>\n          <label | py-2.5 bg-background text-left"\n            />\n          </label>\n          <label
 * @mutate src/components/admin/AdminCredentialQueue.tsx | className="w-full rounded-ds-sm border border-border bg-background/60 px-2 py-1.5 text-ds-11 text-foreground" | className="w-full min-w-0 rounded-ds-sm border border-border bg-background/60 px-2 py-1.5 text-ds-11 text-foreground"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = readFileSync(join(process.cwd(), "src/components/schedule/ScheduleChangeControl.tsx"), "utf8");

describe("the date/time change dialog's fields can shrink to a phone", () => {
  it("both grid cells and both inputs carry min-w-0", () => {
    const labels = [...SRC.matchAll(/<label className="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l).toMatch(/\bmin-w-0\b/);
    const inputs = [...SRC.matchAll(/type="(date|time)"[\s\S]*?className="([^"]+)"/g)].map((m) => m[2]);
    expect(inputs).toHaveLength(2);
    for (const c of inputs) expect(c).toMatch(/\bmin-w-0\b.*\bappearance-none\b/);
  });
});

// ── the class: every native date/time field in src/ ─────────────────────────

const NATIVE_TYPE = /\btype="(date|time|datetime-local|month|week)"/;

/** Every `<input>`/`<Input>` JSX tag with a native date/time type, as
 *  `file#n` (n = its order among such tags in that file) -> the tag text. */
function nativeDateTimeTags(): Map<string, string> {
  const files = execFileSync("git", ["ls-files", "src/**/*.tsx"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/\.test\.tsx$/.test(f));
  const out = new Map<string, string>();
  for (const file of files) {
    const code = blankComments(readFileSync(join(process.cwd(), file), "utf8"));
    let n = 0;
    for (const m of code.matchAll(/<(?:input|Input)\b/g)) {
      // The tag runs to the first `>` at brace depth 0 (className={cn(...)}
      // and arrow functions in props stay inside braces).
      let depth = 0;
      let end = m.index! + 1;
      for (; end < code.length; end++) {
        const ch = code[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0 && code[end - 1] !== "=") break;
      }
      const tag = code.slice(m.index!, end + 1);
      if (!NATIVE_TYPE.test(tag)) continue;
      n++;
      out.set(`${file}#${n}`, tag);
    }
  }
  return out;
}

// Native date/time fields that do NOT carry min-w-0, each read in source as
// one field alone on its row (never a cell of a multi-column grid or a
// fixed-width flex row), so iOS's intrinsic width has the whole row to use.
// Exact both ways: a new field must shrink or be added here with its reason,
// and an entry that gains min-w-0 or disappears fails as stale.
// @two-way src/test/scheduleChangeFieldsFitAPhone.test.ts:stale KNOWN_NO_SHRINK entry
const KNOWN_NO_SHRINK: Record<string, string> = {
  "src/components/NotificationPreferences.tsx#1": "quiet-hours From: inline-flex label in a flex-wrap row, wraps instead of overlapping",
  "src/components/NotificationPreferences.tsx#2": "quiet-hours to: inline-flex label in a flex-wrap row, wraps instead of overlapping",
  "src/components/TimePickerWheel.tsx#1": "desktop-website-only native field (phones and the app keep the wheels)",
  "src/components/admin/AdminCredentialQueue.tsx#1": "expiry date alone in its card; the card grid is one column below sm",
  "src/components/admin/marketing/MarketingComposerDialog.tsx#1": "Scheduled for: alone in a space-y column",
  "src/pages/posts/EditJobDialog.tsx#1": "locked Date needed: alone in a space-y column",
};

describe("every native date/time field fits a phone (class guard, Q1548)", () => {
  const tags = nativeDateTimeTags();

  it("finds the fields from source (inventory floor)", () => {
    expect(tags.size).toBeGreaterThan(7);
  });

  it("each field can shrink (min-w-0) or is a known lone-row field", () => {
    const offenders = [...tags]
      .filter(([key, tag]) => !/\bmin-w-0\b/.test(tag) && !(key in KNOWN_NO_SHRINK))
      .map(([key]) => key);
    expect(offenders, "a native date/time field without min-w-0 (iOS draws it wider than half a phone column)").toEqual([]);
  });

  it("KNOWN_NO_SHRINK is exact (no stale entry)", () => {
    const stale = Object.keys(KNOWN_NO_SHRINK).filter((key) => {
      const tag = tags.get(key);
      return tag === undefined || /\bmin-w-0\b/.test(tag);
    });
    expect(stale, "stale KNOWN_NO_SHRINK entry: remove it").toEqual([]);
  });

  it("a field with no native appearance re-centres and left-aligns its value", () => {
    const flat = [...tags].filter(([, tag]) => /\bappearance-none\b/.test(tag));
    expect(flat.length).toBeGreaterThan(1);
    const offenders = flat
      .filter(([, tag]) => !/\bpy-[\w.[\]]+/.test(tag) || !tag.includes("[&::-webkit-date-and-time-value]:text-left"))
      .map(([key]) => key);
    expect(offenders, "appearance-none date/time field without vertical padding + ::-webkit-date-and-time-value text-left").toEqual([]);
  });
});
