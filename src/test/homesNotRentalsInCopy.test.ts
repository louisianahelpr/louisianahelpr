/**
 * HOMES, not "Rentals" (owner 2026-10-18): the section a member reads about is
 * called Homes, with tabs Rent | Buy. Route, table, RPC and switch names keep
 * "rentals" (they are never shown), so this guard reads only STRING CONTENT
 * (string literals, template text, JSX text) in every non-test source file of
 * src/ and supabase/functions/, through the TypeScript AST, and fails on the
 * section word "Rentals" or the phrase "your rentals". Comments and
 * identifiers are not copy. Lower-case "rental" as an adjective ("Rental
 * repair", "Party rentals" in Shops) is not the section name and is allowed.
 *
 * @mutate src/components/rentals/RentalsHomeView.tsx |       <SectionScreen section="homes" title="Homes" add={sectionByKey("homes").add}>\n        {tabs}\n        <HomesBrowse /> |       <SectionScreen section="homes" title="Rentals" add={sectionByKey("homes").add}>\n        {tabs}\n        <HomesBrowse />
 * @mutate supabase/migrations/20261019044500_rentals_ownership_alert_homes_words.sql | Admin -> Settings -> Homes: ownership proof | Admin -> Settings -> Rentals: ownership proof
 *
 * Server-written words (notifications, alerts) are copy too: the NEWEST
 * definition of every public.rentals_* function (any dollar-quote tag,
 * comments blanked) must carry no SQL string literal with the section word.
 * @mutate src/lib/rentals/errorCopy.ts |   feature_disabled: "Homes isn't open for your account yet.", |   feature_disabled: "Rentals isn't open for your account yet.",
 * @mutate src/pages/rentals/RentalsPage.tsx | label="Loading Homes" | label="Loading your rentals"
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readdirSync } from "./helpers/trackedFiles";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["src", "supabase/functions"];
const SECTION_WORD = /\bRentals\b|\b[Yy]our rentals\b/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "tests") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Arguments to console/log calls never reach a member's screen. */
function isLogArgument(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const c = p.expression;
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "console") return true;
    }
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

export function findSectionWord(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const check = (node: ts.Node, text: string) => {
    if (!SECTION_WORD.test(text)) return;
    if (isLogArgument(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push(`${path.relative(ROOT, fileName)}:${line + 1}: ${text.trim().slice(0, 120)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) check(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("the section is called Homes in everything a member reads", () => {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

  it("reads a real inventory, including the Homes screens", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("RentalsHomeView.tsx"))).toBe(true);
  });

  it("the detector sees the section word in copy and ignores identifiers and keys", () => {
    expect(findSectionWord("a.tsx", 'const x = <h1>Rentals</h1>;')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const x = "Loading your rentals";')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const x = `Open Rentals now`;')).toHaveLength(1);
    expect(findSectionWord("a.ts", 'const RentalsPage = useFeature("rentals"); const k = ["rentals-home"]; const r = "/rentals/invite";')).toHaveLength(0);
    expect(findSectionWord("a.ts", 'const x = "Rental repair."; const y = "Party rentals";')).toHaveLength(0);
  });

  it("no source file shows 'Rentals' as the section name", () => {
    const hits = files.flatMap((f) => findSectionWord(f, readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

const MIG_DIR = path.join(ROOT, "supabase/migrations");

/** The newest body of every public.rentals_* function, by name: later files win (any dollar-quote tag). */
export function newestRentalsBodies(files: { name: string; sql: string }[]): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const code = blankSqlComments(sql);
    const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(rentals_\w+)\s*\(/gi;
    for (let m = head.exec(code); m; m = head.exec(code)) {
      const as = /\bAS\s+(\$[A-Za-z_0-9]*\$)/g;
      as.lastIndex = m.index;
      const open = as.exec(code);
      if (!open) continue;
      const start = open.index + open[0].length;
      const end = code.indexOf(open[1], start);
      if (end < 0) continue;
      out.set(m[1], { file: name, body: code.slice(start, end) });
      head.lastIndex = end;
    }
  }
  return out;
}

export function sqlSectionWordHits(body: string): string[] {
  return [...body.matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]).filter((lit) => SECTION_WORD.test(lit));
}

describe("server-written Homes words (newest rentals_* SQL bodies)", () => {
  const migs = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(path.join(MIG_DIR, name), "utf8") }));
  const bodies = newestRentalsBodies(migs);

  it("reads a real inventory: the rentals functions, each from its newest file", () => {
    expect(bodies.size).toBeGreaterThan(20);
    expect(bodies.get("rentals_submit_ownership_proof")?.file).toBe("20261019044500_rentals_ownership_alert_homes_words.sql");
  });

  it("the parser keeps the newest body and any dollar tag; comments are not copy", () => {
    const fx = newestRentalsBodies([
      { name: "2_b.sql", sql: "CREATE OR REPLACE FUNCTION public.rentals_x() RETURNS void AS $fn$ BEGIN PERFORM 'Homes'; END; $fn$;" },
      { name: "1_a.sql", sql: "CREATE FUNCTION public.rentals_x() RETURNS void AS $$ BEGIN PERFORM 'Rentals'; END; $$;" },
      { name: "3_c.sql", sql: "CREATE FUNCTION public.rentals_y() RETURNS void AS $q$ -- 'Rentals'\n BEGIN PERFORM 'Go to Rentals'; END; $q$;" },
    ]);
    expect(sqlSectionWordHits(fx.get("rentals_x")!.body)).toEqual([]);
    expect(sqlSectionWordHits(fx.get("rentals_y")!.body)).toEqual(["'Go to Rentals'"]);
  });

  it("no rentals_* function writes 'Rentals' as the section name", () => {
    const hits = [...bodies].flatMap(([fn, b]) => sqlSectionWordHits(b.body).map((h) => `${b.file} ${fn}: ${h.slice(0, 120)}`));
    expect(hits).toEqual([]);
  });
});
