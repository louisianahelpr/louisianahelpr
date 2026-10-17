/**
 * The prod press sweep (scripts/audit/press-every-control.mjs) presses a
 * control UNGATED unless it is classed mutating; a gated one is pressed only
 * on a test-owned record (pressProdSafety.mjs). Found 2026-10-17 by a reviewer
 * of #3302: the recurring series' "End series" and "Leave series" (the poster's
 * and the Helpr's EndSeriesControl, on main, and its confirm's commit of the
 * same name) matched no word of DESTRUCTIVE_RX, so a sweep could open the
 * confirm and press its commit, calling end_recurring_series on prod. Measured
 * from the source the same day: six more confirm commits that write named no
 * word either ("Give up" series dates, "Turn Down" / "Leave Crew", "Escalate to
 * Admin", "Take It Back", the admin feature switch's "Set to ...").
 *
 * CLASS, two nets:
 * 1. The app's own marker. The commit of every confirm (role="alertdialog",
 *    so every BrandConfirmDialog) and every DialogDestructiveAction renders
 *    `data-commit`; the sweep records it and classes the control mutating
 *    whatever its words (isCommitControl). A new confirm needs no new word.
 * 2. The vocabulary, for the TRIGGER outside the dialog (it carries no marker
 *    and usually shares the commit's words): every BrandConfirmDialog commit
 *    label in src/ is mutating by the sweep's own words for its persona, apart
 *    from NO_WRITE_COMMITS, an exact list (each entry must still exist and
 *    still miss the vocabulary, so the list fails in both directions).
 *
 * @mutate scripts/audit/press-every-control.mjs | meta.type === "submit" \|\| isCommitControl(meta) \|\| | meta.type === "submit" \|\|
 * @mutate scripts/audit/press-every-control.mjs |       commit: el.getAttribute("data-commit") \|\| "", |
 * @mutate src/components/ui/dialog.tsx |   return destructive ? "destructive" : isConfirm ? "confirm" : undefined; |   return destructive ? "destructive" : undefined;
 * @mutate scripts/audit/press-every-control.mjs | \|checkout\|end\|leave\|give up\| | \|checkout\|give up\|
 * @mutate scripts/audit/pressProdSafety.mjs | \|retry\|resend\|set to)\b | \|retry\|resend)\b
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Dialog, DialogContent, DialogHero, DialogPrimaryAction, DialogDestructiveAction } from "@/components/ui/dialog";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "..", "..");
type Meta = { commit?: string; type?: string; role?: string | null; tag?: string; inForm?: boolean };

/** The sweep's gate condition (press-every-control.mjs), term for term; the last test pins the two together. */
function mutating(label: string, meta: Meta = {}, persona = "customer"): boolean {
  return (
    (harness.DESTRUCTIVE_RX as RegExp).test(label) ||
    safety.isAdminWrite({ persona, label }) ||
    meta.type === "submit" ||
    safety.isCommitControl(meta) ||
    (safety.PAYMENT_RX as RegExp).test(label) ||
    safety.isAdminStateToggle({ persona, meta, label }) ||
    safety.isAccountSettingToggle({ persona, meta, label })
  );
}

/**
 * Commits that write nothing, or only something the vocabulary is the wrong
 * tool for. Each is still gated at runtime by its `data-commit` marker.
 * Exact: an entry that disappears or starts matching the vocabulary fails.
 */
const NO_WRITE_COMMITS: Record<string, string> = {
  "src/components/auth/AccountChoiceDialog.tsx: I'm new here": "starts a new account from a social sign-in; never reachable as a signed-in sweep persona",
  "src/components/profile/DeleteAccountDialog.tsx: Continue": "moves to step 2, whose commit is the delete",
  "src/pages/messages/Messages.tsx: Hide": "hides a thread from this inbox only; Recently Deleted restores it",
  "src/pages/profile/petProfiles/PetForm.tsx: Discard": "throws away an unsaved form; writes nothing",
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

/** The JSX element starting at `at`, up to its own `/>` or `>` (brace-aware). */
function elementAt(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && c === ">") return src.slice(at, i + 1);
  }
  return src.slice(at);
}

/** A prop's raw value text: `"..."` or the balanced `{...}`. */
function propValue(el: string, name: string): string | null {
  const m = new RegExp(`\\s${name}=`).exec(el);
  if (!m) return null;
  const j = m.index + m[0].length;
  if (el[j] === '"') return el.slice(j, el.indexOf('"', j + 1) + 1);
  let depth = 0;
  for (let k = j; k < el.length; k++) {
    if (el[k] === "{") depth++;
    else if (el[k] === "}" && --depth === 0) return el.slice(j, k + 1);
  }
  return null;
}

/**
 * Every label a commit can render: the string and template literals of its
 * `primaryLabel`, minus the operands of a comparison (`mode === "leave"`),
 * minus the busy labels ("Ending…"), with `${...}` taken out of a template.
 */
function commitLabels(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/"([^"]*)"|`([^`]*)`|'([^']*)'/g)) {
    const before = value.slice(0, m.index).trimEnd();
    if (/[=!]==$/.test(before)) continue;
    const text = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
    if (!/[a-z]/i.test(text) || /…|\.\.\./.test(text)) continue;
    out.push(text);
  }
  return out;
}

function confirmCommits(): { file: string; label: string; persona: string }[] {
  const files = [...tsxFiles(resolve(ROOT, "src/components")), ...tsxFiles(resolve(ROOT, "src/pages"))];
  const out: { file: string; label: string; persona: string }[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    const rel = f.replace(ROOT + "/", "");
    if (rel === "src/components/ui/BrandConfirmDialog.tsx") continue;
    const persona = /\/admin\//.test(rel) ? "admin" : "customer";
    for (const m of src.matchAll(/<BrandConfirmDialog\b/g)) {
      const value = propValue(elementAt(src, m.index ?? 0), "primaryLabel");
      if (!value) continue;
      for (const label of commitLabels(value)) out.push({ file: rel, label, persona });
    }
  }
  return out;
}

describe("the press sweep gates every irreversible control", () => {
  it("End series and Leave series, the trigger and the confirm's commit, are mutating", () => {
    for (const label of ["End series", "Leave series"]) {
      expect(mutating(label), `${label} (trigger, no marker)`).toBe(true);
      expect(mutating(label, { commit: "confirm" }), `${label} (commit)`).toBe(true);
    }
  });

  it("a control the app marks as the commit is mutating whatever its words", () => {
    expect(mutating("Frobnicate", { commit: "confirm" })).toBe(true);
    expect(mutating("Frobnicate", { commit: "destructive" })).toBe(true);
    expect(mutating("Frobnicate", { commit: "" })).toBe(false);
    expect(mutating("Frobnicate", {})).toBe(false);
  });

  it("every BrandConfirmDialog commit label in src/ is mutating by the sweep's words (bar the exact NO_WRITE_COMMITS)", () => {
    const commits = confirmCommits();
    // Inventory floor, measured 2026-10-17: 39 commit labels on origin/main 2e603570a.
    expect(commits.length).toBeGreaterThan(35);
    const keys = new Set(commits.map((c) => `${c.file}: ${c.label}`));
    const missed = commits
      .filter((c) => !mutating(c.label, {}, c.persona))
      .map((c) => `${c.file}: ${c.label}`)
      .filter((k) => !(k in NO_WRITE_COMMITS));
    expect(missed).toEqual([]);
    for (const k of Object.keys(NO_WRITE_COMMITS)) {
      expect(keys.has(k), `${k} is listed but no longer a commit label`).toBe(true);
      const [file, label] = k.split(": ");
      const c = commits.find((x) => x.file === file && x.label === label)!;
      expect(mutating(label, {}, c.persona), `${k} now matches the vocabulary; drop it from NO_WRITE_COMMITS`).toBe(false);
    }
  });

  it("the commit of a confirm and every destructive commit carry data-commit; a form dialog's primary does not", () => {
    const { unmount } = render(
      <BrandConfirmDialog open onOpenChange={() => {}} title="End it?" description="" primaryLabel="Do the thing" onPrimary={() => {}} secondaryLabel="Keep" />,
    );
    expect(screen.getByRole("button", { name: "Do the thing" })).toHaveAttribute("data-commit", "confirm");
    expect(screen.getByRole("button", { name: "Keep" })).not.toHaveAttribute("data-commit");
    unmount();
    const r2 = render(
      <BrandConfirmDialog open onOpenChange={() => {}} title="Leave it?" description="" primaryLabel="Do the other thing" primaryTone="sienna" onPrimary={() => {}} secondaryLabel="Keep" />,
    );
    expect(screen.getByRole("button", { name: "Do the other thing" })).toHaveAttribute("data-commit", "destructive");
    r2.unmount();
    render(
      <Dialog open>
        <DialogContent>
          <DialogHero title="Edit" />
          <DialogPrimaryAction>Next step</DialogPrimaryAction>
          <DialogDestructiveAction>Wipe it</DialogDestructiveAction>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Next step" })).not.toHaveAttribute("data-commit");
    expect(screen.getByRole("button", { name: "Wipe it" })).toHaveAttribute("data-commit", "destructive");
  });

  it("the sweep records data-commit and gates on it, in the same condition as every other mutating test", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/commit: el\.getAttribute\("data-commit"\) \|\| "",/);
    const cond = src.match(/if \(DESTRUCTIVE_RX\.test\(label\)[^\n]*\{\n\s*const why = await gate\(/)?.[0] ?? "";
    for (const term of ["DESTRUCTIVE_RX.test(label)", "isAdminWrite({ persona, label })", 'meta.type === "submit"', "isCommitControl(meta)", "PAYMENT_RX.test(label)", "isAdminStateToggle({ persona, meta, label })", "isAccountSettingToggle({ persona, meta, label })"]) {
      expect(cond, term).toContain(term);
    }
  });
});
