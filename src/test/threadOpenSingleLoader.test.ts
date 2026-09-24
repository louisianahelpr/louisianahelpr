/**
 * CLASS CHECK: every way of opening a message thread goes through ONE loader,
 * `openConvo` in src/pages/messages/useMessagesData.ts.
 *
 * Owner, 2026-09-14: a message notification's link opened the right thread and
 * painted "Say hello. Send the first message…" over a thread with 38 messages.
 * The deep-link path set the active thread and the URL flag by hand
 * (`setActiveConvo(match); openThreadUrl();`) and never ran the fetch the inbox
 * tap runs. Any second "open" path can drift the same way, so the class is:
 * nothing but `openConvo` may put a conversation into `activeConvo` or push the
 * thread-open URL.
 *
 * The ways in, inventoried from source rather than listed:
 *   - IN-APP LINKS: every `/messages?…jobId=` string under src/ (job cards,
 *     the nav's recent-chats strip, the job detail dialog, …). They all land
 *     on the Messages page's deep-link effect.
 *   - PUSH / NOTIFICATION TAP: the server builds the link
 *     (notify_message_recipient, latest migration defining it) and the app
 *     navigates to it (nativePush.ts) — also the deep-link effect.
 *   - (SHORT LINKS: `/m/:id` was rewritten to `/messages?jobId=` by deepLinkRoute.ts
 *     until Q194 deleted the short links; nothing mints them now.)
 *   - INBOX TAP: every JSX `openConvo=` / `openConvo(` call site.
 * Then the one funnel is asserted: the page feeds `jobId`/`userId` into the
 * hook, the deep-link effect calls `openConvo`, and no other code anywhere
 * sets a thread or pushes the flag.
 */
// The exact pre-fix shape, restored: the deep-link effect setting the thread by
// hand instead of running the one loader. AST-driven, so the comment shape
// cannot satisfy it.
// @mutate src/pages/messages/useMessagesData.ts | void openConvo(match); | setActiveConvo(match);
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const HOOK = path.join(SRC, "pages/messages/useMessagesData.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !p.includes(`${path.sep}test${path.sep}`)) out.push(p);
  }
  return out;
}

const parse = (file: string, source: string) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Name of the nearest enclosing `const X = useCallback(...)` / function / effect. */
function enclosingName(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "useEffect") {
      return p.getText().includes("deepLinkJobId") ? "useEffect(deepLink)" : "useEffect";
    }
  }
  return "<top>";
}

export type OpenViolation = { file: string; line: number; call: string; inside: string };

/**
 * Every call that opens a thread outside `openConvo`:
 *   - `setActiveConvo(x)` where x is not `null` and not an updater function
 *     (updaters only patch the ALREADY-open thread: mute, send reconciliation);
 *   - `openThreadUrl(...)` anywhere.
 */
export function findThreadOpensOutsideLoader(file: string, source: string): OpenViolation[] {
  const sf = parse(file, source);
  const out: OpenViolation[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText().replace(/\?\.$/, "");
      const name = callee.replace(/\?\./g, ".");
      const arg = n.arguments[0];
      const opensThread =
        (name === "setActiveConvo" &&
          !!arg &&
          arg.kind !== ts.SyntaxKind.NullKeyword &&
          !ts.isArrowFunction(arg) &&
          !ts.isFunctionExpression(arg)) ||
        name === "openThreadUrl";
      if (opensThread) {
        const inside = enclosingName(n);
        if (inside !== "openConvo") {
          out.push({
            file: path.relative(ROOT, file),
            line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            call: n.getText().split("\n")[0],
            inside,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("every way of opening a message thread goes through openConvo", () => {
  const files = walk(SRC).map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));
  const hookSrc = fs.readFileSync(HOOK, "utf8");

  // ── Inventory ──
  const linkSites = files.flatMap(({ f, src }) =>
    [...src.matchAll(/\/messages\?[^"'`\s]*jobId=/g)].map(
      (m) => `${path.relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length}`,
    ),
  );
  const inboxTapSites = files.flatMap(({ f, src }) =>
    /openConvo(=\{|\()/.test(src) && !f.endsWith("useMessagesData.ts") ? [path.relative(ROOT, f)] : [],
  );
  const migrations = fs
    .readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((m) => /FUNCTION\s+(public\.)?notify_message_recipient/i.test(fs.readFileSync(path.join(ROOT, "supabase/migrations", m), "utf8")))
    .sort();

  it("found every kind of entry point (a checker that sees nothing proves nothing)", () => {
    // Job cards on both sides, the nav, the job dialog.
    for (const where of ["appliedJobCard/", "postedJobCard/", "MobileNav.tsx", "JobDetailDialog.tsx"]) {
      expect(linkSites.some((s) => s.includes(where)), `no /messages?jobId= link found in ${where}\n${linkSites.join("\n")}`).toBe(true);
    }
    // Inbox tap.
    expect(inboxTapSites.some((s) => s.endsWith("ConversationRow.tsx")), inboxTapSites.join("\n")).toBe(true);
    // Push / notification tap: server builds the link, app navigates to it.
    expect(migrations.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(SRC, "lib/nativePush.ts"), "utf8")).toMatch(/notification\?\.data\?\.link/);
  });

  it("the server's message-notification link is a jobId deep link (lands on the one funnel)", () => {
    const latest = fs.readFileSync(path.join(ROOT, "supabase/migrations", migrations[migrations.length - 1]), "utf8");
    expect(latest).toMatch(/'\/messages\?jobId='/);
  });

  it("the Messages page feeds jobId/userId into the hook's deep-link path", () => {
    const page = fs.readFileSync(path.join(SRC, "pages/messages/Messages.tsx"), "utf8");
    expect(page).toMatch(/deepLinkJobId\s*=\s*searchParams\.get\("jobId"\)/);
    expect(page).toMatch(/deepLinkUserId\s*=\s*searchParams\.get\("userId"\)/);
    expect(page).toMatch(/useMessagesData\(\{[\s\S]*deepLinkJobId,[\s\S]*deepLinkUserId,/);
  });

  it("the deep-link effect opens through openConvo", () => {
    const sf = parse(HOOK, hookSrc);
    let effect: ts.CallExpression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText() === "useEffect" && n.getText().includes("deepLinkJobId")) effect = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(effect, "deep-link effect not found").toBeDefined();
    expect(effect!.arguments[0].getText()).toMatch(/\bopenConvo\(/);
  });

  it("nothing but openConvo sets the open thread or pushes the thread-open URL", () => {
    const violations = files.flatMap(({ f, src }) => findThreadOpensOutsideLoader(f, src));
    expect(violations.map((v) => `${v.file}:${v.line} ${v.call} (in ${v.inside})`)).toEqual([]);
  });

  it("the checker flags the pre-fix deep-link shape and passes the fixed one", () => {
    const before = `
      function useX() {
        const openConvo = useCallback(async (c) => { setActiveConvo(c); openThreadUrl(); }, []);
        useEffect(() => {
          if (!deepLinkJobId) return;
          const match = list.find((c) => c.jobId === deepLinkJobId);
          setActiveConvo(match);
          openThreadUrl();
          setActiveConvo((cur) => cur);
          setActiveConvo(null);
        }, [deepLinkJobId]);
      }`;
    expect(findThreadOpensOutsideLoader("x.ts", before).map((v) => v.call)).toEqual([
      "setActiveConvo(match)",
      "openThreadUrl()",
    ]);
    const after = before.replace("setActiveConvo(match);\n          openThreadUrl();", "void openConvo(match);");
    expect(findThreadOpensOutsideLoader("x.ts", after)).toEqual([]);
  });
});
