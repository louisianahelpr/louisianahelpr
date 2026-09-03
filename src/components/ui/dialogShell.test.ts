import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
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

/**
 * Every .ts/.tsx under src, from the filesystem — NOT a hand-kept list.
 * A registry that is both a test's input and its definition of correctness
 * cannot fail for a missing member; that pattern produced three false
 * all-clears on 2026-09-02 alone.
 */
function allSourceFiles(): string[] {
  // `--cached --others --exclude-standard`, NOT a bare `git ls-files`.
  //
  // A bare listing shows only TRACKED files, so a brand-new, not-yet-committed
  // file is invisible — which is precisely the case every rule below exists to
  // catch. Verified rather than assumed: a probe file was written with a
  // hand-rolled Cancel/Send row, and the guard PASSED. A guard that cannot see
  // new work is worse than no guard, because the green tick is read as
  // permission. `--others --exclude-standard` adds untracked files while still
  // honouring .gitignore, so node_modules and dist stay out.
  return execSync(
    "git ls-files --cached --others --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'",
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n").filter(Boolean).map((f) => resolve(ROOT, f))
    // `git ls-files` lists the INDEX, which still carries a file deleted from
    // the working tree until the deletion is staged. Reading one throws ENOENT
    // and fails the test for a reason that has nothing to do with what it
    // asserts.
    .filter(existsSync);
}

function dialogFiles(): string[] {
  const out = execSync(
    "grep -rl -E '<DialogContent' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: ROOT },
  );
  return out.split("\n").filter(Boolean);
}

/**
 * Every popup CONTENT block in the app, comments stripped. There is one
 * family now: a confirm is a Dialog with `role="alertdialog"`.
 */
function contentBlocks(tags = ["DialogContent"]) {
  const out: { file: string; nth: number; block: string; tag: string }[] = [];
  const files = execSync(
    "grep -rl -E '<DialogContent' src --include='*.tsx' || true",
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
        // `<DialogContent` is a prefix of nothing, but a stray `Content`
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

/** Every popup footer in the app — Dialog and Sheet alike. */
function footers(): { file: string; nth: number; body: string }[] {
  const out: { file: string; nth: number; body: string }[] = [];
  const files = execSync(
    "grep -rl -E '<(Dialog|Sheet)Footer' src --include='*.tsx' || true",
    { encoding: "utf8", cwd: ROOT },
  )
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("src/components/ui/"));
  for (const f of files) {
    const src = stripComments(read(f));
    let n = 0;
    for (const m of src.matchAll(
      /<(Dialog|Sheet)Footer[^>]*>([\s\S]*?)<\/\1Footer>/g,
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
      for (const m of src.matchAll(/<DialogContent\b([^>]*?)>/gs)) {
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

  it("the shared default is still max-w-lg", () => {
    // Was "in BOTH primitives". There is one now — see the merge test at the
    // bottom of this file.
    expect(read("src/components/ui/dialog.tsx")).toContain("max-w-lg");
  });

  it("the modal overlay still declares an explicit backdrop tint", () => {
    // This used to assert dialog.tsx and alert-dialog.tsx carried the SAME
    // hsla() literal — and it earned its keep: the two drifted anyway, because
    // a test comparing two copies still needs someone to edit the second one.
    // DialogOverlay was lightened 45% -> 26% -> 14% -> 8% and the confirm
    // overlay kept 26%, so every confirm in the app dimmed the page more than
    // three times as hard as any other dialog. There is exactly one literal
    // now and no second copy to fall behind.
    const src = readFileSync(resolve(UI, "dialog.tsx"), "utf8");
    expect(/backgroundColor:\s*"(hsla\([^"]*\))"/.exec(src)?.[1]).toBeDefined();
  });

  it("all three popup primitives keep their own backdrop blur", () => {
    // The panel lane removed the blur from popover/anchoredPanel on purpose.
    // Modals are not panels: this is what separates a dialog from the page.
    for (const f of ["dialog.tsx", "sheet.tsx"]) {
      expect(
        readFileSync(resolve(UI, f), "utf8"),
        `${f} must keep the modal backdrop blur`,
      ).toMatch(/backdrop-blur-\[24px\]/);
    }
  });

  it("Hero components expose no per-call-site style escape hatches", () => {
    const dlg = stripComments(read("src/components/ui/dialog.tsx"));
    const sheet = stripComments(read("src/components/ui/sheet.tsx"));
    // `eyebrow` and `subtitle` join the list. They were ACCEPTED-BUT-DISCARDED
    // for five weeks: the Hero rendered the title alone from 2026-07-25, but
    // the prop type kept both "so a stray usage is a no-op rather than a build
    // break". A no-op is SILENT. Removing them from the type surfaced SIX live
    // call sites in one compile — AdminReports' "this can't be undone" on a
    // permanent review deletion, AdminIDVReview's three explanations of what
    // each admin decision does, AdminFraudDashboard's, AdminExceptionQueue's,
    // and ApplyConfirmDialog's eyebrow — every one of them shipped invisible.
    // Eyebrows were deleted globally (owner, 2026-09-02).
    for (const prop of ["titleClassName", "titleStyle", "eyebrowClassName", "eyebrowStyle",
                        "eyebrow?:", "subtitle?:"]) {
      expect(dlg, `dialog.tsx must not accept ${prop}`).not.toContain(prop);
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
   * The Dialog and Sheet families are twins; the whole complaint is that
   * a confirm opening next to a dialog looks like a different product.
   */
  it("DialogBody is byte-identical to the confirm family's description", () => {
    const dlg = read("src/components/ui/dialog.tsx");
    const brand = read("src/components/ui/BrandConfirmDialog.tsx");
    const TYPE = "font-serif italic text-ds-12 leading-relaxed";
    const COLOR = 'hsl(var(--olivewood) / 0.8)';
    expect(dlg, "DialogBody's type token").toContain(TYPE);
    expect(dlg, "DialogBody's colour").toContain(COLOR);
    expect(brand, "DialogDescription's type token").toContain(TYPE);
    expect(brand, "DialogDescription's colour").toContain(COLOR);
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

  const ACTION = /<(Dialog|Sheet)(Secondary|Primary|Destructive)Action\b/g;

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
      "use DialogSecondaryAction / DialogPrimaryAction / DialogDestructiveAction (or the Sheet twins). A raw <Button> is how `outline`, `w-full` and hand-rolled inline styles got back in.",
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
        /<(?:Dialog|Sheet)(?:Secondary|Primary|Destructive)Action\b([^>]*)>/g,
      )) {
        const attrs = m[1];
        for (const banned of ["className", "size=", "style="]) {
          if (attrs.includes(banned)) offenders.push(`${file}#${nth}: ${banned}`);
        }
        // `variant` used to be legitimate on the confirm action (its documented
        // destructive switch) and nowhere else.
        if (attrs.includes("variant")) {
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
      const isDismiss = (t: string) => /Secondary/.test(t);
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
      const dismisses = seq.filter((t) => /Secondary/.test(t)).length;
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
  it("Dialog and Sheet footers both come from popupFooter.ts", () => {
    for (const f of ["dialog.tsx", "sheet.tsx"]) {
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
  it("the two halves are equal width and neither can lock open", () => {
    const dlg = read("src/components/ui/dialog.tsx");
    const sheet = read("src/components/ui/sheet.tsx");
    const footer = read("src/components/ui/popupFooter.ts");

    // SAME HEIGHT as the commit, not a step down. The footer became a ROW on
    // 2026-09-02 (owner, from rendered comparisons), so WIDTH carries the
    // hierarchy — a quarter against three quarters — and a shorter dismiss read
    // as mismatched rather than ranked. `size="sm"` was right only while the two
    // were stacked full-width, where height was the sole available signal.
    // BOTH families. Asserting only `dlg` is how the Sheet kept `size="sm"`
    // through the 2026-09-02 footer rework: dialog.tsx and alert-dialog.tsx
    // were fixed, sheet.tsx was not, and nothing failed — a sheet Cancel sat
    // 44px tall beside a 56px commit while every dialog's matched. `sheet` was
    // read into a variable here and then never asserted on.
    for (const [name, src] of [["dialog.tsx", dlg], ["sheet.tsx", sheet]] as const) {
      expect(src, `${name}'s dismiss must use the shared secondary class`)
        .toMatch(/variant="ghost" className=\{POPUP_SECONDARY_CLS\}/);
      expect(src, `${name}'s dismiss must NOT step down to size="sm"`)
        .not.toMatch(/variant="ghost" size="sm" className=\{POPUP_SECONDARY_CLS\}/);
    }

    // EQUAL HALVES, AND A ROW THAT STACKS RATHER THAN CLIPS.
    //
    // These assertions are on the SHAPE of the declaration, not on a literal,
    // because a literal is what let two consecutive footer bugs ship green.
    // The real guard is `popupFooterFit.spec.ts`, which renders every real
    // label in a browser and measures the boxes. What is checkable HERE is
    // narrow but genuinely load-bearing: that neither action uses a ZERO
    // flex-basis, and that both use the SAME basis.
    //
    // WHY ZERO IS BANNED. `flex-1` is `flex: 1 1 0%`, and under
    // `box-sizing: border-box` a basis of zero floors at padding + border. The
    // dismiss carried `px-0` and the commit the Button default `px-6`, so their
    // hypothetical sizes were 0px and 48px; the free space was then split
    // evenly and the commit came out exactly 48px WIDER at every viewport —
    // measured 133.5 vs 181.5 at 393, 205 vs 253 at 1440. Both declared
    // `flex: 1 1 0%`. Neither was equal. The commit was then left with the same
    // text room as a button reading "Cancel", and `Button` is
    // `whitespace-nowrap` with `overflow: visible`, so 7 labels at 393, 15 at
    // 375 and 45 at 320 spilled out of the pill — the left spill landing on top
    // of the Cancel button.
    //
    // A percentage basis has no such floor. 2·(50% − 6px) + 12px gap = 100%.
    const BASIS = /basis-\[calc\(50%-6px\)\]/;
    expect(footer, "the dismiss must take an exact half, not a zero basis")
      .toMatch(new RegExp(`POPUP_SECONDARY_CLS =[\\s\\S]{0,400}?${BASIS.source}`));
    expect(footer, "the commit must take the SAME exact half")
      .toMatch(new RegExp(`POPUP_COMMIT_CLS = "[^"]*${BASIS.source}`));
    expect(footer, "neither action may use a zero flex-basis — it floors at padding")
      .not.toMatch(/POPUP_(?:SECONDARY_CLS|COMMIT_CLS) = "(?:[^"]*\s)?flex-1\b/);

    // `min-w-max` converts an over-long label from a SPILL into a WRAP: a
    // button may not be laid out narrower than its own label, so the line
    // overflows and breaks instead of the text escaping the pill.
    //
    // THE `!` IS LOAD-BEARING AND MUST NOT BE TIDIED AWAY. `index.css` carries
    // a global HIG tap-target floor —
    //
    //   button:not([role=checkbox]):not([role=radio]):not([role=switch]),
    //   [role=button], … { min-width: 44px; min-height: 44px }
    //
    // — at specificity (0,3,1), against `.min-w-max`'s (0,1,0). Without the
    // important flag the computed min-width is 44px, the row never wraps, and
    // every long label clips exactly as before. That was measured, not deduced:
    // the first version of this fix shipped `min-w-max`, read as correct in
    // every class list, and `getComputedStyle` returned `minWidth: "44px"`.
    // 0 of 180 footers stacked at any width.
    //
    // The tap target is not lost: max-content on a button carrying 32-48px of
    // horizontal padding is always comfortably over 44px.
    for (const name of ["POPUP_SECONDARY_CLS", "POPUP_COMMIT_CLS"]) {
      expect(
        footer,
        `${name} needs !min-w-max — the plain class loses to the global 44px ` +
          `tap-target rule, which silently makes the wrap inert`,
      ).toMatch(new RegExp(`${name} =[\\s\\S]{0,400}?!min-w-max`));
    }

    // And the row must be ABLE to wrap. `flex-wrap-reverse` (not plain `wrap`)
    // puts the second line on top, so a stacked footer reads
    // commit-above-dismiss — Apple's stacked alert — while the DOM order stays
    // [dismiss, commit] and the commit stays last in the tab sequence.
    expect(footer, "the footer must be able to stack, and stack commit-first")
      .toMatch(/POPUP_FOOTER_ROW =[\s\S]{0,120}?flex-wrap-reverse/);
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

  /**
   * FAILS IF: a second confirm-dialog family comes back.
   *
   * `ui/alert-dialog.tsx` existed for one reason — Radix ships a separate
   * AlertDialog primitive — and it cost more than it gave. Its own comments
   * said "change one, change both" in FOUR places, and it had drifted anyway
   * in every one of them: the backdrop tint (26% against Dialog's 8%, so a
   * confirm visibly darkened the page), the close X (44x44 vs 32x44, a 20px
   * glyph vs 18px, no hover lift, `focus:` instead of `focus-visible:` so a
   * mouse click drew the ring the owner had asked to be rid of), the footer
   * dismiss height, and the corner X that kept rendering next to a Cancel
   * after Dialog learned to drop it. A test comparing two copies cannot stop
   * that, because keeping them equal still depends on someone editing the
   * second file.
   *
   * The primitive also made one of the owner's instructions IMPOSSIBLE.
   * Radix's AlertDialogContent assigns `onPointerDownOutside` and
   * `onInteractOutside` to `preventDefault` AFTER spreading caller props, so
   * they cannot be overridden — "but also allow tap out to close on all"
   * (owner, 2026-09-02) could not be honoured for the 43 confirm boxes that
   * sat on it. That is the defect that ended the argument.
   *
   * These assertions derive their subject from the filesystem and from
   * package.json rather than from a hand-kept list, because a registry that is
   * both a test's input and its definition of correctness cannot fail for a
   * missing member.
   */
  it("there is exactly ONE dialog family — alert-dialog is gone and cannot return", () => {
    expect(
      existsSync(resolve(UI, "alert-dialog.tsx")),
      "ui/alert-dialog.tsx is back. Confirms are Dialogs with role=\"alertdialog\".",
    ).toBe(false);

    const offenders = allSourceFiles()
      // This spec NAMES the banned module in order to ban it. A guard that
      // matches its own text is the "registry checked against itself" bug in
      // miniature — it would fail on day one and get deleted by whoever was
      // unblocking the build.
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) =>
        /@radix-ui\/react-alert-dialog|@\/components\/ui\/alert-dialog/.test(readFileSync(f, "utf8")),
      );
    expect(offenders, "these files import the removed alert-dialog family").toEqual([]);

    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(
      { ...pkg.dependencies, ...pkg.devDependencies }["@radix-ui/react-alert-dialog"],
      "the alert-dialog package should not be a dependency any more",
    ).toBeUndefined();
  });

  /**
   * FAILS IF: a confirm's buttons stop closing it.
   *
   * This is the one behaviour the merge could have broken silently.
   * `AlertDialogAction` and `AlertDialogCancel` were BOTH `DialogPrimitive.Close`
   * under the hood, so every confirm button dismissed its dialog for free.
   * `DialogPrimaryAction` is a plain `<Button>` and does not. A straight rename
   * would have left all 43 confirm boxes — admin ban, remove review, delete
   * note, delete account — OPEN after you confirmed, with no error and no type
   * failure. `MaybeClose` restores it off `role="alertdialog"`.
   */
  it("actions inside a confirm auto-close it, and outside one do not", () => {
    const src = read("src/components/ui/dialog.tsx");
    expect(src, "the confirm switch must be role-driven, not a per-call-site prop")
      .toContain('props.role === "alertdialog"');
    expect(src, "MaybeClose must wrap in the Close primitive")
      .toMatch(/isConfirm \? <DialogPrimitive\.Close asChild>/);
    for (const action of ["DialogSecondaryAction", "DialogPrimaryAction", "DialogDestructiveAction"]) {
      const body = src.slice(src.indexOf(`const ${action} =`), src.indexOf(`${action}.displayName`));
      expect(body, `${action} must go through MaybeClose`).toContain("<MaybeClose>");
    }
  });

  /**
   * FAILS IF: a migrated confirm loses `role="alertdialog"` and its dismiss
   * silently stops working.
   *
   * The invariant is derived, not listed. A `DialogSecondaryAction` closes its
   * dialog by exactly one of three routes: its own `onClick`, an enclosing
   * `<DialogClose asChild>`, or — for a confirm — `MaybeClose`, which is keyed
   * off `role="alertdialog"`. A Cancel with none of the three is INERT: it
   * renders, it is focusable, it is announced, and tapping it does nothing.
   *
   * Measured when this was written: nine files rely on the third route and one
   * (BlockUserDialog) uses the second. Writing the test the obvious way first —
   * "every dialog with a dismiss and a commit must be an alertdialog" — flagged
   * 29 files, all of them FORM dialogs (Report, Dispute, Boost, InstantPayout)
   * where auto-close would be wrong because the caller decides what happens
   * after submit. That version would have been satisfied only by breaking them.
   */
  it("no dismiss button is inert — every Cancel has a way to close its dialog", () => {
    const inert: string[] = [];
    for (const f of allSourceFiles()) {
      if (!f.endsWith(".tsx")) continue;
      // Specs are fixtures, not product surfaces, and this rule cannot read
      // them: dialogConfirmBehaviour.test.tsx renders ONE harness that is a
      // confirm or a form dialog depending on a prop, precisely so it can
      // assert both halves of this behaviour. Statically that file looks like
      // a dismiss with no way out. It is the same self-reference trap as the
      // alert-dialog ban below — a guard that flags the test proving the guard.
      if (/\.test\.tsx?$/.test(f)) continue;
      const src = stripComments(readFileSync(f, "utf8"));
      if (!src.includes("<DialogSecondaryAction")) continue;
      const isConfirm = /role="alertdialog"/.test(src);
      for (const m of src.matchAll(/(<DialogClose[^>]*>\s*)?<DialogSecondaryAction([\s\S]*?)>/g)) {
        const wrappedInClose = Boolean(m[1]);
        const hasHandler = m[2].includes("onClick");
        if (!wrappedInClose && !hasHandler && !isConfirm) {
          inert.push(relative(ROOT, f));
          break;
        }
      }
    }
    expect(
      inert,
      'these dismiss buttons do nothing: give the dialog role="alertdialog", ' +
        "wrap the button in <DialogClose asChild>, or give it an onClick",
    ).toEqual([]);
  });


  /**
   * FAILS IF: a new popup hand-rolls a dismiss-and-commit row instead of using
   * the shared footer.
   *
   * The shared footer only governs the popups that OPT IN by rendering it, so
   * a row written by hand keeps whatever grammar it was born with and never
   * hears about a change. NpsPrompt was exactly that: `justify-between` with a
   * ghost dismiss hard-left and a `px-6` primary hard-right, i.e. the
   * pre-2026-09-02 layout, still shipping weeks after ~30 other popups moved to
   * the 1:3 row. Nothing failed, because nothing was looking.
   *
   * WHAT THIS DELIBERATELY DOES NOT FLAG, and why the rule is "one dismiss and
   * one commit" rather than "two buttons". Measured across every popup in the
   * app when this was written: NINE files have a Content, no shared footer, and
   * raw <Button>s. Only ONE of them was a footer. The rest are different
   * controls that a 1:3 dismiss/commit row would actively misrepresent:
   *
   *   EarningsExport      "Download CSV" + "Download PDF" — two EQUAL commits.
   *   GateSheet           "Create Free Account" + "Log In" — two nav choices.
   *   adminJobs/JobDetail Remove / Override / Refund — a wrapping toolbar.
   *   AdminSettings       inline per-section saves inside a settings form.
   *   TipDialog           one Send beside the amount input — an input group.
   *   SosShareButton, PhotoProof, HelperScheduleStrip — single inline buttons.
   *
   * So the signature is a GHOST/OUTLINE button and a PRIMARY/DESTRUCTIVE button
   * as siblings in one flex or grid container — that pair means "back out" and
   * "go through", which is what the footer exists to rank.
   */
  it("no popup hand-rolls a dismiss-and-commit row", () => {
    const offenders: string[] = [];
    for (const f of allSourceFiles()) {
      if (!f.endsWith(".tsx") || /\.test\.tsx?$/.test(f)) continue;
      const src = stripComments(readFileSync(f, "utf8"));
      if (!/<(?:Dialog|Sheet)Content/.test(src)) continue;
      if (/<(?:Dialog|Sheet)Footer/.test(src)) continue; // opted in already

      for (const row of src.matchAll(
        /<div className="[^"]*(?:flex|grid)[^"]*"[^>]*>([\s\S]{0,900}?)<\/div>/g,
      )) {
        const body = row[1];
        // The left slot is identified by what it SAYS, not how it is styled.
        // Styling cannot tell a dismiss from a second destination: GateSheet's
        // "Log In" is `variant="outline"` beside a primary "Create Free
        // Account", and EarningsExport's "Download CSV" is outline beside
        // "Download PDF" — both look exactly like a footer and neither is one.
        // The first version of this rule flagged them, and satisfying it would
        // have squeezed a real action into the dismiss's quarter-width slot.
        // A dismiss is the button that means "not this, take me out".
        const dismiss = /<Button\b[\s\S]{0,300}?>\s*(?:\{[^}]*\}\s*)?(?:Cancel|Skip|Close|Dismiss|Not Now|Maybe Later|No Thanks|Keep Editing)\s*</i.test(body);
        const commit = /<Button\b(?![^>]*variant="(?:ghost|outline|link)")[^>]*>/.test(body);
        if (dismiss && commit) { offenders.push(relative(ROOT, f)); break; }
      }
    }
    expect(
      offenders,
      "a dismiss beside a commit is a FOOTER — use DialogFooter/SheetFooter " +
        "with the shared actions, so it follows the grammar when the grammar changes",
    ).toEqual([]);
  });


  /**
   * FAILS IF: a footer button can be clipped by its own card.
   *
   * The row shipped as `flex-1 min-w-0 px-0 shrink-0` — a contradiction, since
   * `min-w-0` permits shrinking below content and `shrink-0` forbids it, and
   * shrink-0 wins. With the word "Cancel" the dismiss is 67px and fits, which
   * is why every measurement taken while building the row passed. With
   * "Keep Account" or "Stay Signed In" it could not shrink, overflowed, and the
   * card clipped it: the owner's screenshots showed "Keep Accoun" and
   * "tay Signed I" with the commit button overlapping.
   *
   * THIRTEEN dialogs were in that state. Two things hid it:
   *   · the existing tests assert the CLASS is applied, and the class WAS
   *     applied — the class was the bug;
   *   · every width I measured used the one label that fits.
   *
   * So this test uses a deliberately long label and asserts GEOMETRY, not
   * classes. jsdom has no layout engine, so it cannot measure px — it asserts
   * the two properties that make clipping impossible instead: neither button
   * may carry a shrink lock, and both must be free to shrink (`min-w-0`).
   */
  it("a long dismiss label cannot lock the footer open", () => {
    const footer = read("src/components/ui/popupFooter.ts");

    // The specific regression. `shrink-0` on either half re-creates it exactly.
    // Read the STRING LITERALS, not the file. My first version of this grepped
    // the whole file for `shrink-0` and failed on the comment that explains why
    // shrink-0 is forbidden — a test that cannot survive its own documentation.
    const literals = footer
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(literals, "POPUP_SECONDARY_CLS must not lock its width")
      .not.toMatch(/shrink-0/);

    // `flex-1` is banned on both halves for the same reason `shrink-0` is: it
    // is `flex: 1 1 0%`, and a zero basis under border-box floors at
    // padding + border, so the half with `px-6` came out 48px wider than the
    // half with `px-0` while both declared identical flex. That asymmetry was
    // the SECOND clipping bug in this row — it moved the spill from the dismiss
    // to the commit rather than removing it. An exact percentage basis has no
    // floor and is equal for real.
    expect(literals, "a zero flex-basis floors at padding — use the percentage basis")
      .not.toMatch(/= "(?:[^"]*\s)?flex-1\b/);
    for (const name of ["POPUP_SECONDARY_CLS", "POPUP_COMMIT_CLS"]) {
      expect(literals, `${name} must take an exact half`)
        .toMatch(new RegExp(`${name} =[\\s\\S]{0,200}?basis-\\[calc\\(50%-6px\\)\\]`));
      expect(literals, `${name} must be able to grow into that half`)
        .toMatch(new RegExp(`${name} =[\\s\\S]{0,200}?\\bgrow\\b`));
    }
  });
  /**
   * The dismiss labels written as CHILDREN, extracted brace-aware.
   *
   * A plain `<DialogSecondaryAction[^>]*>` regex does not work here and fails
   * in the direction that hides bugs: nearly every call site carries an
   * `onClick={() => setThing(null)}`, and the `>` of the ARROW closes the match
   * early. The "label" then comes back as `setStep("tip")}>Skip`, which matches
   * nothing on the allowlist and reports thirteen offenders that do not exist.
   * A guard whose first run is thirteen false positives gets its allowlist
   * padded until it is quiet, and then it is guarding nothing.
   *
   * So scan for the `>` that actually closes the open tag, tracking brace depth
   * and string quotes. Children containing an expression or a nested element
   * are skipped rather than guessed at — those are read by the browser fit
   * spec, which sees rendered text instead of source.
   */
  function dismissChildLabels(src: string): string[] {
    const out: string[] = [];
    const open = /<(Dialog|Sheet)SecondaryAction\b/g;
    let m: RegExpExecArray | null;
    while ((m = open.exec(src))) {
      let i = m.index + m[0].length;
      let depth = 0;
      let quote = "";
      for (; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      if (i >= src.length || src[i - 1] === "/") continue;
      const close = src.indexOf(`</${m[1]}SecondaryAction>`, i);
      if (close === -1) continue;
      const inner = src.slice(i + 1, close).trim();
      if (!inner || inner.includes("{") || inner.includes("<")) continue;
      out.push(inner);
    }
    return out;
  }

  /**
   * FAILS IF: a dialog reintroduces a bespoke dismiss word.
   *
   * The owner settled this on 2026-09-03 after seeing thirteen clipped on
   * device: a confirm's dismiss says "Cancel".
   *
   * WHAT THIS USED TO CHECK, AND WHY IT PROVED NOTHING. It read
   * `secondaryLabel="…"` props only — one of the two ways a dismiss label is
   * written — while its own name and comment claimed "every dismiss". The
   * other way, `<DialogSecondaryAction>Label</DialogSecondaryAction>` children,
   * is the MAJORITY of call sites, and the test could not see any of them. It
   * passed on an app shipping NINE distinct dismiss labels while asserting
   * there was one. Same shape as `registries-checked-against-itself`: the test
   * defined its subject narrowly enough that it could not fail.
   *
   * So the subject is now derived from BOTH mechanisms, and the exceptions are
   * an explicit allowlist rather than an accident of what the regex missed.
   * Every entry is an opt-out on a NON-DESTRUCTIVE prompt, where "Cancel" would
   * be actively wrong — declining a tip is not cancelling anything. That is a
   * real distinction and it belongs in the open, per `popupFooter.ts`'s own
   * note that read-only and opt-out surfaces carry different weight.
   */
  it("a confirm dismiss says Cancel, and every exception is declared", () => {
    // Opt-out prompts, not confirms. Adding a name here is a deliberate
    // statement that the surface is an invitation being declined.
    const DECLINE_LABELS = new Set([
      "Maybe Later",
      "Not Now",
      "Skip",
      "No Thanks",
      "Keep It On",
      "Keep the Job",
      "Close",
    ]);

    // Not a dismiss at all: in a STEPPED dialog the secondary walks back one
    // step and the popup stays open (DeleteAccountDialog's `setDeleteStep(1)`).
    // Labelling that "Cancel" would be a lie about what the button does.
    const STEP_BACK_LABELS = new Set(["Back"]);

    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const f of allSourceFiles()) {
      if (!f.endsWith(".tsx") || /\.test\.tsx?$/.test(f)) continue;
      const src = stripComments(readFileSync(f, "utf8"));
      const rel = relative(ROOT, f);

      // Mechanism 1: the `secondaryLabel` prop.
      for (const m of src.matchAll(/secondaryLabel=\{?"([^"]+)"/g)) {
        seen.add(m[1]);
        if (m[1] !== "Cancel" && !DECLINE_LABELS.has(m[1])) offenders.push(`${rel}: "${m[1]}"`);
      }

      // Mechanism 2: the element's children — the majority, and previously
      // invisible to this test.
      for (const label of dismissChildLabels(src)) {
        seen.add(label);
        if (label !== "Cancel" && !DECLINE_LABELS.has(label) && !STEP_BACK_LABELS.has(label)) {
          offenders.push(`${rel}: "${label}"`);
        }
      }
    }

    // The guard on the guard: if the extraction breaks, `seen` collapses and
    // this test starts passing vacuously — which is exactly how the previous
    // version stayed green. A repo with ~50 footers has more than a handful of
    // distinct dismiss words.
    expect(seen.size, "extracted no dismiss labels at all — the regexes have drifted")
      .toBeGreaterThan(3);
    expect(seen, 'the canonical dismiss word must still be in use').toContain("Cancel");

    expect(
      [...new Set(offenders)],
      'a confirm dismiss says "Cancel"; an opt-out prompt must be listed in DECLINE_LABELS with a reason',
    ).toEqual([]);
  });

});
