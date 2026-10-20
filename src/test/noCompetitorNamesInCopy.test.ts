// No other company's name in anything a visitor or member reads (owner,
// 2026-10-20, of the landing page's "Instead of Thumbtack, TaskRabbit or a
// Facebook group" lines: "i dont want those companies coming for me").
//
// Walks the TypeScript AST of every tracked non-test source file under src/ and
// checks only STRING CONTENT (string literals, template text, JSX text), the
// same scope as helprNotHelperInCopy.test.ts: comments and identifiers never
// reach a screen. index.html and public/*.html are read as plain text minus
// their comments, since their meta tags and JSON-LD are what search engines and
// link previews show.
//
// Facebook and Instagram are NOT on the list: they are our own channels
// (footer links, the admin social-post console). "Marketplace" alone is a
// generic word; "Facebook Marketplace" is listed.
import { describe, expect, it } from "vitest";
import { readdirSync as readdirDisk, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");

const COMPETITORS = [
  "Thumbtack", "TaskRabbit", "Craigslist", "OfferUp", "Mercari", "Zillow",
  "Apartments.com", "Nextdoor", "Etsy", "Angi", "Angie's List", "Care.com",
  "Rover", "Facebook Marketplace", "Poshmark", "Trulia", "Redfin",
];
const PATTERN = new RegExp(
  `(^|[^A-Za-z0-9])(${COMPETITORS.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`,
  "i",
);

export function competitorIn(text: string): string | null {
  const m = PATTERN.exec(text);
  return m ? m[2] : null;
}

function stringHits(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text) {
      const name = competitorIn(text);
      if (name) hits.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} "${name}" in ${JSON.stringify(text.trim().slice(0, 80))}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const isSource = (f: string) =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && !/\/(test|__tests__|tests)\//.test(f);

describe("no competitor names in user-facing copy", () => {
  it("the matcher catches the original landing lines and spares our own channels", () => {
    expect(competitorIn("Instead of Thumbtack, TaskRabbit or a Facebook group")).toBe("Thumbtack");
    expect(competitorIn("Instead of Marketplace, OfferUp or Craigslist")).toBe("OfferUp");
    expect(competitorIn("Instead of Zillow or Apartments.com")).toBe("Zillow");
    expect(competitorIn("Follow us on Instagram")).toBeNull();
    expect(competitorIn("Follow us on Facebook")).toBeNull();
    expect(competitorIn("Louisiana's local job marketplace")).toBeNull();
    expect(competitorIn("rovers")).toBeNull();
  });

  it("no src/ string literal or JSX text names a competitor", () => {
    const files = trackedFiles("src").filter(isSource);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => stringHits(f, readFileSync(path.join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("index.html and public/*.html name no competitor", () => {
    // public/ is outside src/, so the plain directory listing is the right one (trackedFiles covers src/ only).
    const pages = ["index.html", ...readdirDisk(path.join(ROOT, "public")).filter((f) => f.endsWith(".html")).map((f) => `public/${f}`)];
    const hits = pages.flatMap((f) => {
      const text = readFileSync(path.join(ROOT, f), "utf8").replace(/<!--[\s\S]*?-->/g, "");
      const name = competitorIn(text);
      return name ? [`${f}: "${name}"`] : [];
    });
    expect(hits).toEqual([]);
  });
});
