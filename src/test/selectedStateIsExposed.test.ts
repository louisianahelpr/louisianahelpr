/// <reference types="node" />
/**
 * A CONTROL THAT LOOKS SELECTED MUST SAY SO TO ASSISTIVE TECH.
 *
 * THE BUG THIS IS THE CLASS OF. press-every-control run 35813177418 failed 11
 * presses with "no observable change" — "Filter: All › All" (ScheduleTab),
 * "Filter by skill › All Helprs" and "Sort: Recent activity › Recent activity"
 * (SavedHelpersTab), "Newest › Newest" (ReviewsTab), "Monthly"
 * (SubscriptionTab), "Open (2)" (AdminDisputes), "Manual Override › Re-open"
 * (StatusOverrideDialog). Every one of them was ALREADY the selected option,
 * so pressing it correctly did nothing. The sweep has a rule for exactly that
 * (`alreadyActive` in scripts/audit/press-every-control.mjs reads
 * aria-pressed / aria-checked / aria-selected / aria-current / data-state) —
 * and it could not fire, because these options painted their selection
 * (`btn-grad-primary`, `border-primary`, a sliding pill) and exposed NOTHING.
 *
 * The harness was blind for the same reason a screen reader is: VoiceOver
 * reads "Monthly, button" for the selected cycle and for the two that are not.
 * That is WCAG 4.1.2 (state must be programmatically determinable), so the
 * fix is in the app, not in the harness.
 *
 * THE RULE (from source, every .tsx under src/): a `<button>` / `<Button>`
 * with an onClick whose className, style or children branch on a SELECTION
 * condition must carry aria-pressed, aria-checked, aria-selected,
 * aria-current or data-state (or a role that implies one: tab, radio,
 * option, switch, checkbox, menuitemradio). A selection condition is either
 *   - an identifier named active / selected / current / checked (is-prefixed
 *     too), or
 *   - `a === b` where the onClick calls the setter of one side
 *     (`filter === "open"` with `onClick={() => setFilter("open")}`) — the
 *     setter link is what separates "this option is chosen" from any other
 *     comparison (`color === "destructive"` in PriorityAlert is a tone, not a
 *     choice, and its onClick sets nothing).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

const STATE_ATTRS = ["aria-pressed", "aria-checked", "aria-selected", "aria-current", "data-state"];
const STATEFUL_ROLE = /^(tab|radio|option|switch|checkbox|menuitemradio|menuitemcheckbox)$/;
const SEL_ID = /^(is)?(active|selected|current|checked)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** The root identifier of `a.b.c` / `a` — what a setter would be named after. */
function rootName(e: ts.Expression): string | null {
  let x: ts.Expression = e;
  while (ts.isPropertyAccessExpression(x)) x = x.expression;
  return ts.isIdentifier(x) ? x.text : null;
}

interface Violation { file: string; line: number; condition: string }

function findUnexposedSelection(file: string, src: string): Violation[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Violation[] = [];

  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const tag = opening.tagName.getText(sf);
      const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
      const attr = (n: string) => attrs.find((a) => a.name.getText(sf) === n);
      const onClick = attr("onClick");
      if ((tag === "button" || tag === "Button") && onClick?.initializer) {
        const clickText = onClick.initializer.getText(sf);
        const isSelection = (c: ts.Expression): boolean => {
          if (ts.isParenthesizedExpression(c)) return isSelection(c.expression);
          if (ts.isIdentifier(c)) return SEL_ID.test(c.text);
          if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
            // The onClick must call the setter of one side WITH the other side:
            // `filter === "open"` + `setFilter("open")`. A setter call with
            // anything else (`setViewProfile({ ... })` beside a busy check)
            // is not choosing this option.
            const pairs: Array<[ts.Expression, ts.Expression]> = [[c.left, c.right], [c.right, c.left]];
            return pairs.some(([side, other]) => {
              const n = rootName(side);
              if (!n) return false;
              const setter = new RegExp(`\\bset${n[0].toUpperCase()}${n.slice(1)}\\s*\\(\\s*([^,)]*?)\\s*[,)]`, "g");
              for (const m of clickText.matchAll(setter)) if (m[1] === other.getText(sf)) return true;
              return false;
            });
          }
          return false;
        };
        let hit: string | null = null;
        const scan = (x: ts.Node) => {
          if (hit) return;
          if (ts.isConditionalExpression(x) && isSelection(x.condition)) hit = x.condition.getText(sf);
          else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && isSelection(x.left)) hit = x.left.getText(sf);
          ts.forEachChild(x, scan);
        };
        for (const n of ["className", "style"]) {
          const a = attr(n);
          if (a?.initializer) scan(a.initializer);
        }
        if (ts.isJsxElement(node)) for (const child of node.children) if (ts.isJsxExpression(child)) scan(child);

        const role = attr("role")?.initializer;
        const roleText = role && ts.isStringLiteral(role) ? role.text : "";
        // A state attribute spread in (`{...(tab ? { "aria-selected": a } : { "aria-checked": a })}`,
        // SegmentedControl) counts the same as a literal one.
        const spread = opening.attributes.properties.filter(ts.isJsxSpreadAttribute).map((a) => a.getText(sf)).join(" ");
        const exposed = STATE_ATTRS.some((a) => attr(a) || spread.includes(`"${a}"`)) || STATEFUL_ROLE.test(roleText);
        if (hit && !exposed) {
          out.push({ file: path.relative(ROOT, file), line: sf.getLineAndCharacterOfPosition(opening.getStart()).line + 1, condition: String(hit).slice(0, 80) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("a selected option exposes its state (press-every-control run 35813177418)", () => {
  it("the detector sees the original bug shape and not a tone comparison", () => {
    const bug = `const X = () => <div>{opts.map((opt) => { const active = opt.value === sortBy; return (
      <button type="button" onClick={() => setSortBy(opt.value)} className={active ? "btn-grad-primary" : "text-foreground"}>{opt.label}</button>); })}</div>;`;
    expect(findUnexposedSelection("bug.tsx", bug)).toHaveLength(1);
    const fixed = bug.replace('type="button"', 'type="button" aria-pressed={active}');
    expect(findUnexposedSelection("fixed.tsx", fixed)).toHaveLength(0);
    const tab = `const T = () => <button onClick={() => setFilter("open")} className={\`x \${filter === "open" ? "border-primary" : ""}\`}>Open</button>;`;
    expect(findUnexposedSelection("tab.tsx", tab)).toHaveLength(1);
    const pill = `const P = () => <button onClick={() => setCycle(o.key)}>{active && <motion.span className="btn-grad-primary" />}</button>;`;
    expect(findUnexposedSelection("pill.tsx", pill)).toHaveLength(1);
    const busy = `const B = () => <Button onClick={async () => { await go(p); setViewProfile({ ...viewProfile }); }}>{resending === viewProfile.id ? "Sending" : "Send"}</Button>;`;
    expect(findUnexposedSelection("busy.tsx", busy)).toHaveLength(0);
    const tone = `const A = ({ color, onClick }) => <button onClick={onClick} className={color === "destructive" ? "a" : "b"}>x</button>;`;
    expect(findUnexposedSelection("tone.tsx", tone)).toHaveLength(0);
  });

  it("no button in src/ paints a selection it does not expose", () => {
    const violations = walk(SRC).flatMap((f) => findUnexposedSelection(f, fs.readFileSync(f, "utf8")));
    expect(violations.map((v) => `${v.file}:${v.line} (${v.condition})`)).toEqual([]);
  });
});
