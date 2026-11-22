/**
 * #37 (deep audit 11-22): the Helpr's dispute card and its timeline named the reviewer three ways ("an admin",
 * "Helpr support", "a real person at Louisiana Helpr"), said the same status three times, and the timeline sent the
 * other side to a "response box on this job's card" the card no longer shows (its button read "Add photos").
 *
 * The class: every word a member reads on the dispute surfaces names the reviewer "Helpr support", never "admin" or
 * "a real person", and none points at a "response box". Reads the user-visible strings (string literals, template
 * text and JSX text) through the TypeScript AST, so comments, identifiers (awaitingAdmin) and keys (key="admin")
 * never count.
 *
 * @mutate src/pages/jobs/appliedJobCard/helperDisputeCopy.ts |       ? "Helpr support is deciding this one." |       ? "An admin is on it."
 * @mutate src/components/DisputeTimelineDialog.tsx |                 Talk to Helpr support |                 Talk to a real person
 * @mutate src/pages/jobs/appliedJobCard/DisputedSection.tsx |           {awaitingAdmin ? "In review" : "Dispute open"} |           {awaitingAdmin ? "Admin reviewing" : "Dispute open"}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

const SURFACES = [
  "src/pages/jobs/appliedJobCard/DisputedSection.tsx",
  "src/pages/jobs/appliedJobCard/helperDisputeCopy.ts",
  "src/components/DisputeTimelineDialog.tsx",
  "src/components/job-card/jobStatusLine.ts",
  "src/lib/i18n/enCardLines.ts",
  "src/lib/i18n/enJobLines.ts",
];

/** Every user-visible text a file can render: string literals and template text with a space in them, and JSX text. */
function visibleStrings(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) out.push(n.text.replace(/\s+/g, " ").trim());
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (/\s/.test(n.text.trim())) out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out.filter(Boolean);
}

describe("the dispute surfaces name the reviewer one way: Helpr support", () => {
  it("no visible string says 'admin', 'a real person' or 'response box'", () => {
    let scanned = 0;
    const bad: string[] = [];
    for (const f of SURFACES) {
      for (const s of visibleStrings(f)) {
        scanned++;
        if (/\badmins?\b|real person|response box/i.test(s)) bad.push(`${f}: "${s.slice(0, 90)}"`);
      }
    }
    expect(bad, `the reviewer is "Helpr support" on every dispute surface:\n${bad.join("\n")}`).toEqual([]);
    expect(scanned).toBeGreaterThan(100);
  });

  it("the Helpr's escalated-dispute button says what it does: Add your side", () => {
    const code = readFileSync("src/pages/jobs/appliedJobCard/DisputedSection.tsx", "utf8");
    expect(code).toMatch(/label=\{awaitingAdmin \? "Add your side" : "Respond to dispute"\}/);
    expect(code).toMatch(/icon=\{awaitingAdmin \? Camera : MessageSquare\}/);
  });
});
