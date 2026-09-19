/**
 * THE ACTION ROW IS PINNED AT BOTH ENDS, AT EVERY WIDTH.
 *
 * Owner, 2026-09-19: "before and after photos should be to the left of the
 * primary buttons", and "report a problem always all the way on the left".
 * With the standing primary-right rule (V2/V3) that is three fixed positions
 * and one flexible middle:
 *
 *   Report a Problem · …middle… · Before/After Photo · [green primary]
 *
 * ── WHY THE OVERFLOW RULE HAD TO CHANGE WITH IT ───────────────────────────
 * `allocateJobStepRow` (70d276587) moves chips into a `More` popover when the
 * row runs out of width, and it took the LAST ones — fine while chip order was
 * arbitrary, wrong the moment the owner pinned the ends, because the last chip
 * is now the photo control they had just asked to place beside the primary.
 * Overflow comes out of the MIDDLE now
 * (`partitionJobStepRowChips`), so a pinned control is never the one that
 * disappears. This file asserts both halves: the order, and that the pins
 * survive the narrowest row in the app.
 *
 * ── THE INVENTORY IS DERIVED FROM THE STEP FILES ──────────────────────────
 * Not a list typed here. Every `actions={[…]}` / `const actions = [` array in
 * both step trees is read from source, so a step written next week that puts a
 * photo chip in the middle fails this file the day it is written — the failure
 * mode a hand-maintained list has is that nobody adds to it.
 *
 * @mutate src/components/activity/appliedJobCard/steps/WorkingStep.tsx | actions={[reportChip, messageChip, <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="working" />]} | actions={[<HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="working" />, messageChip, reportChip]}
 * @mutate src/components/activity/appliedJobCard/steps/OnSiteStep.tsx | actions={[reportChip, messageChip, <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="on_site" />]} | actions={[messageChip, <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="on_site" />, reportChip]}
 * @mutate src/components/activity/jobStepRow.tsx | const trail = [chips[chips.length - 1]]; | const trail = [];
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { partitionJobStepRowChips, allocateJobStepRow } from "@/components/activity/jobStepRow";

const ROOT = resolve(__dirname, "../..");
const STEP_DIRS = [
  "src/components/activity/appliedJobCard/steps",
  "src/components/activity/postedJobCard/steps",
  "src/components/activity/appliedJobCard",
];

/** Every source file in either step tree that builds an `actions` array. */
function actionArrays(): Array<{ file: string; body: string }> {
  const out: Array<{ file: string; body: string }> = [];
  for (const dir of STEP_DIRS) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!/\.tsx$/.test(name) || /\.test\./.test(name)) continue;
      const rel = `${dir}/${name}`;
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      // `actions={[ … ]}` or `const actions = [ … ];`, balanced on brackets.
      for (const m of src.matchAll(/(?:actions=\{\[|const actions = \[)/g)) {
        const start = src.indexOf("[", m.index!);
        let depth = 0;
        let end = start;
        for (let i = start; i < src.length; i++) {
          if (src[i] === "[") depth++;
          else if (src[i] === "]") {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        out.push({ file: rel, body: src.slice(start + 1, end) });
      }
    }
  }
  return out;
}

/**
 * The top-level entries of one `actions` array, in order, as source text.
 * Splits on commas that are not inside brackets, braces, parens or strings —
 * a JSX element spanning fifteen lines is ONE entry.
 */
function entries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let str: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (str) {
      if (c === str && body[i - 1] !== "\\") str = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; cur += c; continue; }
    if ("([{<".includes(c) && !(c === "<" && !/[A-Za-z/]/.test(body[i + 1] ?? ""))) {
      // `<` only counts as a bracket when it opens a JSX tag; `=>` and `<=`
      // must not push depth or every arrow handler unbalances the scan.
      if (c === "<") { /* JSX tags are matched by the /> or </…> below */ }
      else depth++;
    }
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((e) => e.length > 0);
}

const isReport = (e: string) => /\breportChip\b/.test(e);
const isPhotoCapture = (e: string) => /<HelperPhotoAsk\b/.test(e) || /\bphotoChip\b/.test(e);

describe("the row's chip order is pinned at both ends", () => {
  const arrays = actionArrays();

  it("there are action arrays to check at all", () => {
    // The floor. An inventory that silently found nothing would make every
    // per-member assertion below pass.
    expect(arrays.length, "no actions={[…]} arrays found in either step tree").toBeGreaterThanOrEqual(8);
  });

  it("Report a Problem, where present, is the FIRST chip", () => {
    const offenders: string[] = [];
    for (const { file, body } of arrays) {
      const es = entries(body);
      const idx = es.findIndex(isReport);
      if (idx > 0) {
        offenders.push(
          `${file}: reportChip is at index ${idx} of ${es.length}. Owner, 2026-09-19: ` +
            `"report a problem always all the way on the left".`,
        );
      }
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });

  it("the photo capture chip, where present, is the LAST chip", () => {
    const offenders: string[] = [];
    for (const { file, body } of arrays) {
      const es = entries(body);
      const idx = es.findIndex(isPhotoCapture);
      if (idx >= 0 && idx !== es.length - 1) {
        offenders.push(
          `${file}: the photo capture chip is at index ${idx} of ${es.length}, not last. ` +
            `Owner, 2026-09-19: "before and after photos should be to the left of the ` +
            `primary buttons" — and the primary is the row's right-most control, so the ` +
            `photo chip is the last CHIP.`,
        );
      }
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });

  it("at least one array actually carries each pinned control", () => {
    // Otherwise the two rules above are vacuous: a tree with no reportChip and
    // no photo chip anywhere satisfies both perfectly.
    expect(arrays.some(({ body }) => entries(body).some(isReport)), "no reportChip found anywhere").toBe(true);
    expect(arrays.some(({ body }) => entries(body).some(isPhotoCapture)), "no photo capture chip found anywhere").toBe(true);
  });
});

describe("overflow never takes a pinned end", () => {
  const chips = ["report", "message", "directions", "photo"];

  it("the More control takes from the MIDDLE, at every capacity", () => {
    for (let visible = 2; visible < chips.length; visible++) {
      const { lead, overflow, trail } = partitionJobStepRowChips(chips, visible);
      expect(lead[0], `visible=${visible}: the lead pin left the row`).toBe("report");
      expect(trail[0], `visible=${visible}: the trail pin left the row`).toBe("photo");
      expect(overflow, `visible=${visible}: a pinned end was sent to More`).not.toContain("report");
      expect(overflow).not.toContain("photo");
      expect(lead.length + trail.length, `visible=${visible}: wrong number of chips in the row`).toBe(visible);
    }
  });

  it("the middle collapses from the RIGHT — Message outlives the ancillary chips", () => {
    // Three visible slots: Message stays, Directions goes.
    const { overflow } = partitionJobStepRowChips(chips, 3);
    expect(overflow).toEqual(["directions"]);
  });

  it("with room for ONE chip the lead pin wins, and nothing is lost", () => {
    const { lead, overflow, trail } = partitionJobStepRowChips(chips, 1);
    expect(lead).toEqual(["report"]);
    expect(trail).toEqual([]);
    // Nothing is dropped — it is one tap in.
    expect([...lead, ...overflow, ...trail].sort()).toEqual([...chips].sort());
  });

  it("everything fits: no overflow control at all", () => {
    const { lead, overflow, trail } = partitionJobStepRowChips(chips, chips.length);
    expect(lead).toEqual(chips);
    expect(overflow).toEqual([]);
    expect(trail).toEqual([]);
  });

  it("THE 320 ROW: four chips + a primary keeps both pins on screen", () => {
    /* The measured numbers, not stated ones. The row is 212px at a 320px
       viewport (measured on prod 2026-09-19, helper and poster `disputed`),
       and "Resolve" needs 56px in the primary slot:

         room for chips = 212 - 56 - 6            = 150px
         capacity       = floor((150 + 6) / 50)   = 3 chip slots
         4 chips > 3    -> 2 visible + the More control
         controls drawn = 2 chips + More + primary = 4
                        = 4*44 + 3*6 = 194px <= 212  OK
         primary gets   = 212 - 3*44 - 3*6 = 62px >= 56  OK

       So at 320 the row is: Report a Problem - More(2) - Photo - [primary].
       Message and Directions are inside More. That is the honest answer: five
       controls at the 44px tap floor need 244px and the row has 212. */
    const alloc = allocateJobStepRow({ width: 212, chips: 4, compact: true, primaryNeeds: [56] });
    expect(alloc.visibleChips).toBe(2);
    expect(alloc.overflowChips).toBe(2);
    expect(alloc.chipSlots).toBe(3);
    expect(alloc.primaryPx).toBe(62);

    const { lead, overflow, trail } = partitionJobStepRowChips(chips, alloc.visibleChips);
    expect(lead).toEqual(["report"]);
    expect(trail).toEqual(["photo"]);
    expect(overflow).toEqual(["message", "directions"]);
  });

  it("THE 375 ROW: the same four chips all fit, no More at all", () => {
    // room = 262 - 56 - 6 = 200; capacity = floor(206/50) = 4; 4 chips fit.
    const alloc = allocateJobStepRow({ width: 262, chips: 4, compact: true, primaryNeeds: [56] });
    expect(alloc.overflowChips).toBe(0);
    expect(partitionJobStepRowChips(chips, alloc.visibleChips).overflow).toEqual([]);
  });
});
