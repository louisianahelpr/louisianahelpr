/**
 * NO ACTION LABEL IN src/components/profile IS CUT OFF WITHOUT ITS FULL TEXT
 * BEING AVAILABLE SOMEWHERE ELSE (Q108).
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 * /profile?tab=credentials, after a license was sent, measured at 375 on
 * 2026-09-23 (helper test account, prod data, ~/.lh-shots/q108):
 *
 *   "View the License You Se…"   scrollWidth 171 > clientWidth 169
 *
 * The sent-document button in CredentialsTab.tsx carried `truncate`. A
 * truncated action label hides what the control does; the user has to guess.
 * The fix lets it wrap (`break-words`), and the row stays 44px tall.
 *
 * ── THE CLASS ───────────────────────────────────────────────────────────────
 * An interactive element (`a`, `button`, `Button`, `Link`, `NavLink`, any
 * Radix `*Trigger` or menu `*Item`, or any element with role
 * button/link/tab/menuitem) that carries, or wraps a descendant that carries,
 * a clipping class (`truncate`, `text-ellipsis`, `line-clamp-N`, any
 * breakpoint variant of those) is a defect UNLESS the full text is still
 * reachable: a `title` or `aria-label` on the interactive element or on the
 * clipped descendant.
 *
 * Inventory: every .tsx under src/components/profile, parsed with the
 * TypeScript compiler (so comments and prose never count). KNOWN lists the
 * offenders that existed when this guard landed. It is EXACT: a new offender
 * fails, and fixing a known one fails until it is removed from the list.
 */
// @mutate src/components/profile/CredentialsTab.tsx | text-ds-13 text-primary underline break-words | text-ds-13 text-primary underline truncate
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIR = join(ROOT, "src", "components", "profile");

const INTERACTIVE_TAGS = new Set(["a", "button", "Button", "Link", "NavLink"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem"]);
const CLIP_RE = /(^|\s)(?:[a-z0-9-]+:)*(truncate|text-ellipsis|line-clamp-(?:\d+|\[[^\]]+\]))(?=\s|$)/;

/**
 * Offenders present when the guard landed (2026-09-23). Each is a clipped
 * label inside a control with no title/aria-label. Both are tracked as Q116 in
 * docs/OPEN.md (not yet measured to clip on screen); remove an entry when its
 * offender is fixed or given its full text.
 * Key: `<file>:<interactive tag>:<clipped text>`.
 */
const KNOWN: string[] = [
  "src/components/profile/LegalTab.tsx:TabsTrigger:{TAB_LABELS[key]}",
  "src/components/profile/profileLanding/SettingsSection.tsx:button:{item.desc}",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function attr(el: Opening, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** Every string fragment inside a className (literal, cn(...) args, templates). */
function classText(el: Opening): string {
  const a = attr(el, "className");
  if (!a?.initializer) return "";
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text);
      n.templateSpans.forEach((s) => parts.push(s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(a.initializer);
  return parts.join(" ");
}

function isInteractive(el: Opening): boolean {
  const tag = el.tagName.getText();
  // Radix controls render a <button>: TabsTrigger, DropdownMenuTrigger, SelectTrigger...
  if (INTERACTIVE_TAGS.has(tag) || /Trigger$/.test(tag) || /^(DropdownMenu|ContextMenu|Menubar)Item$/.test(tag)) return true;
  const role = attr(el, "role")?.initializer;
  return !!role && ts.isStringLiteral(role) && INTERACTIVE_ROLES.has(role.text);
}

const hasFullText = (el: Opening) => !!(attr(el, "title") || attr(el, "aria-label"));

function openingOf(n: ts.Node): Opening | undefined {
  if (ts.isJsxElement(n)) return n.openingElement;
  if (ts.isJsxSelfClosingElement(n)) return n;
  return undefined;
}

export function scanSource(file: string, src: string) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let interactive = 0;
  const offenders: string[] = [];
  // The clipped element's own children as written, e.g. "View the {KIND_NOUN_TITLE[kind]} You Sent".
  const label = (n: ts.Node) =>
    (ts.isJsxElement(n) ? n.children.map((c) => c.getText(sf)).join("") : n.getText(sf))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const visit = (n: ts.Node) => {
    const open = openingOf(n);
    if (open && isInteractive(open)) {
      interactive++;
      if (!hasFullText(open)) {
        // The element itself, then every descendant that is not its own control.
        const check = (m: ts.Node, self: boolean) => {
          const o = openingOf(m);
          if (o && !self && isInteractive(o)) return; // counted on its own visit
          if (o && CLIP_RE.test(classText(o)) && !hasFullText(o)) {
            offenders.push(`${file}:${open.tagName.getText()}:${label(m)}`);
            return;
          }
          ts.forEachChild(m, (c) => check(c, false));
        };
        check(n, true);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { interactive, offenders };
}

function scanAll() {
  let interactive = 0;
  const offenders: string[] = [];
  const files = walk(SCAN_DIR);
  for (const f of files) {
    const r = scanSource(relative(ROOT, f), readFileSync(f, "utf8"));
    interactive += r.interactive;
    offenders.push(...r.offenders);
  }
  return { files: files.length, interactive, offenders };
}

describe("truncated action labels (Q108)", () => {
  const { files, interactive, offenders } = scanAll();

  it("inventories the real profile surface, not an empty glob", () => {
    expect(files).toBeGreaterThan(40);
    expect(interactive).toBeGreaterThan(100); // 112 on 2026-09-23
  });

  it("the detector fires on the original Q108 markup and respects title/aria-label", () => {
    const bad = `const X = () => <button className="flex-1 text-left text-ds-13 text-primary underline truncate">View the License You Sent</button>;`;
    expect(scanSource("fixture.tsx", bad).offenders).toHaveLength(1);
    const nested = `const X = () => <Button><span className={cn("block", ok && "sm:line-clamp-2")}>Label</span></Button>;`;
    expect(scanSource("fixture.tsx", nested).offenders).toHaveLength(1);
    const titled = `const X = () => <button title="View the License You Sent" className="truncate">View</button>;`;
    expect(scanSource("fixture.tsx", titled).offenders).toHaveLength(0);
    const wraps = `const X = () => <button className="flex-1 min-w-0 break-words">View the License You Sent</button>;`;
    expect(scanSource("fixture.tsx", wraps).offenders).toHaveLength(0);
    const commented = `const X = () => <button className="w-full">{/* truncate */}Go</button>;`;
    expect(scanSource("fixture.tsx", commented).offenders).toHaveLength(0);
  });

  it("no clipped action label without its full text, exactly the KNOWN list", () => {
    expect([...offenders].sort()).toEqual([...KNOWN].sort());
  });
});
