/**
 * 2026-10-08, db-deploy red on main (run 37854554317): the migrations for the
 * job step order added two app-called SECURITY DEFINER functions,
 * ack_backout_notice(uuid) and nudge_confirm(uuid), granted to authenticated,
 * and neither was in scripts/ci/definer-exec-allowlist.json. The exact-set check
 * (scripts/check-live-privileges.mjs) only runs AFTER the push, against prod, so
 * main went red with the functions already live.
 *
 * The class, caught before merge: replay the migrations from SINCE on; every
 * SECURITY DEFINER function (not a trigger) whose final grant state leaves
 * authenticated able to EXECUTE it must have an allowlist entry. Older
 * functions stay with the live check (their revokes use forms this replay does
 * not parse).
 *
 * @mutate scripts/ci/definer-exec-allowlist.json |     "nudge_confirm(uuid)": "client",\n |
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SINCE = "20261008000000";
const dir = "supabase/migrations";
const strip = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (n: string) => n.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

function clientCallableNewDefiners(): string[] {
  const fns = new Map<string, { definer: boolean; trigger: boolean; auth: boolean }>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql") && x >= SINCE).sort()) {
    const s = strip(readFileSync(`${dir}/${f}`, "utf8"));
    const re =
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(([\s\S]*?)\)\s*RETURNS\s+([\s\S]*?)AS\s+(\$\w*\$)[\s\S]*?\4|REVOKE\s+[\s\S]*?ON\s+FUNCTION\s+([\w."]+)\s*\([^)]*\)\s+FROM\s+([^;]+);|GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\w."]+)\s*\([^)]*\)\s+TO\s+([^;]+);|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m[1]) {
        const n = norm(m[1]);
        const prev = fns.get(n);
        fns.set(n, {
          definer: /SECURITY\s+DEFINER/i.test(m[0]),
          trigger: /^\s*(trigger|event_trigger)\b/i.test(m[3]),
          // Prod's default privileges grant EXECUTE on a new function to authenticated.
          auth: prev ? prev.auth : true,
        });
      } else if (m[5]) {
        const e = fns.get(norm(m[5]));
        if (e && /\bauthenticated\b/i.test(m[6])) e.auth = false;
      } else if (m[7]) {
        const e = fns.get(norm(m[7]));
        if (e && /\bauthenticated\b/i.test(m[8])) e.auth = true;
      } else if (m[9]) fns.delete(norm(m[9]));
    }
  }
  return [...fns].filter(([, e]) => e.definer && !e.trigger && e.auth).map(([n]) => n).sort();
}

const allow = JSON.parse(readFileSync("scripts/ci/definer-exec-allowlist.json", "utf8")) as Record<string, Record<string, string>>;
const listed = new Set([...Object.keys(allow.authenticated), ...Object.keys(allow.unscoped ?? {})].map((k) => k.replace(/\(.*$/, "")));

describe("a new app-callable SECURITY DEFINER function is allowlisted before it ships", () => {
  it("finds the functions this window adds (inventory floor)", () => {
    expect(clientCallableNewDefiners()).toEqual(expect.arrayContaining(["ack_backout_notice", "nudge_confirm"]));
  });
  it("each has an entry in definer-exec-allowlist.json", () => {
    expect(clientCallableNewDefiners().filter((n) => !listed.has(n))).toEqual([]);
  });
});
