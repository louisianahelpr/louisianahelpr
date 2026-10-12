/**
 * Q1328: has_role, user_may_see_job_address and group_member_slot answered a
 * signed-in caller about ANY user id (a direct /rest/v1/rpc call: is this id
 * an admin, is this id hired on that job, what is this id's crew slot).
 * 20261012184600_scope_policy_helpers_to_caller makes each answer only about
 * the caller (plus a server context, and: has_role a trigger body or an admin
 * caller; group_member_slot the job's poster).
 *
 * Behaviour: src/test/pglite/policyHelpersScopedToCaller.pglite.mjs (prod's
 * code by md5; NEW_MIGRATION=skip: 5 FAILED, the three leaks; with the
 * migration applied 3x: ALL PASS).
 *
 * THE CLASS this file guards: a SQL caller that hands one of the three helpers
 * SOMEONE ELSE's id now silently gets false/NULL unless it sits in one of the
 * kept arms. Inventory, from source: every function's effective definition
 * after all migrations (effectiveDefs) and every policy that survives them
 * (the livePolicies rule), each call's user argument read. An argument is the caller's
 * own id when it is auth.uid() or a variable assigned from auth.uid() in the
 * same body, or NULL. Every other call must be in CROSS_USER below, with the
 * arm that keeps it answering; the list is exact (two-way), so a new caller
 * that asks about another person fails here until someone checks it still
 * works.
 *
 * @mutate supabase/migrations/20261012184600_scope_policy_helpers_to_caller.sql |        _user_id IS NOT DISTINCT FROM auth.uid()\n       OR public.is_server_context()\n       OR pg_trigger_depth() > 0 |        true
 * @mutate supabase/migrations/20261012184600_scope_policy_helpers_to_caller.sql |     AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context())\n | \n
 * @mutate supabase/migrations/20261012184600_scope_policy_helpers_to_caller.sql |       OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.customer_id = auth.uid())\n | \n
 * @mutate supabase/migrations/20261012184600_scope_policy_helpers_to_caller.sql |      AND EXISTS (SELECT 1 FROM public.user_roles r\n                  WHERE r.user_id = m.sender_id AND r.role = 'admin'::public.app_role) |      AND COALESCE(public.has_role(m.sender_id, 'admin'::public.app_role), false)
 * @mutate scripts/ci/definer-exec-allowlist.json |   "unscoped": {\n |   "unscoped": {\n    "has_role(uuid, app_role)": "reviewed 2026-10-05 (Q1284): policy helper used by every admin policy with auth.uid(); called directly it says whether an id is an admin.",\n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase/migrations");
const defs = effectiveDefs(MIG);
const files = migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

const HELPERS = { has_role: 0, user_may_see_job_address: 1, group_member_slot: 1 } as const;
type Helper = keyof typeof HELPERS;

/** Split the argument list that starts right after `(` at `open`, respecting nested parentheses. */
function argsAt(src: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/^public\./i, "");

/** Calls of the three helpers in `code`, each with its user argument. */
function calls(code: string): { helper: Helper; arg: string }[] {
  const out: { helper: Helper; arg: string }[] = [];
  for (const m of code.matchAll(/\b(has_role|user_may_see_job_address|group_member_slot)\s*\(/gi)) {
    const helper = m[1].toLowerCase() as Helper;
    const args = argsAt(code, m.index! + m[0].length);
    if (args.length < 2) continue; // a signature in GRANT/REVOKE/COMMENT text, not a call
    if (/^(uuid|_user_id\s+uuid|_job_id\s+uuid)$/i.test(args[0])) continue; // the CREATE FUNCTION header
    out.push({ helper, arg: norm(args[HELPERS[helper]]) });
  }
  return out;
}

/** True when `arg` is the caller: auth.uid() itself, NULL, or a variable assigned only from auth.uid() in `body`. */
function isCaller(arg: string, body: string): boolean {
  if (/auth\.uid\(\)/i.test(arg) || /^null$/i.test(arg)) return true;
  if (!/^\w+$/.test(arg)) return false;
  const assigns = [...body.matchAll(new RegExp(String.raw`\b${arg}\s+(?:uuid\s*)?:=\s*([^;]+);`, "gi"))].map((m) => m[1]);
  const intos = new RegExp(String.raw`\bINTO\s+(?:STRICT\s+)?${arg}\b`, "i").test(body);
  return assigns.length > 0 && !intos && assigns.every((a) => /^\(?\s*(SELECT\s+)?auth\.uid\(\)\s*\)?$/i.test(a.trim()));
}

/** Every call that hands a helper someone else's id, as `<where>: <helper>(<arg>)`. */
function crossUserCalls(): string[] {
  const out = new Set<string>();
  for (const [name, def] of defs) {
    if (name in HELPERS) continue;
    const body = blankSqlComments(def.stmt);
    for (const c of calls(body)) if (!isCaller(c.arg, body)) out.add(`fn ${name}: ${c.helper}(${c.arg})`);
  }
  for (const [key, text] of livePolicyTexts()) {
    for (const c of calls(text)) if (!isCaller(c.arg, "")) out.add(`policy ${key}: ${c.helper}(${c.arg})`);
  }
  return [...out].sort();
}

/**
 * Every policy that survives the migrations, as `<table>."<name>"` -> its text:
 * CREATE/DROP POLICY and DROP TABLE replayed in order (the livePolicies rule in
 * helpers/tablePrivilegeReplay.ts, for every table in one pass).
 */
function livePolicyTexts(): Map<string, string> {
  const live = new Map<string, string>();
  const NAME = String.raw`(?:"([^"]+)"|(\w+))`;
  const ON = String.raw`\s+on\s+(?:public\.)?"?(\w+)"?`;
  const dropPolicy = new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?${NAME}${ON}`, "gi");
  const createPolicy = new RegExp(String.raw`create\s+policy\s+${NAME}${ON}([^;]*);`, "gi");
  const dropTable = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;
  const key = (t: string, n: string) => `${t.toLowerCase()}."${n}"`;
  for (const f of files) {
    const sql = blankSqlComments(f.sql);
    const events: { at: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(dropPolicy)) events.push({ at: m.index!, apply: () => live.delete(key(m[3], m[1] ?? m[2].toLowerCase())) });
    for (const m of sql.matchAll(createPolicy)) events.push({ at: m.index!, apply: () => live.set(key(m[3], m[1] ?? m[2].toLowerCase()), m[4]) });
    for (const m of sql.matchAll(dropTable)) {
      const prefix = `${m[1].toLowerCase()}."`;
      events.push({ at: m.index!, apply: () => [...live.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => live.delete(k)) });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

/**
 * Every call that passes another person's id, and the arm of the scoped
 * helper that keeps it answering (read live 2026-10-12: every public function
 * body and every pg_policies row calling one of the three).
 */
const CROSS_USER: Record<string, string> = {
  "fn enforce_block_on_message_insert: has_role(NEW.receiver_id)": "trigger body: pg_trigger_depth() > 0",
  "fn enforce_block_on_message_insert: has_role(NEW.sender_id)": "trigger body; also the caller (the bypass requires NEW.sender_id = auth.uid())",
  "fn feature_enabled_for_user: has_role(p_user_id)": "EXECUTE is service_role only (edge functions pass their verified caller): is_server_context(); feature_enabled_for passes auth.uid(): the caller arm",
  "fn export_my_data: user_may_see_job_address(v_uid)": "EXECUTE is service_role only (v_uid := p_user_id): is_server_context()",
  "fn lift_ban_settlement_review: has_role(p_admin_id)": "EXECUTE is service_role only: is_server_context()",
  "fn rpc_poster_confirm_member_arrival: group_member_slot(_helper_id)": "the caller is the job's poster (checked first in the RPC): the poster arm",
  'policy reviews."Users can create reviews for eligible jobs": group_member_slot(reviews.reviewee_id)': "the same clause requires j.customer_id = auth.uid(): the poster arm",
};

describe("Q1328: the three policy helpers answer only about the caller", () => {
  it("reads a real corpus (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(900);
    expect(defs.size).toBeGreaterThan(500);
    const all = [...defs.values()].flatMap((d) => calls(blankSqlComments(d.stmt)));
    expect(all.length, "calls of the three helpers found in function bodies").toBeGreaterThan(40);
  });

  const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");

  it("has_role answers about another id only to a server, a trigger body or an admin", () => {
    const b = body("has_role");
    expect(b).toMatch(/_user_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+auth\.uid\(\)\s+OR\s+public\.is_server_context\(\)\s+OR\s+pg_trigger_depth\(\)\s*>\s*0\s+OR\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_roles\s+c\s+WHERE\s+c\.user_id\s*=\s*auth\.uid\(\)\s+AND\s+c\.role\s*=\s*'admin'/i);
  });

  it("user_may_see_job_address answers only about the caller or to a server", () => {
    expect(body("user_may_see_job_address")).toMatch(/AND\s+\(_user_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+auth\.uid\(\)\s+OR\s+public\.is_server_context\(\)\)/i);
  });

  it("group_member_slot answers only about the caller, to the job's poster or to a server", () => {
    expect(body("group_member_slot")).toMatch(
      /_user_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+auth\.uid\(\)\s+OR\s+public\.is_server_context\(\)\s+OR\s+EXISTS\s*\(SELECT\s+1\s+FROM\s+public\.jobs\s+j\s+WHERE\s+j\.id\s*=\s*_job_id\s+AND\s+j\.customer_id\s*=\s*auth\.uid\(\)\)/i,
    );
  });

  it("every call that hands a helper someone else's id is known and kept working (exact, two-way)", () => {
    expect(crossUserCalls()).toEqual(Object.keys(CROSS_USER).sort());
  });

  it("the detector is not vacuous: it flags send_team_reply's pre-fix shape and passes auth.uid()-derived ids", () => {
    const old = "DECLARE v_me uuid := auth.uid(); BEGIN SELECT 1 FROM m WHERE COALESCE(public.has_role(m.sender_id, 'admin'), false); END";
    expect(calls(old).filter((c) => !isCaller(c.arg, old))).toEqual([{ helper: "has_role", arg: "m.sender_id" }]);
    const own = "DECLARE v_uid uuid := auth.uid(); BEGIN IF public.has_role(v_uid, 'admin') THEN END IF; END";
    expect(calls(own).filter((c) => !isCaller(c.arg, own))).toEqual([]);
    const reassigned = "DECLARE v_uid uuid := auth.uid(); BEGIN SELECT x INTO v_uid FROM t; IF public.has_role(v_uid, 'admin') THEN END IF; END";
    expect(calls(reassigned).filter((c) => !isCaller(c.arg, reassigned)).length).toBe(1);
  });

  it('none of the three is still listed as "unscoped" in the definer allowlist', () => {
    const allow = JSON.parse(readFileSync(join(ROOT, "scripts/ci/definer-exec-allowlist.json"), "utf8")) as { unscoped: Record<string, string> };
    const still = Object.keys(allow.unscoped).filter((sig) => /^(has_role|user_may_see_job_address|group_member_slot)\(/.test(sig));
    expect(still).toEqual([]);
  });
});
