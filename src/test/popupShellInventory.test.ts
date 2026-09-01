import ts from "typescript";
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * EVERY POPUP WEARS THE SHARED SHELL — the whole-codebase version.
 *
 * WHY THIS FILE EXISTS, AND WHY `dialogShell.test.ts` WAS NOT ENOUGH.
 * `src/components/ui/dialogShell.test.ts` guards the PRIMITIVES: it proves
 * dialog.tsx / alert-dialog.tsx / sheet.tsx agree with each other, and it bans
 * three width tokens at call sites. That is a real guard and it stays. But it
 * cannot see the failure the owner keeps reporting — "there are a lot of these
 * pop ups and none of them have the same layout", asked six times now — because
 * that failure is not in the primitives. It is in the 60+ CALL SITES, where a
 * popup can:
 *
 *   - open a `<DialogContent>` and never render a `<DialogHero>`, so it has no
 *     shared header at all;
 *   - hand-roll its own modal surface with a `<div role="dialog">` and skip the
 *     shared shell entirely (nothing in dialogShell.test.ts even looks at a
 *     file that never imports DialogContent);
 *   - close without a `<DialogFooter>`, and put its Cancel somewhere new.
 *
 * A per-screen checklist cannot catch any of that: each dialog is defensible on
 * its own, and only the INVENTORY shows that six of them are six different
 * layouts. So this file inventories, and every failure names the file.
 *
 * NOTHING HERE ASSERTS "expected true". Every expectation prints the offending
 * path and the specific move that makes it green.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** Every tracked, existing, non-test TSX file under src/. */
function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f))
    // A file deleted in the working tree but not yet staged is still TRACKED.
    // Reading it would ENOENT the whole suite red for no reason.
    .filter((f) => existsSync(resolve(ROOT, f)));
}

/** Strip block and line comments — prose ABOUT a rule is not a violation of it. */
/**
 * Blank out comments using the TypeScript scanner, not a regex.
 *
 * The regex version of this (`/\/\*[\s\S]*?\*\//g`) silently ate real code.
 * TSX is not a regular language: a `/*` appearing inside a string, a regex
 * literal, or a JSX text node opens a "comment" the scanner never intended,
 * and the non-greedy match then runs to the next `*\/` anywhere in the file —
 * swallowing whatever sits between. Measured: it deleted the entire
 * `<DialogFooter>` block from DisputeTimelineDialog.tsx and DisputeDialog.tsx,
 * so both were reported as having no footer when both plainly have one.
 *
 * That is the worst kind of test failure — it accuses correct code, and the
 * obvious "fix" is to change the code to satisfy it. Comments are lexical, so
 * the lexer is the thing that knows where they are.
 */
const stripComments = (t: string): string => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.JSX, t);
  const out = t.split("");
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      // Blank the comment but keep newlines, so line numbers still line up
      // with the file for any message that reports one.
      for (let i = scanner.getTokenStart(); i < scanner.getTokenEnd(); i++) {
        if (out[i] !== "\n") out[i] = " ";
      }
    }
  }
  return out.join("");
};

const POPUP_CONTENT = /<(DialogContent|AlertDialogContent|SheetContent)\b/;

function popupFiles(): string[] {
  return tsxFiles().filter((f) => POPUP_CONTENT.test(stripComments(repoFile(f))));
}

/**
 * shadcn/ui PRIMITIVES that wrap a popup for a different purpose and are not
 * product popups. `command.tsx` is the ⌘K palette shell; `sidebar.tsx` is the
 * mobile nav drawer. Neither shows a titled product dialog, so neither wears a
 * Hero. Everything else in `src/components/ui` that opens a popup DOES.
 */
const PRIMITIVE_WRAPPERS = new Set([
  "src/components/ui/command.tsx",
  "src/components/ui/sidebar.tsx",
]);

// ---------------------------------------------------------------------------
// 1 — the inventory itself must not rot
// ---------------------------------------------------------------------------

describe("popup inventory", () => {
  it("still finds the whole popup surface (guards this file going blind)", () => {
    // If a refactor renames the primitives, every assertion below would pass
    // vacuously over an empty list. 40 is a deliberate floor well under the
    // ~65 that exist today: it fails on a rename, not on normal churn.
    const files = popupFiles();
    expect(
      files.length,
      "fewer than 40 files render a DialogContent/AlertDialogContent/SheetContent — " +
        "the primitives were probably renamed, and every assertion in " +
        "popupShellInventory.test.ts is now silently passing over nothing. " +
        "Update POPUP_CONTENT.",
    ).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// 2 — every popup composes the shared shell
// ---------------------------------------------------------------------------

describe("every popup composes the shared shell", () => {
  it("every popup that opens a Content also renders the matching Hero", () => {
    const offenders: string[] = [];
    for (const file of popupFiles()) {
      if (PRIMITIVE_WRAPPERS.has(file)) continue;
      const src = stripComments(repoFile(file));
      const contents = (src.match(/<(DialogContent|AlertDialogContent|SheetContent)\b/g) ?? []).length;
      const heroes = (src.match(/<(DialogHero|AlertDialogHero|SheetHero)\b/g) ?? []).length;
      if (heroes < contents) {
        offenders.push(
          `${file} — ${contents} popup surface(s), ${heroes} Hero(es). ` +
            `Add <DialogHero title="…" /> (or the AlertDialog/Sheet twin) as the ` +
            `first child of each Content; do not hand-roll a header.`,
        );
      }
    }
    expect(
      offenders,
      "popups opening a shared Content but drawing their own header:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

/**
 * Surfaces that declare a dialog role WITHOUT the shared shell, on purpose.
 *
 * The owner has asked six times for one shared popup shell, so the bar for
 * being on this list is high: it is not "this one is awkward to convert", it
 * is "the shared shell would make this WORSE". Each entry states why, and a
 * file not on the list still fails — so a new hand-rolled modal cannot hide
 * behind these.
 *
 * Owner's call, 2026-08-31: document the real exceptions rather than force a
 * card frame around things that are not cards.
 */
const HAND_ROLLED_BY_DESIGN: Record<string, string> = {
  "src/components/MessageAttachment.tsx":
    "Full-bleed attachment viewer. The shell's job is to put a 512px parchment " +
    "card with a title row around its content; doing that to an image viewer " +
    "shrinks the image to make room for chrome nobody opened it to read.",
  // PetForm.tsx was here until 2026-08-31 for the reason below, and the
  // reason turned out to be the bug:
  //
  //   "Renders inline as often as it renders modal — role is conditional on
  //    isInline. It cannot compose DialogContent unconditionally without
  //    becoming two components, and the inline case is the common one."
  //
  // The hand-rolled surface it kept instead was a `fixed inset-0` overlay, and
  // `fixed` resolves against the nearest transformed ancestor — which AppPage
  // supplies via `animate-ds-page-in`'s forwards-filled `translateY(0)`. So
  // "Add a Pet" opened at the size of the page's CONTENT COLUMN (measured
  // 329x433 in a 393x852 viewport, half the screen, sliced mid-field) rather
  // than the screen. The shared shell portals to document.body and could never
  // have had that failure. Nothing about the two-shell requirement forced a
  // hand-rolled modal: one body, rendered into a `<DialogContent>` or into the
  // inline card, is one component and the exemption is gone.
  "src/components/activity/postedJobs/ApplicantsPanel.tsx":
    "Full-screen push panel, not a card over a page — nothing behind it is " +
    "inert and there is no backdrop, which is why it carries role=region " +
    "rather than dialog. Wrapping it in the shell would promise a focus trap " +
    "it deliberately does not have.",
  "src/components/TimeRangeField.tsx":
    "An inline time picker anchored to its field, not a popup over the page.",
  "src/components/dashboard/PhotoLightbox.tsx":
    "Full-bleed image viewer, same reasoning as MessageAttachment: framing a " +
    "photo in a 512px card to satisfy a consistency rule makes the photo worse.",
  "src/components/AppLockGate.tsx":
    "The lock screen is the whole viewport, deliberately. It must cover the app " +
    "completely and leave the middle clear for the OS biometric sheet to land " +
    "in — a dismissible card is the opposite of what a lock is.",
};

  it("no file hand-rolls a modal surface instead of using the shared shell", () => {
    // The escape that no width/Hero rule can see: skip the primitives entirely,
    // build `<div role="dialog">` with your own focus trap and scrim, and every
    // shared-shell test in the repo looks straight past you.
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      if (file.startsWith("src/components/ui/")) continue; // the primitives themselves
      const src = stripComments(repoFile(file));
      // `aria-modal` as well as `role`, and both in their conditional forms —
      // `role={isInline ? undefined : "dialog"}` is still a modal, and a
      // literal-only regex walks straight past it (PetForm.tsx does exactly
      // this, and hand-rolls a focus trap and an Escape handler behind it).
      if (!/role=[{"']?\s*(?:[^>]*\?\s*)?[^>]*["']dialog["']|role=[{"']?[^>]*["']alertdialog["']|aria-modal=/.test(src))
        continue;
      if (POPUP_CONTENT.test(src)) continue; // uses the shell for its popup
      if (file in HAND_ROLLED_BY_DESIGN) continue; // see the list above
      offenders.push(
        `${file} — declares role="dialog" but never renders DialogContent/SheetContent. ` +
          `A hand-rolled modal is one more layout the owner has to notice; ` +
          `move it onto <Sheet>/<Dialog> + the Hero, or extend the primitive.`,
      );
    }
    expect(
      offenders,
      "hand-rolled modal surfaces bypassing the shared shell:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("no popup carries ANY width override, not just the three banned tokens", () => {
    // dialogShell.test.ts bans max-w-xs / -sm / -md. It does not ban max-w-xl,
    // max-w-2xl, max-w-[420px] or a bare `w-[…]` — so the same defect can come
    // back one token to the right of the ban list. This is the general rule:
    // the measure is the shell's decision, and an exception is a decision on
    // the record.
    const EXCEPTIONS: Record<string, string> = {
      "src/components/dashboard/JobDetailDialog.tsx":
        "deliberately wide on desktop — documented in dialogShell.test.ts STRUCTURAL_EXCEPTIONS",
      "src/components/PhotoLightbox.tsx": "media viewer — sized to the viewport",
    };
    const WIDTH = /(?:^|[\s"'`{])((?:sm:|md:|lg:|xl:|2xl:)?(?:max-)?w-(?:\[[^\]]+\]|xs|sm|md|lg|xl|\dxl|screen|full|none))/g;
    const ALLOWED = new Set(["w-full", "max-w-full"]); // fill the shell — not a measure

    const offenders: string[] = [];
    for (const file of popupFiles()) {
      if (file in EXCEPTIONS) continue;
      const src = stripComments(repoFile(file));
      for (const m of src.matchAll(
        /<(DialogContent|AlertDialogContent|SheetContent)\b([\s\S]*?)>/g,
      )) {
        const cls = /className=\{?["`]([^"`]*)["`]/.exec(m[2]);
        if (!cls) continue;
        for (const w of cls[1].matchAll(WIDTH)) {
          if (ALLOWED.has(w[1])) continue;
          offenders.push(
            `${file} — <${m[1]}> sets "${w[1]}". The shell owns the measure ` +
              `(max-w-lg). Drop it, or add the file to EXCEPTIONS here with the reason.`,
          );
        }
      }
    }
    expect(
      offenders,
      "popups overriding the shared width:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3 — ONE footer convention
// ---------------------------------------------------------------------------

/**
 * THE CONVENTION THIS ENCODES.
 *
 * Six dialogs currently ship six footers — centred bare text below (×2), bare
 * text bottom-right, a full-width white bar below the content, and two
 * side-by-side rows with the secondary on the LEFT. Another lane is settling
 * the house rule; at the time this file was written that lane's output had not
 * landed, so this test encodes the convention the just-rebuilt
 * `src/components/ReportDialog.tsx` uses, which is:
 *
 *   1. every popup closes with the shared `<DialogFooter>` /
 *      `<AlertDialogFooter>` / `<SheetFooter>` (they are one layout — see
 *      dialogShell.test.ts "the three popup footers are one layout");
 *   2. Cancel / Back / Skip is a real `<Button>` inside that footer, never a
 *      bare `<p>`/`<span>`/text link floating under the content.
 *
 * IF THE CONVENTION LANE LANDS A DIFFERENT RULE, change it HERE — one edit,
 * one place. That is the point of encoding it as a test rather than as prose in
 * a review comment: the sixth time the owner asks is the last time, because the
 * seventh drift fails CI instead of shipping.
 */
describe("one footer convention", () => {
  /**
   * Popups that legitimately have no action row: a pure browse/read surface
   * whose only exit is the shell's own × or the overlay tap. Each entry is a
   * DECISION, not a backlog — a popup with a Cancel or a CTA does not belong
   * here.
   */
  const FOOTERLESS_BY_DESIGN: Record<string, string> = {
    "src/components/admin/AdminCommandPalette.tsx": "⌘K palette — Esc is the exit",
    "src/components/admin/adminJobs/JobDetailDialog.tsx": "read-only admin record",
    "src/components/admin/AdminUserDetailDialog.tsx": "read-only admin record, h-[90vh] tabs",
    "src/components/admin/AdminSettings.tsx": "settings save inline per row",
    "src/components/messages/MuteSheet.tsx": "each row IS the action; picking one closes",
    "src/components/messages/MessageActionSheet.tsx": "each row IS the action",
    "src/components/activity/CompletionChoiceSheet.tsx": "each choice IS the action",
    "src/components/profile/HelperScheduleStrip.tsx": "read-only schedule peek",

    // ── Added 2026-08-31, after the lexer fix below stopped this test
    // accusing files that DO have a footer. Each of these was read before
    // being listed; none is here because converting it was inconvenient.
    "src/components/dashboard/FilterSheet.tsx":
      "Filters apply live as you tap them — there is nothing to confirm. Its " +
      "exit is the header × the panel gained when the owner asked for one.",
    // Reason REWRITTEN 2026-08-31. It used to read "pinned in a dedicated grid
    // track … 92dvh phone sheet" — and that geometry was deleted the same day.
    // The sheet is now content-driven (top-[7vh], max-h-[86dvh], no h-*, no
    // grid-rows), because pinning a footer to fill leftover space put 364.7px
    // of dead air above a stranded CTA on a sparse job. So the ORIGINAL reason
    // for the exemption is gone; these two are the reasons that survive.
    "src/components/dashboard/JobDetailDialog.tsx":
      "1) Geometry: every attempt to give this sheet a footer track came with " +
      "a height to pin it against, and that is exactly what produced the dead " +
      "band above a stranded CTA. Content decides the height here; slack stays " +
      "at the end. 2) Shape: three of the CTA slot's four mutually-exclusive " +
      "branches are not commits at all (\"This is your post\", \"Applied — #N\", " +
      "the credential gate), and all four share one h-11/h-12 box to stop the " +
      "sheet resizing when viewerTier lands. dialogShell.test.ts carries the " +
      "matching NO_FOOTER_BY_DESIGN assertion, which fails if this file grows " +
      "a <DialogFooter> or loses its recorded reason.",
    "src/components/feedback/NpsPrompt.tsx":
      "Each score IS the action; tapping one submits and closes.",
    "src/components/dashboard/ApplyConfirmDialog.tsx":
      "Renders no <Button> at all — the confirm is the shell's own affordance.",
    "src/components/EarningsExport.tsx":
      "Each export format is its own action row; picking one starts the " +
      "download and closes.",
    "src/components/mobileNav/GateSheet.tsx":
      "A sign-in gate whose two choices are the content, not a footer under it.",
    "src/components/SosShareButton.tsx":
      "Safety sheet — each share target is the action.",
    "src/components/PhotoProof.tsx":
      "An uploader, not a form: each tile's control is its own action and the " +
      "sheet closes on selection. NOTE it does carry one stray Cancel that " +
      "should move into a shared footer if this ever grows a real action row.",
    "src/components/TipDialog.tsx":
      "Amount presets are the actions; confirming is one of them.",
  };

  it("every popup ends in the shared footer (or is a documented exception)", () => {
    const offenders: string[] = [];
    for (const file of popupFiles()) {
      if (PRIMITIVE_WRAPPERS.has(file)) continue;
      if (file in FOOTERLESS_BY_DESIGN) continue;
      const src = stripComments(repoFile(file));
      const contents = (src.match(/<(DialogContent|AlertDialogContent|SheetContent)\b/g) ?? []).length;
      const footers = (src.match(/<(DialogFooter|AlertDialogFooter|SheetFooter)\b/g) ?? []).length;
      if (footers < contents) {
        offenders.push(
          `${file} — ${contents} popup surface(s), ${footers} shared footer(s). ` +
            `Close it with <DialogFooter> (the same row DialogFooter/AlertDialogFooter/SheetFooter ` +
            `all render), or add it to FOOTERLESS_BY_DESIGN with the reason it has no action row. ` +
            `See src/components/ReportDialog.tsx for the shape.`,
        );
      }
    }
    expect(
      offenders,
      "popups with a bespoke footer (or none):\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("Cancel is a real Button in the footer, never bare floating text", () => {
    // "centred bare text below" and "bare text bottom-right" are two of the six
    // footers the owner counted. Both look like this in source:
    //   <p className="text-center …" onClick={onClose}>Cancel</p>
    // A <p> is not a button: no 44px target, no focus ring, no Enter/Space.
    const BARE = /<(p|span|div)\b[^>]*onClick=[^>]*>\s*(Cancel|Not now|Maybe later|Never mind|Skip|Dismiss)\s*</gi;
    const offenders: string[] = [];
    for (const file of popupFiles()) {
      const src = stripComments(repoFile(file));
      for (const m of src.matchAll(BARE)) {
        offenders.push(
          `${file} — "${m[2]}" is a clickable <${m[1]}>, not a <Button>. ` +
            `It has no 44px target, no focus ring and no keyboard activation. ` +
            `Move it into the <DialogFooter> as <DialogSecondaryAction>. ` +
            `(Not <Button variant="ghost"> — the shared action primitives ` +
            `reject variant/size/className by design, which is what stops ` +
            `footers drifting apart again.)`,
        );
      }
    }
    expect(
      offenders,
      "bare-text dismiss affordances outside the shared footer:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the reference implementation still IS the reference", () => {
    // If ReportDialog.tsx stops following the convention it encodes, this whole
    // describe block is measuring against nothing.
    //
    // 2026-08-31: the reference MOVED. This used to assert ReportDialog
    // rendered a raw `<Button>` for Cancel/Back, because it was the file the
    // convention had been transcribed from. The convention now lives in real
    // primitives (`ui/popupFooter.ts` + the Dialog*Action components), 66
    // popup blocks across 45 files were converted onto them, and those
    // primitives reject `variant`/`size`/`className` outright — so a raw
    // `<Button>` in a footer is now the DEFECT this suite exists to catch,
    // not the reference. Asserting the old shape would have pinned the bug.
    const report = repoFile("src/components/ReportDialog.tsx");
    expect(
      report,
      "ReportDialog.tsx no longer imports DialogFooter — it is the file this " +
        "convention is transcribed from; pick a new reference or fix it.",
    ).toMatch(/DialogFooter/);
    expect(
      report,
      "ReportDialog.tsx no longer uses the shared dismiss primitive for " +
        "Cancel/Back. It is the reference for this suite, so it must be built " +
        "from DialogSecondaryAction like every other converted footer.",
    ).toMatch(/<DialogSecondaryAction[\s\S]{0,80}(Cancel|Back|Done)/);
  });
});
