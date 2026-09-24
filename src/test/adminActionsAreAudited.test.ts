/**
 * CLASS CHECK (Q76) — every admin action writes an admin_audit_log row
 * (who, what, target, when, reason).
 *
 * The inventory is DERIVED from source, never typed here:
 *
 *   1. SQL. Every function whose NEWEST migration definition (any dollar-quote
 *      tag; a later DROP FUNCTION removes it) gates on
 *      `has_role(…, 'admin')` AND writes (INSERT / UPDATE … SET / DELETE) must
 *      insert into admin_audit_log in its own body.
 *   2. Edge functions. Every unit that verifies the caller is an admin
 *      (`.rpc("has_role", { _role: "admin" })`) must write admin_audit_log —
 *      directly, or through a helper whose body does (`writeAdminAudit`,
 *      `logAdminMoneyAction`). A unit is one `if (action === "…")` branch of an
 *      action-dispatch function (an admin branch of create-payment), or the
 *      whole function when it has no dispatch.
 *   3. Client. Every write the admin surface (`src/components/admin/**`,
 *      `src/pages/admin/Admin*.tsx`) makes — `.from(t).insert/update/upsert/delete`,
 *      `.rpc(n)` of a WRITING SQL function, `functions.invoke(f)` — is audited:
 *      either at the server (the RPC / edge unit from 1-2 writes the row) or by
 *      `logAdminAction(…)` in the same named handler.
 *
 * Exceptions are EXACT and two-way: an entry whose offender no longer exists
 * (or has become audited) fails the check just as a new offender does.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const FUNCTIONS = join(REPO, "supabase", "functions");

// ── 1. SQL ──────────────────────────────────────────────────────────────────

interface SqlFn { name: string; file: string; code: string }

/** Newest definition of every function, with DROP FUNCTION honoured, in apply order. */
function latestSqlFunctions(): Map<string, SqlFn> {
  const latest = new Map<string, SqlFn>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const events: Array<{ at: number; drop: boolean; name: string; code: string }> = [];
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      const start = m.index!;
      const tag = sql.slice(start).match(/\$(\w*)\$/)?.[0];
      if (!tag) continue;
      const bodyStart = sql.indexOf(tag, start) + tag.length;
      const bodyEnd = sql.indexOf(tag, bodyStart);
      if (bodyEnd < 0) continue;
      events.push({ at: start, drop: false, name: m[1].toLowerCase(), code: sql.slice(start, bodyEnd + tag.length) });
    }
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) {
      events.push({ at: m.index!, drop: true, name: m[1].toLowerCase(), code: "" });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.drop) latest.delete(e.name);
      else latest.set(e.name, { name: e.name, file, code: e.code });
    }
  }
  return latest;
}

const SQL_ADMIN_GATE = /\bhas_role\s*\(\s*[^,;]+?,\s*'admin'/i;
const SQL_WRITES = /\b(?:insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from)\b/i;
const SQL_AUDITS = /\binsert\s+into\s+(?:public\.)?admin_audit_log\b/i;

export function sqlWrites(fn: SqlFn): boolean {
  return SQL_WRITES.test(fn.code);
}
export function sqlIsAdminAction(fn: SqlFn): boolean {
  return SQL_ADMIN_GATE.test(fn.code) && sqlWrites(fn);
}
export function sqlAudits(fn: SqlFn): boolean {
  return SQL_AUDITS.test(fn.code);
}

/** Admin-gated writing functions that are not admin actions. Two-way. */
// @two-way src/test/adminActionsAreAudited.test.ts:stale SQL exemption
const SQL_EXEMPT: Readonly<Record<string, string>> = {
  prevent_self_escalation:
    "BEFORE trigger on user_roles that REFUSES a non-admin role write; the admin grant it lets through is audited by admin-user-actions grant_admin / audit_role_changes.",
};

// ── 2. Edge functions ───────────────────────────────────────────────────────

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

function unwrapExpr(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isTypeAssertionExpression(x)) {
    x = x.expression;
  }
  return x;
}

function calleeName(call: ts.CallExpression): string | null {
  const c = unwrapExpr(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

const firstStringArg = (call: ts.CallExpression): string | null => {
  const a = call.arguments[0];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
};

/** `x.rpc("has_role", { …, _role: "admin" })` */
function isAdminGate(n: ts.Node): boolean {
  if (!ts.isCallExpression(n) || calleeName(n) !== "rpc" || firstStringArg(n) !== "has_role") return false;
  const arg = n.arguments[1];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === "_role" && ts.isStringLiteralLike(p.initializer) && p.initializer.text === "admin",
  );
}

const containsNode = (root: ts.Node, pred: (n: ts.Node) => boolean): boolean => {
  let hit = false;
  walk(root, (n) => { if (!hit && pred(n)) hit = true; });
  return hit;
};

const hasAuditLiteral = (root: ts.Node) =>
  containsNode(root, (n) => ts.isStringLiteralLike(n) && n.text === "admin_audit_log");

/** Names of functions (in these files) whose own body names admin_audit_log. */
function auditWriterNames(sources: ts.SourceFile[]): Set<string> {
  const out = new Set<string>();
  for (const sf of sources) {
    walk(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body && hasAuditLiteral(n.body)) out.add(n.name.text);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && hasAuditLiteral(n.initializer)) {
        out.add(n.name.text);
      }
    });
  }
  return out;
}

/** `action === "a"` / `action === "a" || action === "b"` → ["a","b"], else null. */
function dispatchActions(cond: ts.Expression): string[] | null {
  const e = unwrapExpr(cond);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const l = dispatchActions(e.left);
    const r = dispatchActions(e.right);
    return l && r ? [...l, ...r] : null;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    const [a, b] = [unwrapExpr(e.left), unwrapExpr(e.right)];
    if (ts.isIdentifier(a) && a.text === "action" && ts.isStringLiteralLike(b)) return [b.text];
  }
  return null;
}

export interface EdgeUnit {
  /** `fn` or `fn#action`. */
  key: string;
  fn: string;
  action: string | null;
  admin: boolean;
  audited: boolean;
}

const listTs = (dir: string): string[] =>
  readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => join(dir, f));

export function edgeUnits(): EdgeUnit[] {
  const shared = listTs(join(FUNCTIONS, "_shared")).map((f) => parse(f, readFileSync(f, "utf8")));
  const sharedWriters = auditWriterNames(shared);
  const units: EdgeUnit[] = [];
  for (const fn of readdirSync(FUNCTIONS).sort()) {
    const dir = join(FUNCTIONS, fn);
    if (fn.startsWith("_") || !statSync(dir).isDirectory() || !existsSync(join(dir, "index.ts"))) continue;
    const files = listTs(dir).map((f) => parse(f, readFileSync(f, "utf8")));
    const writers = new Set([...sharedWriters, ...auditWriterNames(files)]);
    const audits = (root: ts.Node) =>
      hasAuditLiteral(root) ||
      containsNode(root, (n) => ts.isCallExpression(n) && writers.has(calleeName(n) ?? ""));
    const index = files.find((f) => f.fileName.endsWith(`${fn}/index.ts`))!;

    const branches: Array<{ actions: string[]; node: ts.IfStatement }> = [];
    walk(index, (n) => {
      if (ts.isIfStatement(n)) {
        const acts = dispatchActions(n.expression);
        if (acts) branches.push({ actions: acts, node: n });
      }
    });
    const gates: ts.Node[] = [];
    for (const f of files) walk(f, (n) => { if (isAdminGate(n)) gates.push(n); });
    if (gates.length === 0) continue;

    if (branches.length === 0) {
      units.push({ key: fn, fn, action: null, admin: true, audited: files.some(audits) });
      continue;
    }
    const inBranch = (g: ts.Node) =>
      g.getSourceFile() === index && branches.some((b) => g.pos >= b.node.pos && g.end <= b.node.end);
    const firstBranch = Math.min(...branches.map((b) => b.node.pos));
    // A gate outside every branch, ahead of the dispatch (or in another file of
    // the function), gates the whole dispatch.
    const gatesAll = gates.some((g) => !inBranch(g) && (g.getSourceFile() !== index || g.pos < firstBranch));
    for (const b of branches) {
      const admin = gatesAll || containsNode(b.node.thenStatement, isAdminGate);
      if (!admin) continue;
      for (const a of b.actions) {
        units.push({ key: `${fn}#${a}`, fn, action: a, admin, audited: audits(b.node.thenStatement) });
      }
    }
  }
  return units;
}

/** Admin-gated edge units that are not admin actions. Two-way. */
// @two-way src/test/adminActionsAreAudited.test.ts:stale edge exemption
const EDGE_EXEMPT: Readonly<Record<string, string>> = {
  "health-check": "Read-only: reports env/config health to an admin; changes nothing.",
  "create-notification":
    "Admin is one of several PERMISSION paths (self / job party / admin) for writing one notification row, which is itself the record; no admin tool calls it for a moderation action.",
  "send-account-status-email":
    "Sends the email that FOLLOWS an account-status change; the change itself (ban, warning, verify) is audited where the admin makes it.",
};

// ── 3. Client (admin surface) ───────────────────────────────────────────────

function adminClientFiles(): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  rec(join(REPO, "src", "components", "admin"));
  rec(join(REPO, "src", "pages", "admin"));
  return out.sort();
}

/** The innermost NAMED function around a node (anonymous callbacks are skipped). */
function namedHandler(n: ts.Node): { name: string; node: ts.Node } | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return { name: p.name.text, node: p };
    if (ts.isMethodDeclaration(p)) return { name: p.name.getText(), node: p };
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const par = p.parent;
      if (ts.isVariableDeclaration(par) && ts.isIdentifier(par.name)) return { name: par.name.text, node: p };
      if (ts.isPropertyAssignment(par)) return { name: par.name.getText(), node: p };
    }
  }
  return null;
}

/** The table a `.insert/.update/.upsert/.delete` call writes, when its chain starts at `.from("t")`. */
function writtenTable(call: ts.CallExpression): string | null {
  const c = unwrapExpr(call.expression);
  if (!ts.isPropertyAccessExpression(c) || !["insert", "update", "upsert", "delete"].includes(c.name.text)) return null;
  let x: ts.Expression = c.expression;
  for (;;) {
    x = unwrapExpr(x);
    if (ts.isCallExpression(x)) {
      if (calleeName(x) === "from" && firstStringArg(x)) return firstStringArg(x);
      x = x.expression;
    } else if (ts.isPropertyAccessExpression(x)) {
      x = x.expression;
    } else return null;
  }
}

/** `functions.invoke("f", { body: { action: "a" } })` → the action literal, if any. */
function invokeAction(call: ts.CallExpression): string | null {
  const opts = call.arguments[1];
  if (!opts || !ts.isObjectLiteralExpression(opts)) return null;
  const body = opts.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "body");
  if (!body || !ts.isPropertyAssignment(body) || !ts.isObjectLiteralExpression(body.initializer)) return null;
  const act = body.initializer.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "action");
  return act && ts.isPropertyAssignment(act) && ts.isStringLiteralLike(act.initializer) ? act.initializer.text : null;
}

export type ClientSite = {
  /** `<file>#<handler>#<kind>:<target>` */
  key: string;
  file: string;
  line: number;
  handler: string;
  kind: "table" | "rpc" | "invoke";
  target: string;
  /** "server" | "client" | null (unaudited) */
  auditedBy: "server" | "client" | null;
};

export function clientSites(sql: Map<string, SqlFn>, edge: EdgeUnit[]): { sites: ClientSite[]; unresolved: string[] } {
  const sites: ClientSite[] = [];
  const unresolved: string[] = [];
  const edgeByKey = new Map(edge.map((u) => [u.key, u]));
  for (const abs of adminClientFiles()) {
    const file = relative(REPO, abs);
    const sf = parse(abs, readFileSync(abs, "utf8"));
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      let kind: ClientSite["kind"] | null = null;
      let target: string | null = null;
      let server = false;
      const table = writtenTable(n);
      const name = calleeName(n);
      if (table) {
        kind = "table";
        target = table;
      } else if (name === "rpc" && firstStringArg(n)) {
        const fn = sql.get(firstStringArg(n)!.toLowerCase());
        if (!fn) { unresolved.push(`${file}: rpc("${firstStringArg(n)}") has no migration definition`); return; }
        if (!sqlWrites(fn)) return; // a read, not an action
        kind = "rpc";
        target = fn.name;
        server = sqlAudits(fn);
      } else if (name === "invoke" && firstStringArg(n)) {
        const fn = firstStringArg(n)!;
        const act = invokeAction(n);
        kind = "invoke";
        target = act ? `${fn}#${act}` : fn;
        const unit = edgeByKey.get(target) ?? edgeByKey.get(fn);
        // A non-literal action can be ANY branch: audited only when every
        // admin branch of that function is.
        const branches = edge.filter((u) => u.fn === fn && u.action !== null);
        server = unit ? unit.audited : !act && branches.length > 0 && branches.every((u) => u.audited);
      }
      if (!kind || !target) return;
      const h = namedHandler(n);
      const handler = h?.name ?? "<module>";
      const client = !!h && containsNode(h.node, (x) => ts.isCallExpression(x) && calleeName(x) === "logAdminAction");
      sites.push({
        key: `${file}#${handler}#${kind}:${target}`,
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        handler,
        kind,
        target,
        auditedBy: server ? "server" : client ? "client" : null,
      });
    });
  }
  return { sites, unresolved };
}

/** Admin-surface writes that are not admin actions. Two-way. */
// @two-way src/test/adminActionsAreAudited.test.ts:stale client exemption
const CLIENT_EXEMPT: Readonly<Record<string, string>> = {
  "src/components/admin/AdminNotifications.tsx#loadPrefs#table:notification_preferences":
    "Creates the signed-in admin's OWN default notification-preferences row; a self-service setting, not an action on anyone.",
  "src/components/admin/AdminNotifications.tsx#updatePref#table:notification_preferences":
    "The admin's OWN notification preference toggle; a self-service setting, not an action on anyone.",
  "src/components/admin/AdminNotifications.tsx#setMaster#table:notification_preferences":
    "The admin's OWN master notification switch; a self-service setting, not an action on anyone.",
  "src/components/admin/AdminJobs.tsx#notifyJobParty#table:notifications":
    "Shared notifier: tells a party about an admin action; each caller (handleDelete, handleStatusOverride) writes that action's audit row itself.",
  "src/components/admin/adminHealth/useConfigChecks.ts#fetcher#invoke:health-check":
    "Read-only health probe (health-check changes nothing).",
  "src/components/admin/adminHealth/useHealthData.ts#fetcher#invoke:health-check":
    "Read-only health probe (health-check changes nothing).",
};

// Each mutation removes ONE audit write this guard exists to require; each must turn it red.
// @mutate supabase/migrations/20260923162243_stalled_flag_resolve_writes_admin_audit.sql | INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details) | INSERT INTO public.some_other_log (admin_id, action, target_type, target_id, details)
// @mutate supabase/functions/release-payout/index.ts | await writeAdminAudit(supabaseAdmin, { | await notAnAuditWrite(supabaseAdmin, {
// @mutate supabase/functions/execute-dispute-split/index.ts | await writeAdminAudit(supabaseAdmin, { | await notAnAuditWrite(supabaseAdmin, {
// @mutate supabase/functions/_shared/adminAuditLog.ts | .from("admin_audit_log") | .from("admin_audit_logs")
// @mutate src/components/admin/adminusers/useAdminUserActions.ts | await logAdminAction("unban_user", | await Promise.resolve("unban_user",
// @mutate src/components/admin/AdminUserNotes.tsx | await logAdminAction("admin_note_delete", | await Promise.resolve("admin_note_delete",
// @mutate src/components/admin/AdminJobs.tsx | await logAdminAction("remove_job", | await Promise.resolve("remove_job",
// @mutate src/components/admin/marketing/marketingApi.ts | await logAdminAction("marketing_post_delete", | await Promise.resolve("marketing_post_delete",

// ── the checks ──────────────────────────────────────────────────────────────

describe("every admin action writes an admin_audit_log row (Q76)", () => {
  const sql = latestSqlFunctions();
  const edge = edgeUnits();
  const { sites, unresolved } = clientSites(sql, edge);

  if (process.env.Q76_PRINT) {
    const adminSql = [...sql.values()].filter(sqlIsAdminAction);
    console.log(adminSql.map((f) => `sql\t${f.name}\t${f.file}\t${sqlAudits(f) ? "audited" : "-"}`).join("\n"));
    console.log(edge.map((u) => `edge\t${u.key}\t${u.audited ? "audited" : "-"}`).join("\n"));
    console.log(sites.map((s) => `client\t${s.key}\tL${s.line}\t${s.auditedBy ?? "-"}`).join("\n"));
  }

  it("the inventory is derived and non-trivial (a scan that finds nothing cannot fail)", () => {
    expect([...sql.values()].filter(sqlIsAdminAction).length).toBeGreaterThan(8);
    expect(edge.filter((u) => u.admin).length).toBeGreaterThan(15);
    expect(sites.length).toBeGreaterThan(60);
    expect(unresolved, "an admin-surface rpc() names a function no migration defines").toEqual([]);
  });

  it("the detectors fire on both sides", () => {
    const fn = (code: string): SqlFn => ({ name: "x", file: "x.sql", code: blankSqlComments(code) });
    expect(sqlIsAdminAction(fn("IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE; END IF; UPDATE public.t SET a = 1;"))).toBe(true);
    expect(sqlIsAdminAction(fn("IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE; END IF; SELECT 1;"))).toBe(false);
    expect(sqlAudits(fn("-- INSERT INTO public.admin_audit_log\nUPDATE t SET a = 1;"))).toBe(false);
    expect(sqlAudits(fn("INSERT INTO public.admin_audit_log (admin_id) VALUES (auth.uid());"))).toBe(true);
    // A DROP FUNCTION retires a definition (Q193 removed approve/deny that way).
    expect(sql.has("resolve_stalled_job_flag")).toBe(true);
  });

  it("every admin-gated SQL function that writes, writes admin_audit_log", () => {
    const missing = [...sql.values()]
      .filter((f) => sqlIsAdminAction(f) && !sqlAudits(f) && !(f.name in SQL_EXEMPT))
      .map((f) => `${f.name} (newest: ${f.file})`);
    expect(missing, "add an INSERT INTO public.admin_audit_log to the function (new migration)").toEqual([]);
  });

  it("stale SQL exemption entries fail (two-way)", () => {
    const stale = Object.keys(SQL_EXEMPT).filter((n) => {
      const f = sql.get(n);
      return !f || !sqlIsAdminAction(f) || sqlAudits(f);
    });
    expect(stale, "stale SQL exemption — remove it").toEqual([]);
  });

  it("every admin-gated edge-function unit writes admin_audit_log", () => {
    const missing = edge.filter((u) => u.admin && !u.audited && !(u.key in EDGE_EXEMPT)).map((u) => u.key);
    expect(missing, "write the row with writeAdminAudit (supabase/functions/_shared/adminAuditLog.ts)").toEqual([]);
  });

  it("stale edge exemption entries fail (two-way)", () => {
    const byKey = new Map(edge.map((u) => [u.key, u]));
    const stale = Object.keys(EDGE_EXEMPT).filter((k) => !byKey.get(k) || byKey.get(k)!.audited);
    expect(stale, "stale edge exemption — remove it").toEqual([]);
  });

  it("every write on the admin surface is audited at the server or by logAdminAction in its handler", () => {
    const missing = sites.filter((s) => s.auditedBy === null && !(s.key in CLIENT_EXEMPT)).map((s) => `${s.key} (L${s.line})`);
    expect(missing, "audit it at the server, or call logAdminAction(...) in the same handler").toEqual([]);
  });

  it("stale client exemption entries fail (two-way)", () => {
    const unaudited = new Set(sites.filter((s) => s.auditedBy === null).map((s) => s.key));
    const stale = Object.keys(CLIENT_EXEMPT).filter((k) => !unaudited.has(k));
    expect(stale, "stale client exemption — remove it").toEqual([]);
  });
});
