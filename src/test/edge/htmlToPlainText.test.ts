/**
 * CodeQL alert 79 (js/double-escaping) — `htmlToPlainText` in
 * `supabase/functions/_shared/resend.ts` decoded `&amp;` BEFORE `&lt;`, `&gt;`,
 * `&#39;` and `&quot;`, so one entity was decoded twice: an escaped literal
 * "&lt;" (`&amp;lt;` in the HTML) came out of the plaintext part as "<".
 * `&amp;` must be decoded last.
 *
 * resend.ts cannot be imported here (it loads `npm:resend` and reads `Deno.env`
 * at module scope, and the edge harness swaps the whole module for a double —
 * see `./mocks/email.ts`). So the REAL function is lifted out of the file by the
 * TypeScript AST, transpiled, and run: nothing below is a copy of it.
 */
// @mutate supabase/functions/_shared/resend.ts | .replace(/&nbsp;/g, " ") | .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const FILE = path.resolve(process.cwd(), "supabase/functions/_shared/resend.ts");

function loadHtmlToPlainText(): (html: string) => string {
  const sf = ts.createSourceFile(FILE, fs.readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true);
  const decl = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "htmlToPlainText",
  );
  if (!decl) throw new Error(`htmlToPlainText is no longer a top-level function in ${FILE}`);
  // Drop the `export` keyword: the declaration is evaluated as a script body.
  const src = decl.getText(sf).replace(/^export\s+/, "");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${js}\nreturn htmlToPlainText;`)() as (html: string) => string;
}

describe("htmlToPlainText decodes each entity exactly once (CodeQL 79)", () => {
  const htmlToPlainText = loadHtmlToPlainText();

  it("an escaped entity stays escaped: &amp;lt; is the text \"&lt;\", not \"<\"", () => {
    expect(htmlToPlainText("<p>Type &amp;lt;b&amp;gt; for bold</p>")).toBe("Type &lt;b&gt; for bold");
    expect(htmlToPlainText("&amp;quot;hi&amp;quot; &amp;#39;x&amp;#39;")).toBe("&quot;hi&quot; &#39;x&#39;");
  });

  it("single entities still decode as before", () => {
    expect(htmlToPlainText("<p>Tom &amp; Jerry &lt;3 &quot;ok&quot; it&#39;s&nbsp;fine &gt;</p>")).toBe(
      "Tom & Jerry <3 \"ok\" it's fine >",
    );
  });
});
