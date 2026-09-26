/**
 * CLASS GUARD (docs/OPEN.md Q355): every admin fan-out title has a close rule.
 *
 * THE BUG (2026-09-24). An operator notification to an admin with no push
 * token is mirrored to #ops-alerts (send-push-notification -> postSlackOpsAlert,
 * kind 'custom') and recorded in the ops alert ledger as 'ops-alert:custom'.
 * ops_alert_condition had no branch for it, so it got verify_kind
 * 'companions', and the companions rule excludes the post's own 'ops-alert'
 * error_logs rows: "Ban review needed" could never close (open 36h over an
 * empty ban-review queue). 20260925155922 gives each admin-queue title a
 * sql_condition that re-asks its queue.
 *
 * THE CLASS, from source, two-way:
 *   1. INVENTORY. Every notification addressed to an admin with an operator
 *      type (admin_alert / system_alert — the only types the mirror relays):
 *        SQL  — INSERT INTO notifications in the EFFECTIVE definition of every
 *               function (effectiveDefs), recipient ur.user_id from user_roles
 *               'admin', or an _admin loop variable;
 *        edge — the adminPushMirror.test.ts object-literal shape
 *               (user_id: adminId / admin.user_id / a.user_id), notifyUser(
 *               a.user_id, <title>, …, "admin_alert"), and remindAdmins(ids,
 *               <title>, …); a const title is resolved in its file or _shared.
 *   2. Each title starts with exactly one prefix: in the NEWEST
 *      admin_alert_close_rule() table (a condition re-asks it), or in the
 *      NEWEST admin_alert_manual_close() table (no table can answer; the
 *      ledger labels it 'manual' and a person closes it with evidence).
 *      Nothing is left on 'companions' (Q355 part 2, 20260926035647).
 *   3. Two-way: every prefix still matches a live title; every rule the table
 *      names has a branch in the newest admin_queue_still_pending(), and every
 *      branch is named by the table.
 *   4. The newest ops_alert_condition dispatches 'ops-alert:custom' through
 *      them, and the SQL reads the title/link out of the mirror's own
 *      oncePerDayKey (adminPushEventKey) — checked against the real function.
 * Behaviour (a ban-review item stays open while pending_ban_review, closes
 * once it leaves it; every other rule re-asks its queue) is proven in
 * src/test/pglite/adminQueueAlertsClose.pglite.mjs (ALL PASS on the fix; 44
 * FAIL with NEW_MIGRATION=skip); the part-2 rules (money held, arrival,
 * violation reviews, notices, manual) in
 * src/test/pglite/adminNoticeAlertsClose.pglite.mjs (70 PASS; 47 FAIL with
 * NEW_MIGRATION=skip; 6 planted defects each caught).
 *
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql | ('ban review needed', | ('ban review wanted',
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql |   ELSIF p_rule = 'stalled-job' THEN |   ELSIF p_rule = 'stalled-jobs' THEN
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql |       ('repeat offender: ', | 
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql |   ELSIF p_rule = 'notice' THEN |   ELSIF p_rule = 'notices' THEN
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql |         ('cancellation fee transfer failed', 'manual') |         ('cancellation fee transfer failure', 'manual')
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql | 'dismiss_message_ban_review') | 'dismiss_message_ban_reviewed')
 * @mutate supabase/migrations/20260926035647_admin_notice_alerts_close_themselves.sql |   AFTER INSERT ON public.notifications |   AFTER UPDATE ON public.notifications
 * @mutate supabase/migrations/20260926035556_cron_silent_close_rule.sql |   ELSIF p_source = 'ops-alert:custom' |   ELSIF p_source = 'ops-alert:customx'
 * @mutate supabase/functions/stripe-idv-webhook/index.ts | title: "Identity verification needs review", | title: "Identity check needs review",
 * @mutate supabase/migrations/20260923205635_notification_producers_carry_their_subject.sql |          'Low rating alert', |          'Low rating warning',
 * @mutate supabase/functions/_shared/alertPolicy.ts | return `admin-push:${ | return `admin-mirror:${
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { adminPushEventKey } from "../../supabase/functions/_shared/alertPolicy";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FUNCTIONS = join(ROOT, "supabase", "functions");
const OPERATOR = new Set(["admin_alert", "system_alert"]);


// ── small parsers ─────────────────────────────────────────────────────────
/** Split on top-level commas, respecting (), [], {} and quoted strings. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && !(s[j] === c && s[j - 1] !== "\\")) {
        if (c === "'" && s[j] === "'" && s[j + 1] === "'") j++; // SQL ''
        j++;
      }
      cur += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The balanced (...) group starting at `open` (index of "("). */
function group(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      const j = s.indexOf(c, i + 1);
      if (j === -1) break;
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return s.slice(open + 1, i);
  }
  return "";
}

/** Literal text a title expression can produce, up to its first placeholder. */
function titleTexts(expr: string, resolve: (id: string) => string | undefined): string[] | null {
  const lits = [...expr.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (lits.length) return lits.map((t) => t.replace(/\\'/g, "'").split(/%s|%|\$\{/)[0]);
  const id = expr.trim().match(/^[A-Za-z_]\w*$/)?.[0];
  if (!id) return null;
  const v = resolve(id);
  return v === undefined ? null : [v];
}

type FanOut = { site: string; title: string };

// ── 1. inventory: SQL ─────────────────────────────────────────────────────
function sqlFanOuts(): FanOut[] {
  const out: FanOut[] = [];
  for (const [name, def] of effectiveDefs(MIGRATIONS)) {
    const code = blankSqlComments(def.stmt);
    for (const m of code.matchAll(/insert\s+into\s+(?:public\.)?notifications\s*\(/gi)) {
      const open = m.index! + m[0].length - 1;
      const cols = splitTop(group(code, open)).map((c) => c.toLowerCase());
      const after = code.slice(open + group(code, open).length + 2);
      let exprs: string[];
      const values = after.match(/^\s*values\s*\(/i);
      if (values) exprs = splitTop(group(after, values[0].length - 1));
      else {
        const sel = after.match(/^\s*select\s+/i);
        if (!sel) continue;
        const body = after.slice(sel[0].length);
        // the select list ends at the first top-level FROM (or the statement end)
        let depth = 0;
        let end = body.length;
        for (let i = 0; i < body.length; i++) {
          if (body[i] === "(") depth++;
          else if (body[i] === ")") depth--;
          else if (body[i] === ";" && depth === 0) { end = i; break; }
          else if (depth === 0 && /^from\b/i.test(body.slice(i)) && /\s/.test(body[i - 1])) { end = i; break; }
        }
        exprs = splitTop(body.slice(0, end));
      }
      const at = (c: string) => exprs[cols.indexOf(c)] ?? "";
      const stmt = code.slice(m.index!, m.index! + 2000);
      const admin =
        (/^ur\.user_id$/i.test(at("user_id")) && /user_roles[\s\S]{0,400}'admin'/i.test(stmt.split(";")[0])) ||
        /^_admin\w*$/i.test(at("user_id"));
      const type = at("type").match(/^'(\w+)'/)?.[1] ?? "";
      if (!admin || !OPERATOR.has(type)) continue;
      const texts = titleTexts(at("title"), () => undefined);
      if (!texts) throw new Error(`unreadable SQL fan-out title in ${name}: ${at("title")}`);
      for (const t of texts) out.push({ site: `${def.file}:${name}`, title: t });
    }
  }
  return out;
}

// ── 1. inventory: edge ────────────────────────────────────────────────────
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}
const SHARED = walk(join(FUNCTIONS, "_shared")).map((f) => readFileSync(f, "utf8")).join("\n");
function constIn(src: string, id: string): string | undefined {
  return src.match(new RegExp(`\\bconst\\s+${id}\\s*=\\s*["'\`]([^"'\`]*)["'\`]`))?.[1];
}

// Titles passed through a helper the fan-out object only names by shorthand
// (`{ user_id: adminId, title, … }` inside remindAdmins): read at the call.
const HELPER_CALL = /\bremindAdmins\(\s*\w+,\s*/g;

function edgeFanOuts(): { found: FanOut[]; shorthand: string[] } {
  const found: FanOut[] = [];
  const shorthand: string[] = [];
  for (const f of walk(FUNCTIONS)) {
    const raw = readFileSync(f, "utf8");
    const src = blankComments(raw);
    const rel = relative(ROOT, f);
    const resolve = (id: string) => constIn(src, id) ?? constIn(SHARED, id);
    const push = (expr: string, where: string) => {
      const texts = titleTexts(expr, resolve);
      if (!texts) throw new Error(`unresolvable edge fan-out title at ${where}: ${expr}`);
      for (const t of texts) found.push({ site: where, title: t });
    };
    // (a) object literal addressed to an admin
    for (const m of src.matchAll(/user_id:\s*(?:adminId|admin\.user_id|a\.user_id)\b([\s\S]{0,900}?)\btype:\s*["'](\w+)["']/g)) {
      if (!OPERATOR.has(m[2])) continue;
      const span = m[1];
      const t = span.match(/\btitle:\s*/);
      if (!t) {
        if (/\btitle\s*,/.test(span)) shorthand.push(rel);
        continue;
      }
      const rest = span.slice(t.index! + t[0].length);
      push(splitTop(rest)[0], rel);
    }
    // (b) notifyUser(a.user_id, <title>, …, "admin_alert", …)
    for (const m of src.matchAll(/\bnotifyUser\(\s*a\.user_id\s*,/g)) {
      const args = splitTop(group(src, m.index! + "notifyUser".length));
      if (!args.some((a) => /^["']admin_alert["']$/.test(a))) continue;
      push(args[1], rel);
    }
    // (c) the helper a shorthand fan-out goes through
    for (const m of src.matchAll(HELPER_CALL)) {
      const args = splitTop(group(src, m.index! + "remindAdmins".length));
      push(args[1], rel);
    }
  }
  return { found, shorthand };
}

// ── 2. the rule table and its branches, newest definitions ────────────────
const defs = effectiveDefs(MIGRATIONS);
const ruleDef = defs.get("admin_alert_close_rule");
const pendingDef = defs.get("admin_queue_still_pending");
const condDef = defs.get("ops_alert_condition");
const RULES: { prefix: string; rule: string }[] = ruleDef
  ? [...blankSqlComments(ruleDef.stmt).matchAll(/\(\s*'([^']+)'\s*,\s*'([\w-]+)'\s*\)/g)].map((m) => ({ prefix: m[1], rule: m[2] }))
  : [];
// Branches: `p_rule = 'x'` and `p_rule IN ('x', 'y')`.
const BRANCHES = new Set<string>();
for (const m of blankSqlComments(pendingDef?.stmt ?? "").matchAll(/p_rule\s*(?:=\s*'([\w-]+)'|IN\s*\(([^)]*)\))/g)) {
  if (m[1]) BRANCHES.add(m[1]);
  else for (const x of m[2].matchAll(/'([\w-]+)'/g)) BRANCHES.add(x[1]);
}
const manualDef = defs.get("admin_alert_manual_close");
const MANUAL: string[] = manualDef
  ? [...blankSqlComments(manualDef.stmt).matchAll(/\(\s*'([^']+)'\s*,\s*'manual'\s*\)/g)].map((m) => m[1])
  : [];

const sql = sqlFanOuts();
const edge = edgeFanOuts();
const ALL = [...sql, ...edge.found].map((f) => ({ ...f, key: f.title.toLowerCase() }));

describe("every admin fan-out title has a close rule (Q355)", () => {
  it("found the fan-outs (inventory floor, 2026-09-25: 8 SQL titles, 19 edge titles)", () => {
    expect(sql.length).toBeGreaterThanOrEqual(8);
    expect(edge.found.length).toBeGreaterThanOrEqual(19);
    // The shorthand object literal is auto-resolve-disputes' remindAdmins;
    // its titles are read at the calls. Any other shorthand is unread: fail.
    expect(edge.shorthand).toEqual(["supabase/functions/auto-resolve-disputes/index.ts"]);
  });

  it("found the rule table and its branches", () => {
    expect(ruleDef?.file, "admin_alert_close_rule").toMatch(/admin_(queue|notice)_alerts_close_themselves/);
    // Floors, 2026-09-26: 19 rule rows, 13 branches, 1 manual row.
    expect(RULES.length).toBeGreaterThanOrEqual(19);
    expect(BRANCHES.size).toBeGreaterThanOrEqual(13);
    expect(MANUAL.length).toBeGreaterThanOrEqual(1);
  });

  it("prefixes are LIKE-safe and survive ops_alert_normalise unchanged", () => {
    // No digits (normalise turns them into '#'), no uppercase, no LIKE wildcards.
    const bad = [...RULES.map((r) => r.prefix), ...MANUAL].filter((p) => /[0-9A-Z%_@]/.test(p));
    expect(bad).toEqual([]);
  });

  it("each title has exactly one close rule, or is manual — never both, never neither", () => {
    const problems: string[] = [];
    for (const f of ALL) {
      const rules = RULES.filter((r) => f.key.startsWith(r.prefix));
      const manual = MANUAL.filter((p) => f.key.startsWith(p));
      if (rules.length + manual.length !== 1) {
        problems.push(`${f.site}: "${f.title}" rules=${rules.map((r) => r.prefix)} manual=${manual}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("two-way: no stale rule prefix, no stale manual prefix", () => {
    expect(RULES.filter((r) => !ALL.some((f) => f.key.startsWith(r.prefix))).map((r) => r.prefix), "stale rule").toEqual([]);
    expect(MANUAL.filter((p) => !ALL.some((f) => f.key.startsWith(p))), "stale manual").toEqual([]);
  });

  it("a manual title is labelled 'manual' when it reaches the ledger", () => {
    // The BEFORE INSERT trigger turns the default 'companions' into 'manual'.
    const trg = blankSqlComments(defs.get("ops_alert_ledger_admin_manual")?.stmt ?? "");
    expect(trg).toMatch(/admin_alert_manual_close\(/);
    expect(trg).toMatch(/NEW\.verify_kind\s*:=\s*'manual'/);
    const wired = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).some((f) =>
      /CREATE\s+TRIGGER\s+trg_ops_alert_ledger_admin_manual\s+BEFORE\s+INSERT\s+ON\s+public\.ops_alert_ledger[\s\S]{0,120}ops_alert_ledger_admin_manual\(\)/i
        .test(blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"))));
    expect(wired, "trigger created on ops_alert_ledger").toBe(true);
  });

  it("every rule the table names has a branch, and every branch is named", () => {
    const named = new Set(RULES.map((r) => r.rule));
    expect([...named].filter((r) => !BRANCHES.has(r)), "rule with no branch").toEqual([]);
    expect([...BRANCHES].filter((b) => !named.has(b)), "branch no title reaches").toEqual([]);
  });

  it("every moderation decision the review rules accept is an action the code writes", () => {
    // Two-way against source: a renamed action would silently make a review
    // rule unclosable (or, the other way, a guessed name would never match).
    const body = blankSqlComments(pendingDef?.stmt ?? "");
    // The review rules' list (the one naming set_ban_status; the IDV rule has its own).
    const list = [...body.matchAll(/a\.action\s+IN\s*\(([^)]*)\)/g)].map((m) => m[1]).find((l) => l.includes("'set_ban_status'")) ?? "";
    const actions = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(actions.length, "decision list, 2026-09-26: 11").toBeGreaterThanOrEqual(11);
    const walkCode = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walkCode(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
      });
    const code = [
      ...walkCode(join(ROOT, "src")).filter((f) => !f.includes(join("src", "test"))),
      ...walkCode(FUNCTIONS),
    ].map((f) => blankComments(readFileSync(f, "utf8"))).join("\n")
      + readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))
        .map((f) => blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"))).join("\n");
    const unwritten = actions.filter((a) => !new RegExp(`["'\`]${a}["'\`]`).test(code.replace(body, "")));
    expect(unwritten, "decision actions nothing writes").toEqual([]);
  });

  it("every admin operator notification is remembered as a subject", () => {
    const trg = blankSqlComments(defs.get("ops_alert_note_admin_subject")?.stmt ?? "");
    expect(trg).toMatch(/admin_alert_close_rule\(NEW\.title\)/);
    expect(trg).toMatch(/INSERT\s+INTO\s+public\.ops_alert_admin_subjects/);
    const wired = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).some((f) =>
      /CREATE\s+TRIGGER\s+trg_notifications_zz_admin_alert_subject\s+AFTER\s+INSERT\s+ON\s+public\.notifications[\s\S]{0,200}ops_alert_note_admin_subject\(\)/i
        .test(blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"))));
    expect(wired, "trigger created on notifications").toBe(true);
    // The subjects the rules read come from that table, not the bell rows.
    expect(blankSqlComments(defs.get("admin_alert_subjects")?.stmt ?? "")).toMatch(/FROM\s+public\.ops_alert_admin_subjects/);
  });

  it("the newest ops_alert_condition routes 'ops-alert:custom' through them", () => {
    const body = blankSqlComments(condDef?.stmt ?? "");
    const at = body.indexOf("p_source = 'ops-alert:custom'");
    expect(at, condDef?.file).toBeGreaterThan(0);
    const branch = body.slice(at, body.indexOf("ELSIF", at + 10) === -1 ? undefined : body.indexOf("ELSIF", at + 10));
    expect(branch).toMatch(/admin_alert_close_rule\(\s*public\.admin_alert_ref\(p_sample_ref\)/);
    expect(branch).toMatch(/admin_queue_still_pending\(/);
  });

  it("the SQL reads the mirror's real oncePerDayKey", () => {
    // The pattern admin_alert_ref() applies, taken from its newest definition.
    const refSql = defs.get("admin_alert_ref")?.stmt ?? "";
    const pat = refSql.match(/'\^admin-push:([^']+)'/)?.[0];
    expect(pat, "admin_alert_ref pattern").toBeTruthy();
    const re = new RegExp(pat!.slice(1, -1));
    const key = adminPushEventKey({
      title: "Ban review needed",
      link: "/admin?view=banreview&user=aaaaaaaa-0000-4000-8000-000000000001",
    });
    const m = re.exec(key);
    expect(m?.[1]).toBe("ban review needed");
    expect(m?.[2]).toBe("/admin?view=banreview&user=aaaaaaaa-0000-4000-8000-000000000001");
    // And the mirror still records that key under source ops-alert:custom.
    const push = blankComments(readFileSync(join(FUNCTIONS, "send-push-notification/index.ts"), "utf8"));
    expect(push).toMatch(/kind:\s*'custom',[\s\S]{0,400}oncePerDayKey:\s*adminPushEventKey\(payload\)/);
    const slack = blankComments(readFileSync(join(FUNCTIONS, "_shared/slack-alerts.ts"), "utf8"));
    expect(slack).toMatch(/source:\s*`ops-alert:\$\{input\.kind\}`[\s\S]{0,200}oncePerDayKey:\s*input\.oncePerDayKey/);
  });
});
