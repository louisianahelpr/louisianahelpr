// @mutate src/components/ui/checkbox.tsx | "peer h-[18px] w-[18px] shrink-0 rounded-sm", | "peer h-5 w-5 shrink-0 rounded-sm",
// @mutate src/components/ui/checkbox.tsx | <Check className="h-3 w-3 stroke-[2.5]" /> | <Check className="h-3.5 w-3.5 stroke-[2.5]" />
// @mutate src/pages/auth/signup/SignupStep1.tsx | className="mt-px shrink-0" | className="h-5 w-5 mt-px shrink-0 [&_svg]:h-4 [&_svg]:w-4"
// @mutate src/pages/auth/CompleteProfile.tsx | className="mt-px shrink-0" | className="h-3.5 w-3.5 mt-px shrink-0"
// @mutate src/components/admin/AdminExceptionQueue.tsx | className="h-[18px] w-[18px] min-h-0 min-w-0 accent-[hsl(var(--primary))]" | className="h-4 w-4 min-h-0 min-w-0 accent-[hsl(var(--primary))]"
// @mutate src/components/messages/ConversationRow.tsx | className="w-[18px] h-[18px] rounded-full | className="w-6 h-6 rounded-full
// @mutate src/components/firstRun/FirstRun.tsx | className="shrink-0 w-[18px] h-[18px] rounded-full | className="shrink-0 w-7 h-7 rounded-full
// @mutate src/components/declutter/declutterUi.tsx | <label htmlFor={id} className="min-h-11 flex-1">{TAX_TICK_LABEL}</label> | <label htmlFor={id}>{TAX_TICK_LABEL}</label>
// @mutate src/components/shops/ShopEditView.tsx | <Label htmlFor="shop-quotes" className="flex min-h-11 flex-1 items-center font-normal"> | <Label htmlFor="shop-quotes" className="font-normal">
// @mutate src/components/admin/adminPayoutBatches/BatchRow.tsx | <label className="-m-[13px] flex shrink-0 cursor-pointer p-[13px]"> | <label className="flex shrink-0">
/**
 * EVERY CHECKBOX DRAWS AN 18 PX BOX WITH A 12 PX TICK (owner 2026-11-01, on the manager-mode screens: "The check
 * boxes are quite large"). The tap target is the label row around the box (>= 44 px), never the box itself.
 *
 * Found by what each thing IS, across src:
 *  - the shared <Checkbox> (src/components/ui/checkbox.tsx) is h-[18px] w-[18px] with an h-3 w-3 tick;
 *  - no <Checkbox> call site resizes the box or its tick (no h-/w-/size-/min-/max-/scale- or [&_svg] in className);
 *  - every native <input type="checkbox"> is drawn h-[18px] w-[18px];
 *  - every hand-made role="checkbox" button draws its indicator at 18 px;
 *  - every <Checkbox> sits in a 44 px tap row: its wrapping <label>, or the label that names its id, carries
 *    min-h-11 / min-h-[44px] / h-11, or the row is a padded card (p-3, p-4, p-card) or a 44 px square (p-[13px]).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const rel = (f: string) => path.relative(ROOT, f);

function sources() {
  return walkSource([path.join(ROOT, "src")])
    .filter((p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p))
    .map((file) => ({ file, code: blankComments(readSource(file) ?? "") }));
}

/** The JSX opening tag starting at `at`, up to its own closing `>` (skipping `=>` and braces). */
function openingTag(code: string, at: number): string {
  let depth = 0;
  for (let i = at; i < code.length; i++) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return code.slice(at, i + 1);
  }
  return code.slice(at);
}

function classOf(tag: string): string {
  const m = /className=(?:"([^"]*)"|\{`([^`]*)|\{cn\(([^)]*)\)\})/.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

const SIZE_TOKEN = /^!?(?:[a-z0-9:[\]()-]*:)?(?:h|w|size|min-h|min-w|max-h|max-w)-|^!?scale-|\[&_svg\]/;
const TAP_ROW = /(?:^|\s)(?:min-h-11|min-h-\[44px\]|h-11|p-\[13px\]|p-3|p-4|p-card)(?:\s|$)/;

function scan() {
  const oversized: string[] = [];
  const nativeOff: string[] = [];
  const handMadeOff: string[] = [];
  const noTapRow: string[] = [];
  let checkboxes = 0;
  let natives = 0;
  let handMade = 0;
  for (const { file, code } of sources()) {
    for (const m of code.matchAll(/<Checkbox\b/g)) {
      checkboxes++;
      const tag = openingTag(code, m.index!);
      const at = `${rel(file)}:${code.slice(0, m.index).split("\n").length}`;
      const bad = classOf(tag).split(/\s+/).filter((t) => t && SIZE_TOKEN.test(t));
      if (bad.length) oversized.push(`${at} ${bad.join(" ")}`);
      // The tap row: the nearest open <label ...> (or <Label ...>) before it, or the label naming its id.
      const before = code.slice(0, m.index);
      const open = Math.max(before.lastIndexOf("<label"), before.lastIndexOf("<Label"));
      const close = Math.max(before.lastIndexOf("</label>"), before.lastIndexOf("</Label>"));
      let row = open > close ? classOf(openingTag(code, open)) : null;
      if (row === null) {
        const id = /\bid=(?:"([^"]+)"|\{([^}]+)\})/.exec(tag);
        if (id) {
          const want = id[1] !== undefined ? `htmlFor="${id[1]}"` : `htmlFor={${id[2]}}`;
          const i = code.indexOf(want);
          if (i >= 0) row = classOf(openingTag(code, code.lastIndexOf("<", i)));
        }
      }
      if (!row || !TAP_ROW.test(row)) noTapRow.push(`${at} ${row ?? "(no label)"}`);
    }
    for (const m of code.matchAll(/<input\b/g)) {
      const tag = openingTag(code, m.index!);
      if (!/\btype="checkbox"/.test(tag)) continue;
      natives++;
      const cls = classOf(tag);
      if (!/(^|\s)h-\[18px\](\s|$)/.test(cls) || !/(^|\s)w-\[18px\](\s|$)/.test(cls)) nativeOff.push(`${rel(file)} ${cls}`);
    }
    for (const m of code.matchAll(/role="checkbox"/g)) {
      handMade++;
      const end = code.indexOf("</button>", m.index);
      const body = code.slice(m.index, end < 0 ? undefined : end);
      if (!/\bw-\[18px\] h-\[18px\]|\bh-\[18px\] w-\[18px\]/.test(body)) handMadeOff.push(rel(file));
    }
  }
  return { oversized, nativeOff, handMadeOff, noTapRow, checkboxes, natives, handMade };
}

describe("every checkbox is an 18 px box with a 12 px tick, tapped through a 44 px row", () => {
  const r = scan();
  const shared = blankComments(readSource(path.join(ROOT, "src/components/ui/checkbox.tsx")) ?? "");

  it("finds the checkboxes (the parser works)", () => {
    expect(r.checkboxes).toBeGreaterThan(25);
    expect(r.natives).toBeGreaterThan(10);
    expect(r.handMade).toBeGreaterThan(1);
  });
  it("the shared Checkbox draws 18 px with a 12 px tick", () => {
    expect(shared).toMatch(/"peer h-\[18px\] w-\[18px\] /);
    expect(shared).toMatch(/<Check className="h-3 w-3 /);
    expect(shared).not.toMatch(/\bh-5 w-5\b/);
  });
  it("no Checkbox call site resizes the box or its tick", () => {
    expect(r.oversized).toEqual([]);
  });
  it("every native checkbox is drawn at 18 px", () => {
    expect(r.nativeOff).toEqual([]);
  });
  it("every hand-made check indicator is 18 px", () => {
    expect(r.handMadeOff).toEqual([]);
  });
  it("every Checkbox keeps a 44 px tap row", () => {
    expect(r.noTapRow).toEqual([]);
  });
});
