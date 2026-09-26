/**
 * GUARD (Q290): "Download My Data" covers every table that holds a person.
 *
 * Derived from the schema, not from a hand list: every public column that
 * references a person (by name in the generated types, or by a migration's
 * foreign key to auth.users / profiles) must be either a column the NEWEST
 * export_my_data() scopes rows by, or a reasoned EXEMPT entry. Two-way: an
 * entry naming a table or column the schema no longer has as a person column
 * fails too, so the lists cannot go stale. Also checks that every section is
 * filtered to the caller (no unscoped read), that the columns the inventory
 * says are stripped really are, that anon cannot execute it, and that the
 * client, the edge function and the privacy journey all agree on the sections.
 *
 * Q408: the function carries its own per-user limiter (a direct PostgREST call
 * skips the edge function's), behind a per-user transaction lock so parallel
 * calls cannot each miss the others' uncommitted hits; it is VOLATILE and
 * refuses with P0429, which the edge function maps to a 429. Q409: every row matched by ADDRESS alone is
 * bounded to the account's lifetime (created_at >= v_since) or, for a gift, to
 * one nobody has claimed, so a previous holder of the address is not exported.
 *
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql |   v_out := v_out \|\| jsonb_build_object('thread_pins', | v_out := v_out; PERFORM ('thread_pins',
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql |         OR (t.reviewee_id = v_uid AND t.status = 'published' |         OR (t.reviewee_id = v_uid AND true
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid) | CASE WHEN true
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | to_jsonb(t) - 'flag_reason' | to_jsonb(t)
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql |       WHERE t.user_id = v_uid));\n  v_out := v_out \|\| jsonb_build_object('nps_responses' |       WHERE true));\n  v_out := v_out \|\| jsonb_build_object('nps_responses'
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC, anon; | GRANT EXECUTE ON FUNCTION public.export_my_data() TO anon;
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql |   v_rl := public.rate_limit_hit('export_my_data_rpc', v_uid::text, NULL, 600, 5, 5); |   v_rl := jsonb_build_object('allowed', true);
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql |   PERFORM pg_advisory_xact_lock(hashtextextended('export_my_data_rpc:' \|\| v_uid::text, 0)); |   PERFORM 1;
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | LANGUAGE plpgsql\n VOLATILE | LANGUAGE plpgsql\n STABLE
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | WHERE lower(t.email) = v_email AND t.created_at >= v_since | WHERE lower(t.email) = v_email
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | OR (t.recipient_id IS NULL AND lower(t.recipient_email) = v_email) | OR lower(t.recipient_email) = v_email
 * @mutate supabase/migrations/20260926041143_export_my_data_rate_limit_and_email_scope.sql | OR (t.user_id IS NULL AND lower(t.recipient_email) = v_email AND t.created_at >= v_since) | OR lower(t.recipient_email) = v_email
 * @mutate supabase/functions/export-my-data/index.ts |     if (rpcError?.code === "P0429") return rateLimitResponse(600, corsHeaders); |     void rateLimitResponse;
 * @mutate src/test/helpers/dataExportInventory.ts |   "profiles.email": { reason: | "profiles.no_such_column": { reason:
 * @mutate src/test/helpers/dataExportInventory.ts |   "fraud_flags.user_id": { reason: | "fraud_flagz.user_id": { reason:
 * @mutate supabase/functions/export-my-data/index.ts |       storage_objects: storageObjects, |       files: storageObjects,
 * @mutate scripts/lib/privacyJourney.mjs | KNOWN_NOT_EXPORTED = []; | KNOWN_NOT_EXPORTED = ["reports"];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { anonExecuteRevoked, latestFunctionDefs } from "./helpers/rpcErrorInventory";
import {
  EXEMPT,
  EXPORTED,
  exportSections,
  publicTables,
  userKeyedColumns,
} from "./helpers/dataExportInventory";
import { EXPORT_SECTIONS, KNOWN_NOT_EXPORTED } from "../../scripts/lib/privacyJourney.mjs";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const tables = publicTables();
const userCols = userKeyedColumns(tables);
const defs = latestFunctionDefs(MIGRATIONS);
const body = defs.get("export_my_data")?.body ?? "";
const sections = exportSections(body);
const sectionOf = (table: string) => EXPORTED[table]?.section ?? table;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("export_my_data covers every user-keyed table (Q290)", () => {
  it("the schema inventory is real (floors)", () => {
    expect(tables.size).toBeGreaterThan(80);
    expect(userCols.size).toBeGreaterThan(100);
    expect(sections.length).toBeGreaterThan(55);
  });

  it("every person column is exported-by or exempt", () => {
    const uncovered = [...userCols]
      .filter((k) => {
        const [t, c] = k.split(".");
        return !EXPORTED[t]?.by.includes(c) && !EXEMPT[k];
      })
      .sort();
    expect(uncovered, "add each to EXPORTED (and export_my_data) or EXEMPT with a reason").toEqual([]);
  });

  it("no stale entry: every EXPORTED/EXEMPT column is a live person column", () => {
    const stale: string[] = [];
    for (const [t, { by }] of Object.entries(EXPORTED)) {
      if (!tables.has(t)) stale.push(`${t} (table gone)`);
      for (const c of by) if (!userCols.has(`${t}.${c}`)) stale.push(`${t}.${c}`);
    }
    for (const k of Object.keys(EXEMPT)) if (!userCols.has(k)) stale.push(k);
    expect(stale.sort()).toEqual([]);
  });

  it("no column is both exported-by and exempt", () => {
    const both = Object.keys(EXEMPT).filter((k) => {
      const [t, c] = k.split(".");
      return EXPORTED[t]?.by.includes(c);
    });
    expect(both).toEqual([]);
  });

  it("the NEWEST export_my_data has exactly one section per EXPORTED table, scoped by each column", () => {
    expect(body, "export_my_data() not found in the migrations").not.toBe("");
    const names = sections.map((s) => s.name).sort();
    expect(names).toEqual(Object.keys(EXPORTED).map(sectionOf).sort());
    const missing: string[] = [];
    for (const [t, { by }] of Object.entries(EXPORTED)) {
      const s = sections.find((x) => x.name === sectionOf(t));
      if (!s || s.table !== t) {
        missing.push(`${sectionOf(t)} reads public.${s?.table}, not public.${t}`);
        continue;
      }
      for (const c of by) {
        const re = new RegExp(`(?:lower\\()?\\bt\\.${c}\\)?\\s*=\\s*v_(?:uid|email)\\b`);
        if (!re.test(s.text)) missing.push(`${t}.${c}`);
      }
    }
    expect(missing, "export_my_data does not filter these by the caller").toEqual([]);
  });

  it("every section is filtered to the caller: its WHERE compares only to v_uid / v_email", () => {
    const unscoped = sections.filter((s) => {
      const where = s.text.slice(s.text.search(/\bWHERE\b/i));
      if (!/\bWHERE\b/i.test(s.text)) return true;
      // Every top-level comparison in the WHERE is to the caller. Strip the
      // caller comparisons and the sub-selects that are themselves scoped;
      // whatever is left must not be a bare predicate.
      const residue = where
        .replace(/\(SELECT[^()]*WHERE[^()]*v_uid[^()]*\)/gi, "")
        .replace(/(?:lower\()?\bt\.\w+\)?\s*=\s*v_(?:uid|email)\b/g, "")
        .replace(/NOT coalesce\(t\.flagged_hidden, false\)/g, "")
        // Q409 narrowings: they only ever remove rows from an address match.
        .replace(/\bAND t\.created_at >= v_since\b/g, "")
        .replace(/\bt\.(?:user_id|recipient_id) IS NULL AND\b/g, "")
        .replace(/AND t\.status = 'published'\s+AND t\.feedback_visible_at IS NOT NULL AND t\.feedback_visible_at <= now\(\)/g, "")
        .replace(/\bt\.id IN\b|\bt\.job_id IN\b/g, "");
      return /\bt\.\w+|\btrue\b/i.test(residue.replace(/^WHERE/i, ""));
    });
    expect(unscoped.map((s) => s.name)).toEqual([]);
    expect(body).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(body).toMatch(/IF v_uid IS NULL THEN\s*RAISE EXCEPTION/);
  });

  it("columns the inventory says are stripped are removed from the rows", () => {
    const kept: string[] = [];
    for (const [k, v] of Object.entries(EXEMPT)) {
      if (!v.stripped) continue;
      const [t, c] = k.split(".");
      const s = sections.find((x) => x.table === t);
      if (!s || !new RegExp(`-\\s*'${esc(c)}'`).test(s.text)) kept.push(k);
    }
    expect(kept).toEqual([]);
    // Secrets and moderation internals the migration header promises to drop.
    for (const [t, c] of [["push_tokens", "token"], ["gift_cards", "claim_token"], ["messages", "flag_reason"], ["jobs", "offered_to_helper_id"]]) {
      expect(sections.find((x) => x.table === t)?.text, `${t}.${c} must be stripped`).toMatch(new RegExp(`-\\s*'${c}'`));
    }
  });

  it("never wider than the app's own SELECT rules (lh-authz-rls review)", () => {
    const flat = (name: string) => (sections.find((x) => x.name === name)?.text ?? "").replace(/\s+/g, " ");
    // A review ABOUT the caller only once published and past the double-blind
    // reveal ("Published reviews visible after reveal", 20260824210000).
    expect(flat("reviews")).toContain(
      "t.reviewer_id = v_uid OR (t.reviewee_id = v_uid AND t.status = 'published' AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())",
    );
    // A full jobs row only to the poster or whoever user_may_see_job_address
    // admits; every other tie gets the limited row.
    expect(flat("jobs")).toMatch(
      /CASE WHEN t\.customer_id = v_uid OR public\.user_may_see_job_address\(t\.id, v_uid\) THEN CASE .*? ELSE jsonb_build_object\( 'id', t\.id, .*'row_limited', true/,
    );
  });

  it("Q408: rate-limited per caller before any row is read, and the edge function says 429", () => {
    const flat = body.replace(/\s+/g, " ");
    const hit = flat.search(/v_rl := public\.rate_limit_hit\('export_my_data_rpc', v_uid::text, NULL, \d+, \d+, \d+\);/);
    expect(hit, "export_my_data must call rate_limit_hit keyed on v_uid").toBeGreaterThan(-1);
    // The hit is uncommitted for the whole export, so parallel calls cannot
    // see each other's; a per-user xact lock taken BEFORE the hit serialises
    // them (real-Postgres proof: 10 parallel calls, 10 pass without it, 5 with).
    const lock = flat.search(/PERFORM pg_advisory_xact_lock\(hashtextextended\('export_my_data_rpc:' \|\| v_uid::text, 0\)\);/);
    expect(lock, "a per-user pg_advisory_xact_lock must precede the rate_limit_hit").toBeGreaterThan(-1);
    expect(lock).toBeLessThan(hit);
    const refuse = flat.search(/IF NOT coalesce\(\(v_rl->>'allowed'\)::boolean, false\) THEN RAISE EXCEPTION '\w+' USING ERRCODE = 'P0429'/);
    expect(refuse, "a refused hit must raise P0429 (fail closed on a missing 'allowed')").toBeGreaterThan(hit);
    expect(refuse).toBeLessThan(flat.indexOf("v_out := v_out ||"));
    // Recording a hit is a write: a STABLE function could not.
    const file = read(`supabase/migrations/${defs.get("export_my_data")?.file}`);
    const header = /CREATE OR REPLACE FUNCTION public\.export_my_data\(\)([\s\S]*?)\bAS \$/.exec(file)?.[1] ?? "";
    expect(header).toMatch(/\bVOLATILE\b/);
    const fn = blankComments(read("supabase/functions/export-my-data/index.ts"));
    expect(fn).toMatch(/if \(rpcError\?\.code === "P0429"\) return rateLimitResponse\(/);
  });

  it("Q409: every match by address alone is bounded to this account", () => {
    const loose: string[] = [];
    for (const s of sections) {
      const flat = s.text.replace(/\s+/g, " ");
      for (const m of flat.matchAll(/(\(?)(?:t\.(\w+) IS NULL AND )?lower\(t\.(\w+)\) = v_email( AND t\.created_at >= v_since)?/g)) {
        const [, , nullCol, col, since] = m;
        // Bounded by the account's lifetime, or (a gift) to rows nobody claimed.
        const ok = Boolean(since) || (s.table === "gift_cards" && nullCol === "recipient_id");
        if (!ok) loose.push(`${s.name}: lower(t.${col}) = v_email`);
      }
    }
    expect(loose, "an address match without created_at >= v_since exports a previous holder's rows").toEqual([]);
    expect(body.replace(/\s+/g, " ")).toMatch(/SELECT lower\(u\.email\), u\.created_at INTO v_email, v_since FROM auth\.users u WHERE u\.id = v_uid;/);
    // The floor: the four address-keyed sections exist and were inspected.
    const addressed = sections.filter((s) => /lower\(t\.\w+\) = v_email/.test(s.text)).map((s) => s.name).sort();
    expect(addressed).toEqual(["email_send_log", "gift_cards", "notification_logs", "suppressed_emails"]);
  });

  it("anon cannot execute it", () => {
    expect(anonExecuteRevoked("export_my_data", MIGRATIONS)).toBe(true);
  });

  it("every table purge_user_data touches that still exists is in the inventory", () => {
    const purge = defs.get("purge_user_data")?.body ?? "";
    const touched = new Set([...purge.matchAll(/\b(?:DELETE\s+FROM|UPDATE)\s+public\.(\w+)/gi)].map((m) => m[1]));
    expect(touched.size).toBeGreaterThan(20);
    const exemptTables = new Set(Object.keys(EXEMPT).map((k) => k.split(".")[0]));
    const missing = [...touched].filter((t) => tables.has(t) && !EXPORTED[t] && !exemptTables.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("the edge function, the card and the privacy journey agree on the sections", () => {
    const fn = blankComments(read("supabase/functions/export-my-data/index.ts"));
    expect(fn).toMatch(/\.rpc\("export_my_data"\)/);
    expect(fn).toMatch(/storage_objects: storageObjects,/);
    const card = blankComments(read("src/pages/info/legal/DataExportCard.tsx"));
    expect(card).toMatch(/functions\.invoke\("export-my-data"/);
    const head = /v_out\s*:=\s*jsonb_build_object\(([^;]*)\);/.exec(body)?.[1] ?? "";
    const headKeys = [...head.matchAll(/'(\w+)',/g)].map((m) => m[1]);
    expect(headKeys).toContain("exported_at");
    const expected = [...headKeys, ...sections.map((s) => s.name), "storage_objects"].sort();
    expect([...EXPORT_SECTIONS].sort()).toEqual(expected);
    expect(KNOWN_NOT_EXPORTED).toEqual([]);
  });
});
