/**
 * A JSX comment opened with `/*` instead of `{/*` is VALID JSX TEXT.
 *
 * On 2026-09-19 `AppliedJobCard.tsx:567` did exactly that, and 24 lines of
 * source comment — including the owner's own quoted words — rendered as a
 * visible text node in the FIRST CARD of the Jobs tab, on prod, for as long as
 * it took a human to look.
 *
 * Nothing caught it. `tsc` is happy: it is text. eslint is happy: no rule
 * covers it. The production build is happy: it compiles. ~30 commits went green
 * over the top of it, and the visual pass found it in the first screenshot.
 * That is the whole lesson — a green gate confirmed every constant in the file
 * and told us nothing about what the page rendered.
 *
 * THE DETECTION: inside JSX children, a line that begins a block comment with
 * a bare `/*` is prose about to be shown to a user. The same token in JSX
 * ATTRIBUTE position is legal and common (5 such blocks exist in this repo), so
 * the check must distinguish them — it does that by tracking whether the last
 * unclosed `<` belongs to an open tag.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Lines where a `/*` sits inside a **JsxText** node.
 *
 * The AST is the whole point: TypeScript already knows the difference between
 * a comment (trivia, attached to a node, never emitted) and JSX TEXT (a child
 * that renders). A hand-rolled scanner cannot — my first attempt flagged every
 * file-header comment in the repo, because "am I inside JSX?" is exactly the
 * question a parser exists to answer.
 */
function bareJsxChildComments(file: string, src: string): number[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && node.text.includes("/*")) {
      const idx = node.getStart() + node.getText().indexOf("/*");
      hits.push(sf.getLineAndCharacterOfPosition(idx).line + 1);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return hits;
}

describe("a JSX comment never renders as page text", () => {
  const files = walk(path.join(ROOT, "src"));

  it("scans a real corpus — a passing run must have looked at something", () => {
    // Floor, not an exact count: an extractor that finds nothing would
    // otherwise satisfy every assertion below in silence.
    expect(files.length).toBeGreaterThan(150);
  });

  it("no .tsx file opens a block comment in JSX child position", () => {
    const offenders = files.flatMap((f) =>
      bareJsxChildComments(f, fs.readFileSync(f, "utf8")).map(
        (ln) => `${path.relative(ROOT, f)}:${ln}`,
      ),
    );
    expect(
      offenders,
      "a bare /* in JSX children is TEXT — it renders to the user. Use {/* … */}:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the detector actually fires — and spares the legal attribute form", () => {
    // Without this the check above could pass by never matching anything.
    const bad = `const A = () => (\n  <div>\n    /* this renders */\n  </div>\n);`;
    expect(bareJsxChildComments("bad.tsx", bad)).toEqual([3]);

    // Legal and common: a comment inside an open tag's attribute list.
    const ok = `const B = () => (\n  <div\n    /* why this prop */\n    id="x"\n  />\n);`;
    expect(bareJsxChildComments("ok.tsx", ok)).toEqual([]);

    // Legal: the correct braced form in child position.
    const braced = `const C = () => (\n  <div>\n    {/* fine */}\n  </div>\n);`;
    expect(bareJsxChildComments("braced.tsx", braced)).toEqual([]);
  });
});
