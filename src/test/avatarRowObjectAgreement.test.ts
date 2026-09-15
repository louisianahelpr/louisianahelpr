/**
 * CLASS CHECK: `profiles.avatar_url` and the `avatars` bucket never disagree.
 *
 * WHAT HAPPENED (press-every-control, 2026-09-15). The E2E helper's row ended
 * in `avatar.png` while storage held only `avatar.jpg`, so every screen that
 * rendered that account fired `400 GET …/avatar.png` (22 failed presses). The
 * writer that did it was not the app's upload and not the seed alone: journey
 * J7 (e2e/journeys/03-account.spec.ts) changed the photo through the crop
 * dialog — which always produces a JPEG, so the app wrote `avatar.jpg` and, by
 * design, deleted `avatar.png` — and its cleanup then PATCHed the row back to
 * the `avatar.png` URL it had remembered. A row pointed at an object that its
 * own run had just deleted.
 *
 * The same disagreement was reachable from real users, three ways, because the
 * app deleted the superseded object BEFORE it wrote the row:
 *   - Profile.tsx: upload + delete old `avatar.<ext>`, THEN the row update.
 *     A failed or zero-row update left the row on the deleted object.
 *   - CompleteProfile.tsx (via uploadProfileFiles): same order, and the row
 *     write in between can fail on a contact-leak bio (23514) or a timeout.
 *   - complete-signup: upload + sweep, then five early returns and the profile
 *     update — any of which left the row on the deleted object.
 * and one more on account deletion: the purge deleted the avatar object before
 * `purge_user_data` cleared the row, so a purge that stopped half-way (Stripe,
 * ban retention, the RPC) left a live account pointing at nothing.
 *
 * THE INVARIANT, enforced from source (every file under src/, supabase/
 * functions/, scripts/ and e2e/ — the inventory is derived, never listed):
 *
 *   A. Every write of `avatar_url` writes NULL, a literal that is not an
 *      `avatars` object, or a URL the writer has JUST CONFIRMED exists:
 *        - the row-writer handed to `replaceAvatarObject` (called only after
 *          its upload succeeded) or the save callback handed to
 *          `uploadProfileFiles` (which only calls it from that row-writer),
 *        - a URL minted from an `.upload()` whose error was checked, in the
 *          same function,
 *        - a URL returned by a same-file function that HEADs it and checks
 *          `.ok` first.
 *      Remembering a URL and writing it back later (J7), or building one by
 *      hand (`…/avatar.png`), is exactly how the row went stale — both fail.
 *
 *   B. No object in `avatars` is deleted while a live row may point at it:
 *        - `sweepSupersededAvatars` is only ever called AFTER the avatar row
 *          write in the same function;
 *        - `.remove()` on the avatars bucket happens only inside the sweep
 *          primitives or the portfolio sub-folder sweep;
 *        - a delete over a dynamic bucket list is either the account purge —
 *          which must clear `avatar_url` before it purges storage — or a
 *          listed path that only ever touches accounts that no longer exist.
 *
 *   C. No SQL function writes `avatar_url` to anything but NULL.
 *
 * Red proof: AVATAR_AGREEMENT_ROOT=<a checkout of the pre-fix tree> npx vitest
 * run src/test/avatarRowObjectAgreement.test.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.env.AVATAR_AGREEMENT_ROOT ?? path.resolve(__dirname, "../..");
const CODE_DIRS = ["src", "supabase/functions", "scripts", "e2e"];

/** Path prefixes whose `avatar_url` objects can never reach prod, and why. */
const NEVER_REACHES_PROD: Record<string, string> = {
  "e2e/happy-path/":
    "the mocked-Supabase world: every avatar_url here is a route.fulfill / mock-RPC response body, never a request to prod",
};

// ── inventory ───────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|cjs|js)$/.test(e.name) && !/\.test\.(tsx?|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

type Source = { file: string; text: string; sf: ts.SourceFile };

const SOURCES: Source[] = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .filter((f) => !rel(f).startsWith("src/test/") && rel(f) !== "src/integrations/supabase/types.ts")
  .map((f) => {
    const text = fs.readFileSync(f, "utf8");
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : f.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    return { file: rel(f), text, sf: ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind) };
  });

const lineOf = (s: Source, n: ts.Node) => s.sf.getLineAndCharacterOfPosition(n.getStart(s.sf)).line + 1;
const where = (s: Source, n: ts.Node) => `${s.file}:${lineOf(s, n)}`;

function visitAll(s: Source, fn: (n: ts.Node) => void) {
  const v = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, v);
  };
  v(s.sf);
}

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (n: ts.Node): n is Fn =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

function enclosingFn(n: ts.Node): Fn | null {
  for (let p = n.parent; p; p = p.parent) if (isFn(p)) return p;
  return null;
}

/** Name a function is known by: its own name, its variable, or its property key. */
function fnName(f: Fn): string {
  if ((ts.isFunctionDeclaration(f) || ts.isMethodDeclaration(f)) && f.name) return f.name.getText();
  const p = f.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText();
  if (p && ts.isPropertyAssignment(p)) return p.name.getText();
  return "<anonymous>";
}

/** Last segment of a call's callee: `a.b.update(...)` → "update". */
function calleeName(call: ts.CallExpression): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function nearestCall(n: ts.Node): ts.CallExpression | null {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) return p;
    if (ts.isBlock(p) || ts.isSourceFile(p)) return null;
  }
  return null;
}

const propName = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();

/** `const X = "literal"` anywhere in the file → "literal". */
function constString(s: Source, name: string): string | null {
  let found: string | null = null;
  visitAll(s, (n) => {
    if (
      !found &&
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))
    ) {
      found = n.initializer.text;
    }
  });
  return found;
}

function bindsName(f: Fn, name: string): boolean {
  const inBinding = (b: ts.BindingName): boolean =>
    ts.isIdentifier(b)
      ? b.text === name
      : b.elements.some((el) => !ts.isOmittedExpression(el) && inBinding(el.name));
  return f.parameters.some((p) => inBinding(p.name));
}

// ── A. writers ──────────────────────────────────────────────────────────────

type WriteSite = { src: Source; node: ts.Node; value: ts.Expression };

function avatarUrlWrites(): WriteSite[] {
  const out: WriteSite[] = [];
  for (const src of SOURCES) {
    if (!src.text.includes("avatar_url")) continue;
    visitAll(src, (n) => {
      if (ts.isPropertyAssignment(n) && propName(n.name) === "avatar_url") out.push({ src, node: n, value: n.initializer });
      else if (ts.isShorthandPropertyAssignment(n) && n.name.text === "avatar_url") out.push({ src, node: n, value: n.name });
      else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ((ts.isPropertyAccessExpression(n.left) && n.left.name.text === "avatar_url") ||
          (ts.isElementAccessExpression(n.left) && n.left.argumentExpression.getText().replace(/["'`]/g, "") === "avatar_url"))
      ) {
        out.push({ src, node: n, value: n.right });
      }
    });
  }
  return out;
}

type Verdict = { ok: true; why: string } | { ok: false; why: string };

function isAvatarsObjectText(t: string) {
  return /(^|\/)avatars\//.test(t);
}

/** Every assignment to `name` inside `f` (declaration initializers + `name = …`). */
function assignmentsIn(f: Fn, name: string): ts.Expression[] {
  const out: ts.Expression[] = [];
  const v = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) out.push(n.initializer);
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) &&
      n.left.text === name
    ) {
      out.push(n.right);
    }
    ts.forEachChild(n, v);
  };
  if (f.body) v(f.body);
  return out;
}

/** The assignment sits in the `else` of an `if (<something named *err*>)`. */
function inElseOfErrorCheck(n: ts.Node): boolean {
  // A `while` rather than a `for (… ; p = p.parent)`: narrowing `p` from its
  // own incrementor is circular to the checker (TS7022), and the walk reads
  // the same either way.
  let p: ts.Node = n;
  while (p.parent) {
    const parent: ts.Node = p.parent;
    if (ts.isIfStatement(parent) && parent.elseStatement === p && /err/i.test(parent.expression.getText())) return true;
    if (isFn(parent)) return false;
    p = parent;
  }
  return false;
}

function classifyWrite(w: WriteSite): Verdict {
  const { src, node, value } = w;
  const prefix = Object.keys(NEVER_REACHES_PROD).find((p) => src.file.startsWith(p));
  if (prefix) return { ok: true, why: NEVER_REACHES_PROD[prefix] };

  const v = ts.isParenthesizedExpression(value) ? value.expression : value;
  if (v.kind === ts.SyntaxKind.NullKeyword) return { ok: true, why: "NULL points at nothing" };

  const literal =
    ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)
      ? v.text
      : ts.isIdentifier(v)
        ? constString(src, v.text)
        : null;
  if (literal !== null) {
    return isAvatarsObjectText(literal)
      ? { ok: false, why: `hard-codes an avatars object (${literal}) that nothing proves exists` }
      : { ok: true, why: "a literal outside the avatars bucket (data: URI / brand asset)" };
  }
  if (ts.isTemplateExpression(v)) {
    return isAvatarsObjectText(v.getText())
      ? { ok: false, why: "builds an avatars URL by hand — nothing proves that object exists" }
      : { ok: false, why: "writes a constructed URL this check cannot classify" };
  }

  // Structural non-writes: a zod schema, React state, a test assertion.
  if (v.getText().startsWith("z.")) return { ok: true, why: "a zod schema, not a write" };
  const call = nearestCall(node);
  if (call && /^set[A-Z]/.test(calleeName(call))) return { ok: true, why: "React state mirroring a write already made" };
  if (call && /^to[A-Z]/.test(calleeName(call))) return { ok: true, why: "an assertion, not a write" };

  if (ts.isIdentifier(v)) {
    const f = enclosingFn(node);
    if (f) {
      // F1 — the row-writer replaceAvatarObject calls only after its upload.
      if (bindsName(f, v.text)) {
        const holder = f.parent;
        const writeProp =
          (ts.isMethodDeclaration(f) && propName(f.name) === "write") ||
          (holder && ts.isPropertyAssignment(holder) && propName(holder.name) === "write");
        const obj = ts.isMethodDeclaration(f) ? f.parent : holder?.parent;
        if (writeProp && obj && ts.isObjectLiteralExpression(obj) && obj.parent && ts.isCallExpression(obj.parent) && calleeName(obj.parent) === "replaceAvatarObject") {
          return { ok: true, why: "the row-writer replaceAvatarObject calls after its upload and before its sweep" };
        }
        if (holder && ts.isCallExpression(holder) && calleeName(holder) === "uploadProfileFiles") {
          return { ok: true, why: "the save callback uploadProfileFiles calls from replaceAvatarObject's row-writer" };
        }
      }

      const assigned = assignmentsIn(f, v.text);
      // F2 — minted from an upload whose error was checked, in this function.
      const uploads = collect(f, (n) => ts.isCallExpression(n) && calleeName(n) === "upload");
      const minted = assigned.filter((e) => e.getText().includes(".publicUrl"));
      if (
        minted.length > 0 &&
        assigned.every((e) => e.kind === ts.SyntaxKind.NullKeyword || minted.includes(e)) &&
        minted.every((e) => uploads.some((u) => u.getEnd() < e.getStart()) && inElseOfErrorCheck(e))
      ) {
        return { ok: true, why: "minted from an upload that just succeeded" };
      }

      // F3 — returned by a same-file function that HEADs the URL and checks .ok
      // (a `let x = null` placeholder is fine: NULL points at nothing).
      const nonNull = assigned.filter((e) => e.kind !== ts.SyntaxKind.NullKeyword);
      const producers = nonNull
        .map((e) => (ts.isAwaitExpression(e) ? e.expression : e))
        .filter(ts.isCallExpression)
        .map((c) => calleeName(c));
      if (nonNull.length > 0 && producers.length === nonNull.length && producers.every((name) => headConfirms(src, name))) {
        return { ok: true, why: `proven to resolve by ${producers[0]}() immediately before the write` };
      }
    }
  }

  return {
    ok: false,
    why: `writes \`${v.getText().slice(0, 60)}\` — not a URL this code just uploaded or proved resolves (a remembered or rebuilt URL is how the row went stale)`,
  };
}

function collect(root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] {
  const out: ts.Node[] = [];
  const v = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, v);
  };
  v(root);
  return out;
}

/** A function declared in this file whose body HEADs a URL and checks `.ok`. */
function headConfirms(src: Source, name: string): boolean {
  let body: string | null = null;
  visitAll(src, (n) => {
    if (body !== null) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) body = n.body.getText();
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && isFn(n.initializer)) {
      body = n.initializer.body?.getText() ?? null;
    }
  });
  if (body === null) return false;
  const text: string = body;
  return /method:\s*["']HEAD["']|\.head\(/.test(text) && /\.ok\b/.test(text);
}

// ── B. removals ─────────────────────────────────────────────────────────────

/** `.remove()` on a storage bucket, or a REST DELETE against /object/<bucket>. */
type Removal = { src: Source; call: ts.CallExpression; bucket: string | null };

function bucketOfFrom(src: Source, arg: ts.Expression | undefined): string | null {
  if (!arg) return null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isIdentifier(arg)) return constString(src, arg.text);
  return null;
}

function storageRemovals(): Removal[] {
  const out: Removal[] = [];
  for (const src of SOURCES) {
    visitAll(src, (n) => {
      if (!ts.isCallExpression(n)) return;
      // supabase-js: <x>.storage.from(<bucket>)….remove(paths), including via a
      // local `const bucket = client.storage.from(X)`.
      if (calleeName(n) === "remove" && ts.isPropertyAccessExpression(n.expression)) {
        let receiver: ts.Expression = n.expression.expression;
        if (ts.isIdentifier(receiver)) {
          const scope = enclosingFn(n) ?? src.sf;
          const name = receiver.text;
          const decl = collect(scope, (d) => ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.name.text === name && !!d.initializer)[0] as
            | ts.VariableDeclaration
            | undefined;
          if (decl?.initializer) receiver = decl.initializer;
        }
        if (!/storage\s*\.\s*from\(/.test(receiver.getText())) return;
        const fromCall = collect(receiver, (c) => ts.isCallExpression(c) && calleeName(c) === "from")[0] as
          | ts.CallExpression
          | undefined;
        out.push({ src, call: n, bucket: bucketOfFrom(src, fromCall?.arguments[0]) });
        return;
      }
      // REST: a call carrying "DELETE" and an /object/<bucket> path.
      const args = n.arguments;
      const isDelete =
        args.some((a) => ts.isStringLiteral(a) && a.text === "DELETE") ||
        calleeName(n) === "delete" ||
        args.some((a) => ts.isObjectLiteralExpression(a) && /method:\s*["']DELETE["']/.test(a.getText()));
      if (!isDelete) return;
      const pathArg = args.find(
        (a) => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isTemplateExpression(a)) && /\/object\//.test(a.getText()),
      );
      if (!pathArg) return;
      const text = pathArg.getText().replace(/^[`"']|[`"']$/g, "");
      const m = text.match(/\/object\/([^/$`"'?]*)/);
      const bucket = m && m[1] ? m[1] : null; // `/object/${bucket}` → dynamic
      out.push({ src, call: n, bucket });
    });
  }
  return out;
}

/** Functions allowed to `.remove()` from the avatars bucket, and why. */
const AVATARS_REMOVERS: Record<string, string> = {
  sweepSupersededAvatars: "retires superseded avatar.* objects; B1 proves every caller wrote the row first",
  sweepPortfolioFolder: "portfolio images under <uid>/portfolio/ — never an avatar.* key a row can point at",
};

/**
 * Deletes over a dynamic bucket (a list that includes `avatars`), by file.
 * `check` returns an error string when the file breaks its own promise.
 */
const DYNAMIC_REMOVERS: Record<string, { why: string; check?: (src: Source) => string | null }> = {
  "supabase/functions/_shared/accountPurge.ts": {
    why: "account deletion purges every identity bucket — so it must clear avatar_url BEFORE the avatar object goes",
    check: (src) => {
      let body: ts.Block | undefined;
      visitAll(src, (n) => {
        if (ts.isFunctionDeclaration(n) && n.name?.text === "purgeAccount") body = n.body;
      });
      if (!body) return "purgeAccount not found";
      const purge = collect(body, (n) => ts.isCallExpression(n) && calleeName(n) === "purgeIdentityStorage")[0];
      if (!purge) return "purgeAccount no longer calls purgeIdentityStorage";
      // Any same-file function that writes `avatar_url: null`, called earlier.
      const clearers = new Set<string>();
      visitAll(src, (n) => {
        if (ts.isFunctionDeclaration(n) && n.name && n.body && /avatar_url\s*:\s*null/.test(n.body.getText())) clearers.add(n.name.text);
      });
      const cleared = collect(body, (n) => ts.isCallExpression(n) && clearers.has(calleeName(n))).some(
        (c) => c.getEnd() < purge.getStart(),
      );
      return cleared
        ? null
        : "purgeAccount deletes the avatar object before anything clears profiles.avatar_url — a purge that stops later leaves a live row pointing at a deleted object";
    },
  },
  "supabase/functions/_shared/jobMedia.ts": {
    why: "job media only (job-photos / proof-photos / application-attachments by job id); never the avatars bucket",
    check: (src) => (/["']avatars["']/.test(src.text) ? "jobMedia now names the avatars bucket" : null),
  },
  "src/lib/storageCleanup.ts": {
    why: "chat attachments and job photos of a row being deleted; never the avatars bucket",
    check: (src) => (/["']avatars["']/.test(src.text) ? "storageCleanup now names the avatars bucket" : null),
  },
  "scripts/lib/jobMediaRest.mjs": {
    why: "user folders only for accounts the caller is deleting in the same run (prod-seed teardown), plus job media — no live row is left to point at them",
  },
  "scripts/storage-orphan-sweep.mjs": {
    why: "only objects whose owning user or job no longer exists, re-checked immediately before each delete — there is no row",
  },
};

function positionOfRowWrite(f: Fn, before: number): boolean {
  if (!f.body) return false;
  const assignTargets = new Set(
    collect(
      f.body,
      (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.name.text === "avatar_url",
    ).map((n) => ((n as ts.BinaryExpression).left as ts.PropertyAccessExpression).expression.getText()),
  );
  return collect(f.body, (n) => {
    if (!ts.isCallExpression(n) || n.getEnd() > before) return false;
    const name = calleeName(n);
    // `row.write(publicUrl)` — and ONLY that. A bare `name === "write"` also
    // matched `fs.write`, `res.write` and any logger, so a future sweep call
    // site in a function that happened to write something unrelated would pass
    // B1 having never touched `avatar_url`. The receiver must be a PARAMETER of
    // the enclosing function, which is exactly the row-handed-in contract.
    if (name === "write") {
      const recv = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : undefined;
      return !!recv && ts.isIdentifier(recv) && bindsName(f, recv.text);
    }
    if (name !== "update" && name !== "upsert") return false;
    const arg = n.arguments[0];
    if (!arg) return false;
    return (ts.isObjectLiteralExpression(arg) && /\bavatar_url\b/.test(arg.getText())) || assignTargets.has(arg.getText());
  }).length > 0;
}

// ── C. SQL ──────────────────────────────────────────────────────────────────

function latestSqlFunctionBodies(): Map<string, { file: string; body: string }> {
  const dir = path.join(ROOT, "supabase/migrations");
  const latest = new Map<string, { file: string; body: string }>();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return latest;
  }
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) latest.set(m[1].toLowerCase(), { file: f, body: m[4] });
  }
  return latest;
}

// ── the checks ──────────────────────────────────────────────────────────────

describe("profiles.avatar_url ⇄ avatars bucket agreement (class check)", () => {
  const writes = avatarUrlWrites();

  it("inventory is live: finds the app, edge, seed and journey writers", () => {
    const files = new Set(writes.map((w) => w.src.file));
    for (const f of ["src/pages/Profile.tsx", "src/pages/CompleteProfile.tsx", "supabase/functions/complete-signup/index.ts", "scripts/audit/prod-seed.mjs"]) {
      expect(files, `the writer inventory lost ${f} — the matcher is broken`).toContain(f);
    }
  });

  it("A. every avatar_url write points at an object the writer just confirmed", () => {
    const verdicts = writes.map((w) => ({ w, v: classifyWrite(w) }));
    // AVATAR_AGREEMENT_DEBUG=<file> writes every verdict there (the suite mutes console).
    if (process.env.AVATAR_AGREEMENT_DEBUG) {
      fs.writeFileSync(
        process.env.AVATAR_AGREEMENT_DEBUG,
        verdicts.map((x) => `${where(x.w.src, x.w.node)} ${x.v.ok ? "ok" : "BAD"}: ${x.v.why}`).join("\n") + "\n",
      );
    }
    const bad = verdicts
      .filter((x) => !x.v.ok)
      .map((x) => `${where(x.w.src, x.w.node)} — ${x.v.why}`);
    expect(bad, "these can leave profiles.avatar_url on an object that does not exist").toEqual([]);
  });

  it("A2. replaceAvatarObject awaits upload → row.write → sweep, in that order (what F1 trusts)", () => {
    const src = SOURCES.find((s) => s.file === "src/lib/avatarStorage.ts");
    expect(src, "src/lib/avatarStorage.ts is missing").toBeTruthy();
    let fn: ts.FunctionDeclaration | undefined;
    visitAll(src!, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "replaceAvatarObject") fn = n;
    });
    expect(fn, "replaceAvatarObject not found").toBeTruthy();
    const calls = collect(fn!.body!, ts.isCallExpression) as ts.CallExpression[];
    const first = (name: string) => calls.find((c) => calleeName(c) === name);
    const upload = first("upload");
    const write = first("write");
    const sweep = first("sweepSupersededAvatars");
    expect(upload && write && sweep, "replaceAvatarObject must call upload, row.write and the sweep").toBeTruthy();
    expect(upload!.getEnd() < write!.getStart() && write!.getEnd() < sweep!.getStart(), "order must be upload → row.write → sweep").toBe(true);
    expect(ts.isAwaitExpression(write!.parent), "row.write must be awaited, or the sweep races the row").toBe(true);
    // `row.write` is outside any try: its failure must abort before the sweep.
    for (let p: ts.Node = write!; p !== fn; p = p.parent) {
      expect(ts.isTryStatement(p), "row.write sits inside a try — a swallowed row failure would still reach the sweep").toBe(false);
    }
  });

  it("A3. uploadProfileFiles gives its save callback only NULL or the row-writer's URL (what F1 trusts)", () => {
    const src = SOURCES.find((s) => s.file === "src/pages/completeProfile/uploadProfileFiles.ts");
    expect(src, "uploadProfileFiles.ts is missing").toBeTruthy();
    let fn: Fn | undefined;
    visitAll(src!, (n) => {
      if (ts.isVariableDeclaration(n) && n.name.getText() === "uploadProfileFiles" && n.initializer && isFn(n.initializer)) fn = n.initializer;
    });
    expect(fn, "uploadProfileFiles not found").toBeTruthy();
    const cb = fn!.parameters[3]?.name.getText();
    expect(cb, "uploadProfileFiles lost its save-callback parameter").toBeTruthy();
    const refs = collect(fn!.body!, (n) => ts.isIdentifier(n) && n.text === cb);
    const bad: string[] = [];
    for (const ref of refs) {
      const call = ref.parent;
      if (!ts.isCallExpression(call) || call.expression !== ref) {
        bad.push(`${where(src!, ref)} — the save callback escapes (${ref.parent.getText().slice(0, 50)})`);
        continue;
      }
      const arg = call.arguments[0];
      const prop = arg && ts.isObjectLiteralExpression(arg)
        ? arg.properties.find((p) => p.name && propName(p.name) === "avatarUrl")
        : undefined;
      const value = prop && ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
      if (!value) {
        bad.push(`${where(src!, call)} — calls the save callback without an explicit avatarUrl`);
        continue;
      }
      if (value.kind === ts.SyntaxKind.NullKeyword) continue;
      const writeFn = enclosingFn(call);
      const holder = writeFn?.parent;
      const obj = holder?.parent;
      const fromRowWriter =
        ts.isIdentifier(value) &&
        writeFn && bindsName(writeFn, value.text) &&
        holder && ts.isPropertyAssignment(holder) && propName(holder.name) === "write" &&
        obj && ts.isObjectLiteralExpression(obj) && obj.parent && ts.isCallExpression(obj.parent) && calleeName(obj.parent) === "replaceAvatarObject";
      if (!fromRowWriter) bad.push(`${where(src!, call)} — hands the save callback an avatarUrl that is not replaceAvatarObject's row-writer argument`);
    }
    expect(refs.length, "the save callback is never called").toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("B1. the superseded-avatar sweep only ever runs after the row write", () => {
    const calls: string[] = [];
    const bad: string[] = [];
    for (const src of SOURCES) {
      visitAll(src, (n) => {
        if (!ts.isCallExpression(n) || calleeName(n) !== "sweepSupersededAvatars") return;
        const f = enclosingFn(n);
        if (f && fnName(f) === "sweepSupersededAvatars") return;
        calls.push(where(src, n));
        if (!f || !positionOfRowWrite(f, n.getStart())) {
          bad.push(`${where(src, n)} — deletes the superseded avatar before this function has written profiles.avatar_url`);
        }
      });
    }
    expect(calls.length, "found no sweep call sites — the matcher is broken").toBeGreaterThanOrEqual(2);
    expect(bad, "a failed row write after these leaves the row on a deleted object").toEqual([]);
  });

  it("B2. nothing else deletes from the avatars bucket", () => {
    const removals = storageRemovals();
    if (process.env.AVATAR_AGREEMENT_DEBUG) {
      fs.appendFileSync(
        process.env.AVATAR_AGREEMENT_DEBUG,
        removals.map((r) => `${where(r.src, r.call)} removal bucket=${r.bucket ?? "<dynamic>"}`).join("\n") + "\n",
      );
    }
    expect(removals.length, "found no storage removals — the matcher is broken").toBeGreaterThan(3);
    const bad: string[] = [];
    const dynamicFiles = new Set<string>();
    for (const r of removals) {
      if (r.bucket !== null && r.bucket !== "avatars") continue;
      if (r.bucket === "avatars") {
        const f = enclosingFn(r.call);
        const name = f ? fnName(f) : "<top>";
        if (!AVATARS_REMOVERS[name]) bad.push(`${where(r.src, r.call)} — ${name}() deletes from the avatars bucket`);
        continue;
      }
      dynamicFiles.add(r.src.file);
      const entry = DYNAMIC_REMOVERS[r.src.file];
      if (!entry) {
        bad.push(`${where(r.src, r.call)} — deletes from a computed bucket that may be avatars; classify it in DYNAMIC_REMOVERS`);
        continue;
      }
      const problem = entry.check?.(r.src);
      if (problem) bad.push(`${where(r.src, r.call)} — ${problem}`);
    }
    for (const f of Object.keys(DYNAMIC_REMOVERS)) {
      if (!dynamicFiles.has(f)) bad.push(`${f} — listed in DYNAMIC_REMOVERS but no longer removes anything (stale entry)`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("C. no SQL function writes avatar_url to anything but NULL", () => {
    const fns = latestSqlFunctionBodies();
    expect(fns.size, "no SQL functions parsed — the matcher is broken").toBeGreaterThan(10);
    const bad: string[] = [];
    for (const [name, { file, body }] of fns) {
      // `SET … avatar_url = <expr>` (a comparison in WHERE/ON is not a write).
      const stripped = body.replace(/--[^\n]*/g, "");
      const re = /\bupdate\b[\s\S]*?\bset\b([\s\S]*?)(?:\bwhere\b|\breturning\b|;)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped))) {
        const set = m[1].match(/\bavatar_url\s*=\s*([^,\n]+)/i);
        if (set && !/^null\b/i.test(set[1].trim())) bad.push(`${file} ${name}(): SET avatar_url = ${set[1].trim()}`);
      }
      if (/insert\s+into\s+(?:public\.)?profiles\s*\([^)]*\bavatar_url\b/i.test(stripped)) {
        bad.push(`${file} ${name}(): INSERT INTO profiles (… avatar_url …)`);
      }
    }
    expect(bad).toEqual([]);
  });
});
