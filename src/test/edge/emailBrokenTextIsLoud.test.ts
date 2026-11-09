/**
 * Owner's UI audit 11-09, F178: the gallery copy of the Declutter pickup receipt showed "\uFFFD\uFFFD\uFFFD Louisiana Helpr"
 * where the em dash sign-off belongs. Checked: the real send path (declutterEmailParts -> renderEmail -> queueEmail's
 * pgmq jsonb -> process-email-queue -> Resend) renders that receipt clean (Deno render, 2026-11-09; the archive table
 * holds no bodies to check after sending). So nothing is refused, but any body that ever holds U+FFFD is now logged
 * as an error with its template name, so a real one is found.
 *
 * resend.ts cannot be imported here (npm:resend, Deno.env at module scope; the harness swaps it for a double), so the
 * real function is lifted out by the TypeScript AST and run, as htmlToPlainText.test.ts does.
 */
// @mutate supabase/functions/_shared/resend.ts |   return parts.some((p) => typeof p === "string" && p.includes("\uFFFD")); |   return false;
// @mutate supabase/functions/_shared/resend.ts |   if (emailHasBrokenText(email.subject, email.html, email.text)) { |   if (false) {
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const FILE = path.resolve(process.cwd(), "supabase/functions/_shared/resend.ts");
const SRC = fs.readFileSync(FILE, "utf8");

function lift(name: string): ts.FunctionDeclaration {
  const sf = ts.createSourceFile(FILE, SRC, ts.ScriptTarget.Latest, true);
  const decl = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!decl) throw new Error(`${name} is no longer a top-level function in ${FILE}`);
  return decl;
}

function loadCheck(): (...parts: Array<string | undefined>) => boolean {
  const decl = lift("emailHasBrokenText");
  const src = decl.getText().replace(/^export\s+/, "");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(`${js}\nreturn emailHasBrokenText;`)() as (...parts: Array<string | undefined>) => boolean;
}

describe("an email body with a broken UTF-8 decode is loud (F178)", () => {
  const check = loadCheck();

  it("spots U+FFFD in any part, and passes clean text with real em dashes", () => {
    expect(check("Your Declutter receipt", "<p>\uFFFD\uFFFD\uFFFD Louisiana Helpr</p>", "text")).toBe(true);
    expect(check("ok", undefined, "x \uFFFD y")).toBe(true);
    expect(check("Your Declutter receipt", "<p>— Louisiana Helpr</p>", "— Louisiana Helpr")).toBe(false);
  });

  it("queueEmail checks subject, html and text before it queues, and logs an error naming the template", () => {
    const q = lift("queueEmail").getText();
    expect(q).toMatch(/if \(emailHasBrokenText\(email\.subject, email\.html, email\.text\)\) \{\s*console\.error\(`\[queueEmail\] \$\{email\.templateName\}:/);
    expect(q.indexOf("emailHasBrokenText(")).toBeLessThan(q.indexOf('rpc("enqueue_email"'));
  });
});
