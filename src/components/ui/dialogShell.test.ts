import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * EVERY popup wears the same shell — AND speaks the same grammar inside it.
 *
 * ─── WHY THIS FILE GREW A SECOND HALF ──────────────────────────────────────
 *
 * The first half of this suite (the width / escape-hatch / overlay checks) has
 * been green since 2026-08-30. On 2026-08-31 the owner put five popups side by
 * side from a real device and said: "Every single pop up like this needs to be
 * styled the same. Globally no excuses. There are a lot of these that are
 * wrong." It was the third time they had reported it.
 *
 * All five of those dialogs PASSED this file. That is the important fact about
 * it: the shell was genuinely unified — one glass material, one 512px measure,
 * one serif title, one bare X — and the tests here proved it. What diverged was
 * everything the tests did not look at. Measured across all 51
 * `<DialogContent>` blocks in `src/`:
 *
 *   ICON TILE  one popup rendered a bespoke 56px tile above the Hero, which
 *              pushed the title off the top row and left the X aligned to an
 *              icon instead of a heading.
 *   BODY       24 dialogs spoke the house serif italic at SEVEN different
 *              sizes; 21 spoke `text-ds-11 text-muted-foreground` — shadcn's
 *              grey default, copied dialog to dialog. "Report No-Show", where
 *              a poster reads three consequences before ending someone's
 *              booking, was one of the grey ones.
 *   FOOTER     five dialogs, five footers. The dismiss alone shipped as a
 *              white card, as ghost text at full width, as a small
 *              right-aligned link, as a bordered `outline` button (6 dialogs)
 *              and as a hand-styled burnt-sienna slab. Fourteen footer buttons
 *              carried a `className`.
 *
 * So the rules below are not new opinions — they are the things that were
 * already broken while this file said everything was fine. A guard that cannot
 * fail is worse than no guard, so every assertion added here was verified to
 * FAIL when its specific divergence is put back (see the header of each).
 *
 * ─── THE GRAMMAR BEING ENFORCED ────────────────────────────────────────────
 *
 * Header  `<DialogHero title>`, first thing inside the content, nothing above.
 * Body    prose through `<DialogBody>` — serif italic, ds-12, olivewood/0.8,
 *         the treatment `BrandConfirmDialog` already gives ~26 confirms.
 * Footer  `<DialogFooter>` from `popupFooter.ts`: a small ghost dismiss hard
 *         left, the commit at the right end, dismiss first in the DOM.
 *         (Owner, 2026-08-31, shown the three variants their own screenshots
 *         contained: "Small, I feel like left aligned makes more sense than
 *         right.")
 * Commit  glossy `DialogPrimaryAction`, or flat-red `DialogDestructiveAction`
 *         when the action is irreversible or takes something away. One
 *         destructive colour app-wide.
 */

const UI = resolve(__dirname);
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Comments explain the rules; they must not satisfy them. */
const stripComments = (t: string) =>
  t
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments

// ───────────────────────────────────────────────────────────────────────────
// Part 1 — the shell (unchanged; these already passed and must keep passing)
// ───────────────────────────────────────────────────────────────────────────

const BANNED = ["max-w-xs", "max-w-sm", "max-w-md"];

/** Dialogs whose measure is deliberately not the default, and why. */
const STRUCTURAL_EXCEPTIONS: Record<string, string> = {
  "JobDetailDialog.tsx": "deliberately wide on desktop — lg:max-w-3xl xl:max-w-4xl",
  "PhotoLightbox.tsx": "media viewer — sized to the viewport",
};

function dialogFiles(): string[] {
  const out = execSync(
    "grep -rl -E '<(DialogContent|AlertDialogContent)' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: ROOT },
  );
  return out.split("\n").filter(Boolean);
}

/**
 * Every popup CONTENT block in the app — Dialog and AlertDialog alike,
 * comments stripped. Both families, because "globally" is the instruction and
 * a confirm sheet opening next to a dialog is the comparison being made.
 */
function contentBlocks(tags = ["DialogContent", "AlertDialogContent"]) {
  const out: { file: string; nth: number; block: string; tag: string }[] = [];
  const files = execSync(
    "grep -rl -E '<(DialogContent|AlertDialogContent)' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("src/components/ui/"));
  for (const f of files) {
    const src = stripComments(read(f));
    for (const tag of tags) {
      let i = 0;
      let n = 0;
      for (;;) {
        // `<DialogContent` is a prefix of nothing, but `AlertDialogContent`
        // CONTAINS `DialogContent` — anchor on the `<` so the two families
        // are not double-counted.
        const s = src.indexOf("<" + tag, i);
        if (s < 0) break;
        const e = src.indexOf("</" + tag + ">", s);
        if (e < 0) break;
        out.push({ file: f, nth: ++n, block: src.slice(s, e), tag });
        i = e + 5;
      }
    }
  }
  return out;
}
const dialogBlocks = () => contentBlocks(["DialogContent"]);

/** Every popup footer in the app — Dialog, AlertDialog and Sheet alike. */
function footers(): { file: string; nth: number; body: string }[] {
  const out: { file: string; nth: number; body: string }[] = [];
  const files = execSync(
    "grep -rl -E '<(Dialog|AlertDialog|Sheet)Footer' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("src/components/ui/"));
  for (const f of files) {
    const src = stripComments(read(f));
    let n = 0;
    for (const m of src.matchAll(
      /<(Dialog|AlertDialog|Sheet)Footer[^>]*>([\s\S]*?)<\/\1Footer>/g,
    )) {
      out.push({ file: f, nth: ++n, body: m[2] });
    }
  }
  return out;
}

describe("Popups share one shell", () => {
  it("finds dialog files at all (guards the grep rotting)", () => {
    expect(dialogFiles().length).toBeGreaterThan(10);
  });

  it("no dialog overrides the shared content width", () => {
    const offenders: string[] = [];
    for (const rel of dialogFiles()) {
      const base = rel.split("/").pop()!;
      if (base in STRUCTURAL_EXCEPTIONS) continue;
      const src = read(rel);
      for (const m of src.matchAll(/<(DialogContent|AlertDialogContent)\b([^>]*?)>/gs)) {
        const cm = /className=\{?"([^"]*)"/.exec(m[2]);
        if (!cm) continue;
        const hit = cm[1].split(/\s+/).filter((t) => BANNED.includes(t));
        if (hit.length) offenders.push(`${base}: ${hit.join(" ")}`);
      }
    }
    expect(
      offenders,
      "dialogs overriding the shared width — use the default max-w-lg, or add a documented STRUCTURAL_EXCEPTION",
    ).toEqual([]);
  });

  it("the shared default is still max-w-lg in BOTH primitives", () => {
    expect(read("src/components/ui/dialog.tsx")).toContain("max-w-lg");
    expect(read("src/components/ui/alert-dialog.tsx")).toContain("max-w-lg");
  });

  it("the two modal overlays use the SAME backdrop tint", () => {
    const tint = (file: string) => {
      const src = readFileSync(resolve(UI, file), "utf8");
      return /backgroundColor:\s*"(hsla\([^"]*\))"/.exec(src)?.[1];
    };
    expect(tint("dialog.tsx")).toBeDefined();
    expect(tint("alert-dialog.tsx")).toBe(tint("dialog.tsx"));
  });

  it("all three popup primitives keep their own backdrop blur", () => {
    // The panel lane removed the blur from popover/anchoredPanel on purpose.
    // Modals are not panels: this is what separates a dialog from the page.
    for (const f of ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx"]) {
      expect(
        readFileSync(resolve(UI, f), "utf8"),
        `${f} must keep the modal backdrop blur`,
      ).toMatch(/backdrop-blur-\[24px\]/);
    }
  });

  it("Hero components expose no per-call-site style escape hatches", () => {
    const dlg = stripComments(read("src/components/ui/dialog.tsx"));
    const alert = stripComments(read("src/components/ui/alert-dialog.tsx"));
    const sheet = stripComments(read("src/components/ui/sheet.tsx"));
    for (const prop of ["titleClassName", "titleStyle", "eyebrowClassName", "eyebrowStyle"]) {
      expect(dlg, `dialog.tsx must not accept ${prop}`).not.toContain(prop);
      expect(alert, `alert-dialog.tsx must not accept ${prop}`).not.toContain(prop);
      expect(sheet, `sheet.tsx must not accept ${prop}`).not.toContain(prop);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Part 2 — the grammar INSIDE the shell. This is the half that was missing.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Files another lane owns right now — EMPTY, and it stays empty.
 *
 * It held two entries for one working day (2026-08-31): JobDetailDialog and
 * SecurityTab were open in other lanes while the grammar pass converted the
 * other 45 files, so they were listed here rather than skipped silently. Both
 * have since been converted and both entries are gone — SecurityTab's footer
 * is the two shared action primitives, and JobDetailDialog's badge strip moved
 * out from above its Hero, its description and video caption moved onto
 * DialogBody.
 *
 * The owner's instruction was "globally no excuses", and a named exemption
 * that outlives the handover it describes is an excuse. Nothing in the app is
 * exempt from the grammar below. If a lane genuinely holds a file, add it here
 * WITH the date and remove it the same day; a real, permanent design exception
 * belongs in a map named for what it is (see NO_FOOTER_BY_DESIGN) with a test
 * that still asserts something, not in a blanket skip.
 */
const OTHER_LANES: Record<string, string> = {};

describe("Popup grammar — header", () => {
  /**
   * FAILS IF: the icon tile comes back.
   * Verified by re-adding PermissionRationaleDialog's 56px tile above its Hero.
   */
  it("nothing is rendered above the Hero — no icon tiles, no eyebrow rows", () => {
    const offenders: string[] = [];
    for (const { file, nth, block } of dialogBlocks()) {
      if (file in OTHER_LANES) continue;
      const hero = block.indexOf("<DialogHero");
      if (hero < 0) continue;
      const openEnd = block.indexOf(">", block.indexOf("<DialogContent"));
      const before = block.slice(openEnd + 1, hero);
      // A LAYOUT WRAPPER around the Hero is fine — it is still opened, not
      // closed, when the Hero appears (AdminUserDetailDialog puts the Hero in
      // a `border-b` row so the tab strip below it has a rule). What is banned
      // is an element that opens AND closes, or self-closes, before the Hero:
      // that is rendered content sitting above the title.
      const rendered = [
        ...before.matchAll(/<([A-Za-z][\w.]*)\b[^>]*?\/>/g),
        ...before.matchAll(/<([A-Za-z][\w.]*)\b[^>]*>[\s\S]*?<\/\1>/g),
      ];
      if (rendered.length) {
        offenders.push(`${file}#${nth}: <${rendered[0][1]}> renders above <DialogHero>`);
      }
    }
    expect(
      offenders,
      "the Hero's title is the first thing in a popup — an icon tile above it pushes the title off the row the X is aligned to",
    ).toEqual([]);
  });
});

describe("Popup grammar — body voice", () => {
  /**
   * FAILS IF: a dialog's prose goes back to shadcn's grey upright sans.
   * Verified by restoring Report No-Show's
   * `<p className="text-ds-11 text-muted-foreground">`.
   *
   * Scoped to PROSE, which is what `<p>`/`<ul>` carrying nothing but the muted
   * default are. Field labels, data rows and money tables are chrome, not the
   * dialog's voice, and are already consistent — the files below are read-only
   * data viewers built entirely out of them.
   */
  const DATA_VIEWERS: Record<string, string> = {
    "src/components/admin/adminJobs/JobDetailDialog.tsx":
      "read-only admin data viewer — every muted line is a field VALUE beside its label, not prose",
    "src/components/admin/AdminSettings.tsx":
      "search-results list — the muted lines are result rows and an empty state",
    "src/components/admin/EditEmailDialog.tsx":
      "the muted line is the current-email data row inside a card, not the dialog's prose",
    "src/components/admin/adminJobs/RemoveJobDialog.tsx":
      "the remaining muted lines are the 'Job being removed' card's label/value pair",
    "src/components/admin/adminJobs/RefundJobDialog.tsx":
      "the remaining muted lines are the 'Refunding' card's label/value pair",
    // (The dashboard `JobDetailDialog.tsx` was listed here too, with the reason
    // "owned by another lane". That is a handover note, not a data-viewer
    // exemption — it was converted 2026-08-31 and now carries no muted prose at
    // all, so the entry is gone and the file is covered by this rule like every
    // other. The ADMIN JobDetailDialog above is a different file and stays.)

    // ── NOT converted, and deliberately so ────────────────────────────────
    // DialogBody is for the dialog's own NARRATION. These three put their
    // muted text inside bordered notice/data panels that carry their own
    // colour and structure (a bold label with an explanatory line under it, a
    // numbered policy ladder, a card's empty state). Setting those in
    // editorial serif italic would not make the app more consistent — it would
    // put the body voice on something that is not the body. Listed rather than
    // silently skipped so the decision is on the record and reversible.
    "src/components/IDVPromptDialog.tsx":
      "amber notice cards — each is a bold label + explanatory line inside its own panel, not the dialog's narration",
    "src/components/CancellationDialog.tsx":
      "the numbered cancellation-policy ladder — a structured data panel with per-step headings, badges and fee rows",
    "src/components/PhotoProof.tsx":
      "per-card empty states inside the photo grid, not the dialog's narration",
  };

  // Any <p>/<ul> whose class list contains the muted upright-sans default,
  // with or without extra utilities — `text-center py-6` on an empty state is
  // still the wrong voice.
  const GREY_PROSE = /<(p|ul)\s+className="(?![^"]*\buppercase\b)[^"]*\b(?:text-ds-11|text-sm|text-xs)\b[^"]*\btext-muted-foreground\b[^"]*"/;

  /**
   * Single lines that are form-control helper text — the sentence under a
   * checkbox's own sans label, inside its `<label>`. Setting one of those in
   * editorial serif italic would put the body voice on a form control, not on
   * the dialog. Named line by line rather than exempting the whole file, so
   * everything else in it stays covered.
   */
  const ALLOWED_GREY_LINES = [
    "Logs the warning but does NOT escalate", // FormalWarningDialog — bypass checkbox
  ];

  it("popup prose uses DialogBody, never the grey upright-sans default", () => {
    const offenders: string[] = [];
    for (const { file, nth, block } of contentBlocks()) {
      if (file in DATA_VIEWERS || file in OTHER_LANES) continue;
      for (const m of block.matchAll(new RegExp(GREY_PROSE.source, "g"))) {
        const after = block.slice(m.index!, m.index! + 320);
        if (ALLOWED_GREY_LINES.some((l) => after.includes(l))) continue;
        offenders.push(`${file}#${nth}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(
      offenders,
      "wrap the prose in <DialogBody> — or, if it is a data row rather than prose, add the file to DATA_VIEWERS with a reason",
    ).toEqual([]);
  });

  /**
   * FAILS IF: DialogBody and the confirm family's description drift apart.
   * The Dialog and AlertDialog families are twins; the whole complaint is that
   * a confirm opening next to a dialog looks like a different product.
   */
  it("DialogBody is byte-identical to the confirm family's description", () => {
    const dlg = read("src/components/ui/dialog.tsx");
    const brand = read("src/components/ui/BrandConfirmDialog.tsx");
    const TYPE = "font-serif italic text-ds-12 leading-relaxed";
    const COLOR = 'hsl(var(--olivewood) / 0.8)';
    expect(dlg, "DialogBody's type token").toContain(TYPE);
    expect(dlg, "DialogBody's colour").toContain(COLOR);
    expect(brand, "AlertDialogDescription's type token").toContain(TYPE);
    expect(brand, "AlertDialogDescription's colour").toContain(COLOR);
  });
});

describe("Popup grammar — footer", () => {
  /** The one three-action footer in the app, and why it is allowed to be. */
  const THREE_ACTION_EXCEPTIONS: Record<string, string> = {
    "src/components/BlockUserDialog.tsx":
      "'Just Block' and 'Block and Report' are two different writes; neither may be dropped to fit the pattern. Only one renders as the red commit.",
  };
  /** Footers whose commit is chosen at render time between two components. */
  const BRANCHED_COMMITS: Record<string, string> = {
    "src/components/IDVPromptDialog.tsx": "pay-the-fee vs start-verification — exactly one renders",
    "src/components/admin/BanDialog.tsx": "warning commits glossy, ban commits red — exactly one renders",
    "src/components/BlockUserDialog.tsx": "see THREE_ACTION_EXCEPTIONS",
  };

  /**
   * THE ONE POPUP WITH NO FOOTER AT ALL, and why that is a decision rather
   * than an omission.
   *
   * This is the narrowed remains of JobDetailDialog's `OTHER_LANES` entry. The
   * other three things that entry covered are fixed — the badge strip no
   * longer renders above the Hero, and the description and video caption speak
   * `DialogBody` — so the file is now subject to every rule in this file
   * except this one.
   *
   * WHY. The grammar's footer is at most one dismiss plus at most one commit,
   * built only from the shared action primitives. The job sheet's action strip
   * is not that shape: three of its four mutually-exclusive branches are not
   * commits ("This is your post" and "Applied — #3" are status, the credential
   * gate is a navigation), all four are deliberately the same `h-11 sm:h-12`
   * box because an unequal branch made the dialog resize under the reader when
   * `viewerTier` resolved (measured 880px -> 746px, the owner's "opens bigger
   * then gets smaller"), and the action primitives accept no `size` — by
   * design — so that invariant cannot be expressed through them. On a phone
   * POPUP_FOOTER_ROW is a reversed column, so a footer would also stack the
   * 44px Message icon as a second full-width bar under the CTA, undoing the
   * owner's 2026-08-30 consolidation to one full-width CTA.
   *
   * And the geometry: every previous attempt to give this sheet a footer TRACK
   * arrived with a height to pin it against, which opened a sparse job at 747px
   * with 364.7px of dead space above a stranded CTA. The lesson recorded in
   * that file is that pinning a footer to fill leftover space moves the
   * emptiness somewhere worse.
   *
   * So this is asserted, not skipped: adding a footer here fails, and the
   * failure points at the reasoning to re-read and re-measure first.
   *
   * RELATED, and deliberately not merged: `src/test/popupShellInventory.test.ts`
   * keeps the complementary list — popups ALLOWED to have no action row — and
   * already lists this file. That list permits; this one PINS. Its entry for
   * this file still gives the reason as "its CTA is pinned in a dedicated grid
   * track … (92dvh phone sheet)", which is the geometry that was deleted on
   * 2026-08-31 — the sheet has no height and no explicit tracks any more. That
   * file belongs to another lane, so the stale reason is flagged here rather
   * than edited from this one.
   */
  const NO_FOOTER_BY_DESIGN: Record<string, string> = {
    "src/components/dashboard/JobDetailDialog.tsx":
      "body-level action strip, not a footer — see the WHY THERE IS NO <DialogFooter> HERE block in that file",
  };

  it("the one footerless popup stays footerless, and keeps its reason", () => {
    for (const [file, why] of Object.entries(NO_FOOTER_BY_DESIGN)) {
      expect(
        stripComments(read(file)),
        `${file} grew a footer — ${why}. Re-read that block and re-measure a sparse job at 320/375 before changing this.`,
      ).not.toContain("<DialogFooter");
      expect(
        read(file),
        `${file} must keep the recorded reason next to the code, not only here`,
      ).toContain("WHY THERE IS NO <DialogFooter> HERE");
    }
  });

  const ACTION = /<(Dialog|Sheet)(Secondary|Primary|Destructive)Action\b|<AlertDialog(Cancel|Action)\b/g;

  /**
   * FAILS IF: any footer goes back to a raw <Button>.
   * Verified by restoring Timeline's `<Button variant="outline">Close</Button>`
   * — which is precisely the divergence in the owner's screenshot set.
   */
  it("footers are built ONLY from the shared action primitives", () => {
    const offenders: string[] = [];
    for (const { file, nth, body } of footers()) {
      if (file in OTHER_LANES) continue;
      if (/<Button\b|<button\b/.test(body)) offenders.push(`${file}#${nth}`);
    }
    expect(
      offenders,
      "use DialogSecondaryAction / DialogPrimaryAction / DialogDestructiveAction (or the Sheet + AlertDialog twins). A raw <Button> is how `outline`, `w-full` and hand-rolled inline styles got back in.",
    ).toEqual([]);
  });

  /**
   * FAILS IF: a footer action carries a className again.
   * Verified by putting `className="rounded-ds-md"` back on JobConfirmation's
   * commit — 14 footer buttons carried one before this pass.
   */
  it("no footer action carries a className, variant, size or style", () => {
    const offenders: string[] = [];
    for (const { file, nth, body } of footers()) {
      for (const m of body.matchAll(
        /<(?:(?:Dialog|Sheet)(?:Secondary|Primary|Destructive)Action|AlertDialog(?:Cancel|Action))\b([^>]*)>/g,
      )) {
        const attrs = m[1];
        for (const banned of ["className", "size=", "style="]) {
          if (attrs.includes(banned)) offenders.push(`${file}#${nth}: ${banned}`);
        }
        // `variant` is legitimate on AlertDialogAction (its documented
        // destructive switch) and nowhere else.
        if (attrs.includes("variant") && !m[0].startsWith("<AlertDialogAction")) {
          offenders.push(`${file}#${nth}: variant`);
        }
      }
    }
    expect(offenders, "the action primitives own their treatment — that is the point of them").toEqual([]);
  });

  /**
   * FAILS IF: the commit is put before the dismiss.
   * Verified against ReviewForm, which shipped that way: on a phone its
   * "Maybe Later" sat on top of "Submit Review", mirror-imaged from the tip
   * prompt 40 lines below it in the same file.
   */
  it("the dismiss comes FIRST in the DOM, the commit LAST", () => {
    const offenders: string[] = [];
    for (const { file, nth, body } of footers()) {
      const seq = [...body.matchAll(ACTION)].map((m) => m[0]);
      const isDismiss = (t: string) => /Secondary|AlertDialogCancel/.test(t);
      const lastDismiss = seq.map(isDismiss).lastIndexOf(true);
      const firstCommit = seq.findIndex((t) => !isDismiss(t));
      if (lastDismiss >= 0 && firstCommit >= 0 && lastDismiss > firstCommit) {
        offenders.push(`${file}#${nth}: ${seq.join(" > ")}`);
      }
    }
    expect(
      offenders,
      "DOM order must match visual order (WCAG 2.4.3) — dismiss is on the left, so it is first",
    ).toEqual([]);
  });

  /**
   * FAILS IF: a footer grows a shape the grammar does not have.
   * Four shapes only: dismiss+commit, commit only, dismiss only,
   * destructive+dismiss.
   */
  it("a footer holds at most one dismiss and at most one commit", () => {
    const offenders: string[] = [];
    for (const { file, nth, body } of footers()) {
      const seq = [...body.matchAll(ACTION)].map((m) => m[0]);
      const dismisses = seq.filter((t) => /Secondary|AlertDialogCancel/.test(t)).length;
      const commits = seq.length - dismisses;
      if (dismisses > 1 && !(file in THREE_ACTION_EXCEPTIONS)) {
        offenders.push(`${file}#${nth}: ${dismisses} dismisses`);
      }
      if (commits > 1 && !(file in BRANCHED_COMMITS)) {
        offenders.push(`${file}#${nth}: ${commits} commits`);
      }
    }
    expect(
      offenders,
      "two commits is two primary actions — the hierarchy defect. Document a branch in BRANCHED_COMMITS if exactly one renders.",
    ).toEqual([]);
  });

  /**
   * FAILS IF: the three footers stop being one object.
   * They used to be three copies of a layout string kept in agreement by this
   * test, and SheetFooter had already lost `gap-2` from its copy.
   */
  it("Dialog, AlertDialog and Sheet footers all come from popupFooter.ts", () => {
    for (const f of ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx"]) {
      const src = readFileSync(resolve(UI, f), "utf8");
      expect(src, `${f} must import the shared footer row`).toContain(
        'from "@/components/ui/popupFooter"',
      );
      expect(src, `${f}'s footer must BE the shared row`).toMatch(
        /cn\(POPUP_FOOTER_ROW, className\)/,
      );
      expect(
        stripComments(src),
        `${f} must not re-declare its own footer layout`,
      ).not.toContain("flex flex-col-reverse");
    }
  });

  /**
   * FAILS IF: the dismiss stops being small, or stops being on the left.
   * This is the owner's own decision (2026-08-31: "Small, I feel like left
   * aligned makes more sense than right"), so it is pinned to the literal
   * treatment rather than to a shape description.
   */
  it("the dismiss is small and the commit takes the right-hand end", () => {
    const dlg = read("src/components/ui/dialog.tsx");
    const alert = read("src/components/ui/alert-dialog.tsx");
    const sheet = read("src/components/ui/sheet.tsx");
    const footer = read("src/components/ui/popupFooter.ts");

    // SAME HEIGHT as the commit, not a step down. The footer became a ROW on
    // 2026-09-02 (owner, from rendered comparisons), so WIDTH carries the
    // hierarchy — a quarter against three quarters — and a shorter dismiss read
    // as mismatched rather than ranked. `size="sm"` was right only while the two
    // were stacked full-width, where height was the sole available signal.
    expect(dlg).toMatch(/variant="ghost" className=\{POPUP_SECONDARY_CLS\}/);
    expect(dlg).not.toMatch(/variant="ghost" size="sm" className=\{POPUP_SECONDARY_CLS\}/);

    // ONE QUARTER / THREE QUARTERS, at every width. `flex-1` against `flex-[3]`
    // is the whole hierarchy: the dismiss is present and reachable, the commit
    // is unmistakably the main action, and there is no breakpoint at which the
    // two rearrange — a popup that reorders its own buttons at `sm` is two
    // designs, and the person who meets both is the one testing on a phone and
    // a laptop.
    expect(footer).toMatch(/POPUP_SECONDARY_CLS =\n\s*"flex-1 /);
    expect(footer).toMatch(/POPUP_COMMIT_CLS = "flex-\[3\][^"]*"/);
    // `min-w-0` on BOTH: without it a flex item refuses to shrink below its
    // content, so a long label would blow the ratio out instead of fitting.
    expect(footer).toMatch(/POPUP_SECONDARY_CLS =\n\s*"flex-1 min-w-0 /);
    expect(footer).toMatch(/POPUP_COMMIT_CLS = "flex-\[3\] min-w-0"/);
    // Column on a phone, row from sm — measured: a one-row footer cannot hold
    // a third of the app's commit labels at 375 (see popupFooter.ts).
    // One row, at every width — no `sm:` reflow. See the note above.
    expect(footer).toContain('POPUP_FOOTER_ROW = "flex items-center gap-3 pt-2"');
  });

  /**
   * FAILS IF: the commit stops being glossy, or a second destructive colour
   * appears. Verified by restoring CancellationDialog's hand-styled
   * `backgroundImage: "none"` sienna button.
   */
  it("one glossy primary and one destructive red, from the shared variants", () => {
    const dlg = stripComments(read("src/components/ui/dialog.tsx"));
    expect(dlg).toMatch(/variant="primary" className=\{POPUP_COMMIT_CLS\}/);
    expect(dlg).toMatch(/variant="destructive" className=\{POPUP_COMMIT_CLS\}/);

    // No popup may paint its own commit. Scoped to FOOTERS, which is where
    // commits live — a sienna remove-badge on a photo thumbnail elsewhere in
    // the body is a different control and not this rule's business.
    //
    // `backgroundImage: "none"` is the specific tell for the gloss being
    // switched off by hand; a solid `--burnt-sienna` fill is the tell for a
    // second destructive colour (the brand ACCENT, which also paints things
    // that are merely notable). CancellationDialog's commit did both.
    const offenders: string[] = [];
    for (const { file, nth, body } of footers()) {
      if (file in OTHER_LANES) continue;
      if (/backgroundImage:\s*"none"/.test(body)) offenders.push(`${file}#${nth}: gloss switched off by hand`);
      if (/background:\s*"hsl\(var\(--burnt-sienna\)\)"/.test(body)) {
        offenders.push(`${file}#${nth}: solid sienna commit`);
      }
    }
    expect(
      [...new Set(offenders)],
      "the commit is DialogPrimaryAction or DialogDestructiveAction — never a hand-painted button",
    ).toEqual([]);
  });
});
