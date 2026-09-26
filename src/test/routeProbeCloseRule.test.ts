/**
 * Q94 (docs/OPEN.md): the user-error-screen close rule needs its SYNTHETIC
 * half. Owner spec (Q39): an item closes only when the screen went 24h without
 * a real person seeing it AND a synthetic check of that route passes.
 *
 *   - ops_alert_condition's NEWEST definition (any dollar tag, comments
 *     blanked) must, in the non-overflow 'user-error-screen' branch, stay
 *     failing unless public.ops_route_probe holds a pass for the item's screen
 *     (ops_route_key) newer than p_since (the item's last_seen);
 *   - that newest definition must equal the one before it EXCEPT that branch
 *     (restated from the newest body, only this change: no other branch lost);
 *   - the new objects are revoked FROM PUBLIC, anon (and authenticated);
 *   - press-every-control writes the passes, and only for screens whose rows
 *     were all clean (scripts/audit/pressRouteProbe.mjs).
 * Behaviour (3x apply, red without the migration): src/test/pglite/routeProbeCloseRule.pglite.mjs.
 *
 * Q298 (lh-authz-rls review of 8e686d57c), 20260926034740:
 *   - the newest ops_alert_condition returns true (still failing) for an item
 *     with no screen BEFORE the probe check: ops_route_key(null/'') is '/', so
 *     otherwise any clean press pass on / closed a screenless item;
 *   - it equals the definition before it except that one line;
 *   - the newest record_route_probe_passes refuses a call over its route cap and
 *     truncates each route before keying it, and equals the one before it otherwise;
 *   - both are revoked FROM PUBLIC, anon, authenticated again.
 *
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | AND p.passed_at > p_since); | AND p.passed_at > p_since - interval '100 years');
 * @mutate supabase/migrations/20260923182022_ops_route_probe_close_rule.sql | REVOKE ALL ON FUNCTION public.record_route_probe_passes(text[], text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.record_route_probe_passes(text[], text) FROM PUBLIC;
 * @mutate supabase/migrations/20260923182022_ops_route_probe_close_rule.sql | ELSIF p_source = 'seed-boundary-check-failed' THEN | ELSIF p_source = 'seed-boundary-check-failed-x' THEN
 * @mutate scripts/audit/pressRouteProbe.mjs | if (r.status === "ok" && !(r.failed > 0)) v.clean++; | v.clean++;
 * @mutate scripts/audit/press-every-control.mjs | const probePasses = routeProbePasses(results); | const probePasses = [];
 * @mutate supabase/migrations/20260926040011_ops_alert_pending_watchdog.sql | IF nullif(p_sample_ref ->> 'screen', '') IS NULL THEN RETURN true; END IF; | IF false THEN RETURN true; END IF;
 * @mutate supabase/migrations/20260926034740_route_probe_close_rule_hardening.sql | IF cardinality(p_routes) > 1000 THEN | IF cardinality(p_routes) > 100000 THEN
 * @mutate supabase/migrations/20260926034740_route_probe_close_rule_hardening.sql | public.ops_route_key(left(r, 512)) | public.ops_route_key(r)
 * @mutate supabase/migrations/20260926034740_route_probe_close_rule_hardening.sql | FUNCTION public.record_route_probe_passes(text[], text) FROM PUBLIC, anon, authenticated; | FUNCTION public.record_route_probe_passes(text[], text) FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments, blankComments } from "./helpers/blankNonCode";
import { routeProbePasses, recordRouteProbePasses, screenOf } from "../../scripts/audit/pressRouteProbe.mjs";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();

/** Every definition of public.<name>, in apply order, any dollar-quote tag, comments blanked. */
function definitions(name: string): Array<{ file: string; body: string }> {
  const out: Array<{ file: string; body: string }> = [];
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`, "gi");
  for (const file of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_]*\$)/);
      if (!tag) continue;
      const open = rest.indexOf(tag[1], tag.index!) + tag[1].length;
      out.push({ file, body: rest.slice(open, rest.indexOf(tag[1], open)) });
    }
  }
  return out;
}
const ws = (s: string) => s.replace(/\s+/g, " ").trim();
/** The non-overflow tail of the user-error-screen branch: from the title_norm guard to END IF. */
const tailOf = (b: string) => {
  const branch = b.slice(b.indexOf("ELSIF p_source = 'user-error-screen' THEN"));
  const from = branch.indexOf("IF p_sample_ref ->> 'title_norm' IS NULL THEN RETURN NULL; END IF;");
  return from < 0 ? "" : branch.slice(from, branch.indexOf("END IF; RETURN NULL; END;", from));
};

describe("Q94: the user-error-screen close rule requires a synthetic pass", () => {
  const defs = definitions("ops_alert_condition");
  const newest = defs[defs.length - 1];
  // The restatement check is about Q94's own migration, not whatever restates
  // ops_alert_condition later (Q287 did); the tail check stays on the newest.
  const Q94_FILE = "20260923182022_ops_route_probe_close_rule.sql";
  const q94Idx = defs.findIndex((d) => d.file === Q94_FILE);
  const q94 = defs[q94Idx];
  const prior = q94Idx > 0 ? defs[q94Idx - 1] : undefined;
  const b = ws(newest?.body ?? "");

  it("reads a real history (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(defs.length).toBeGreaterThan(5);
  });

  it("the newest branch stays failing without a probe pass after last_seen for the item's screen", () => {
    const t = ws(tailOf(b));
    expect(t, `${newest?.file}: user-error-screen tail not found`).not.toBe("");
    expect(t).toMatch(/IF EXISTS \( SELECT 1 FROM public\.error_logs e WHERE e\.created_at > now\(\) - interval '24 hours'[^]*?\) THEN RETURN true; END IF;/);
    expect(t).toContain(
      "RETURN NOT EXISTS ( SELECT 1 FROM public.ops_route_probe p WHERE p.route = public.ops_route_key(p_sample_ref ->> 'screen') AND p.passed_at > p_since);",
    );
  });

  it("restated from the NEWEST prior body: everything outside that tail is unchanged", () => {
    expect(prior, "a prior definition exists").toBeTruthy();
    const pb = ws(prior!.body);
    const strip = (s: string) => s.replace(tailOf(s) ? ws(tailOf(s)) : "\u0000", "<TAIL>");
    expect(q94, `${Q94_FILE} defines ops_alert_condition`).toBeTruthy();
    expect(strip(ws(q94!.body)), `${q94?.file} vs ${prior?.file}`).toBe(strip(pb));
  });

  it("new objects are revoked FROM PUBLIC, anon, authenticated; service_role only", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, Q94_FILE), "utf8"));
    for (const obj of [
      "TABLE public.ops_route_probe",
      "FUNCTION public.ops_route_key(text)",
      "FUNCTION public.record_route_probe_passes(text[], text)",
      "FUNCTION public.ops_alert_condition(text, jsonb, timestamptz, boolean)",
    ]) {
      expect(sql, obj).toContain(`REVOKE ALL ON ${obj} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).toContain("ALTER TABLE public.ops_route_probe ENABLE ROW LEVEL SECURITY;");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ops_route_probe/);
  });
});

describe("Q94: the press run writes a pass only for screens it walked cleanly", () => {
  it("a screen passes only with a clean measured row and no dirty one", () => {
    const passes = routeProbePasses([
      { route: "/jobs/abc", status: "ok", failed: 0 },
      { route: "/jobs/abc", status: "redirect" },
      { route: "/profile?tab=earnings", status: "ok", failed: 0 },
      { route: "/profile?tab=availability", status: "ok", failed: 1 },
      { route: "/admin?view=jobs", status: "ok", failed: 0 },
      { route: "/admin?view=stalled", status: "not-reached" },
      { route: "/help", status: "error-on-load", failed: 1 },
      { route: "/signup", status: "session-lost" },
      { route: "/login", status: "uncovered" },
      { route: "/home", status: "harness-error", failed: 1 },
      { route: "/", status: "ok", failed: 0 },
    ]);
    expect(passes).toEqual(["/", "/jobs/abc"]);
    expect(screenOf("/profile?tab=x#y")).toBe("/profile");
  });

  it("writes through the service-role RPC, and says so when it cannot", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200, text: async () => "", json: async () => 2 };
    };
    const env = () => "VITE_SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\n";
    const saved = { u: process.env.VITE_SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY, s: process.env.SUPABASE_URL };
    delete process.env.VITE_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_URL;
    try {
      const ok = await recordRouteProbePasses(["/", "/jobs/abc"], "run-1", { fetchImpl, readEnvFile: env });
      expect(ok).toEqual({ ok: true, recorded: 2 });
      expect(calls[0].url).toBe("https://x.supabase.co/rest/v1/rpc/record_route_probe_passes");
      expect(JSON.parse(calls[0].body)).toEqual({ p_routes: ["/", "/jobs/abc"], p_run_ref: "run-1" });
      const no = await recordRouteProbePasses(["/"], "run-1", { fetchImpl, readEnvFile: () => "" });
      expect(no.ok).toBe(false);
      const bad = await recordRouteProbePasses(["/"], "r", {
        fetchImpl: async () => ({ ok: false, status: 404, text: async () => "PGRST202", json: async () => null }),
        readEnvFile: env,
      });
      expect(bad).toMatchObject({ ok: false, recorded: 0 });
    } finally {
      if (saved.u !== undefined) process.env.VITE_SUPABASE_URL = saved.u;
      if (saved.k !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k;
      if (saved.s !== undefined) process.env.SUPABASE_URL = saved.s;
    }
  });

  it("press-every-control records them at the end of every shard", () => {
    const press = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(press).toContain("const probePasses = routeProbePasses(results);");
    expect(press).toMatch(/const probe = await recordRouteProbePasses\(probePasses, RUN_ID,/);
  });
});

describe("Q298: the route-probe close rule is hardened", () => {
  const Q298_FILE = "20260926034740_route_probe_close_rule_hardening.sql";
  const EARLY = "IF nullif(p_sample_ref ->> 'screen', '') IS NULL THEN RETURN true; END IF;";
  const PROBE = "RETURN NOT EXISTS ( SELECT 1 FROM public.ops_route_probe p";
  const BOUND = / IF cardinality\(p_routes\) > 1000 THEN RAISE EXCEPTION '[^']*', cardinality\(p_routes\) USING ERRCODE = '22023'; END IF;/;

  const conds = definitions("ops_alert_condition");
  const cond = conds[conds.length - 1];
  const writers = definitions("record_route_probe_passes");
  const writer = writers[writers.length - 1];
  /** Q298's own definition of `defs` and the one before it (restatement checks read Q298 by name). */
  const ownAndPrior = (defs: Array<{ file: string; body: string }>) => {
    const idx = defs.findIndex((d) => d.file === Q298_FILE);
    return { own: defs[idx], prior: idx > 0 ? defs[idx - 1] : undefined };
  };

  it("reads a real history (floor)", () => {
    expect(conds.length).toBeGreaterThan(6);
    expect(writers.length).toBeGreaterThan(1);
    expect(cond.file >= Q298_FILE, cond.file).toBe(true);
    expect(writer.file >= Q298_FILE, writer.file).toBe(true);
  });

  it("the newest ops_alert_condition keeps a screenless item failing before it asks the probe", () => {
    const t = ws(tailOf(ws(cond.body)));
    expect(t, `${cond.file}: user-error-screen tail not found`).not.toBe("");
    const early = t.indexOf(EARLY);
    expect(early, `${cond.file}: the screenless early return`).toBeGreaterThan(-1);
    expect(t.indexOf(PROBE), `${cond.file}: the probe check comes after it`).toBeGreaterThan(early);
  });

  it("Q298's ops_alert_condition is its predecessor plus only that line", () => {
    const { own, prior } = ownAndPrior(conds);
    expect(own, `${Q298_FILE} defines ops_alert_condition`).toBeTruthy();
    expect(prior, "a prior definition exists").toBeTruthy();
    expect(ws(own!.body).replace(` ${EARLY}`, ""), `${Q298_FILE} vs ${prior!.file}`).toBe(ws(prior!.body));
  });

  it("the newest record_route_probe_passes bounds its input", () => {
    const w = ws(writer.body);
    expect(w).toMatch(BOUND);
    expect(w).toContain("SELECT DISTINCT public.ops_route_key(left(r, 512)), now(), left(p_run_ref, 200)");
    expect(w).not.toContain("ops_route_key(r)");
  });

  it("Q298's record_route_probe_passes is its predecessor plus only the bounds", () => {
    const { own, prior } = ownAndPrior(writers);
    expect(own, `${Q298_FILE} defines record_route_probe_passes`).toBeTruthy();
    expect(prior, "a prior definition exists").toBeTruthy();
    const unbound = ws(own!.body).replace(BOUND, "").replace("ops_route_key(left(r, 512))", "ops_route_key(r)");
    expect(unbound, `${Q298_FILE} vs ${prior!.file}`).toBe(ws(prior!.body));
  });

  it("both restated functions are revoked FROM PUBLIC, anon, authenticated; service_role only", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, Q298_FILE), "utf8"));
    for (const fn of [
      "public.record_route_probe_passes(text[], text)",
      "public.ops_alert_condition(text, jsonb, timestamptz, boolean)",
    ]) {
      expect(sql, fn).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated;`);
      expect(sql, fn).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`);
    }
  });
});
