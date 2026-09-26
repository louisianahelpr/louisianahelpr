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
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql |   v_out := v_out \|\| jsonb_build_object('thread_pins', | v_out := v_out; PERFORM ('thread_pins',
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql |         OR (t.reviewee_id = v_uid AND t.status = 'published' |         OR (t.reviewee_id = v_uid AND true
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid) | CASE WHEN true
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | to_jsonb(t) - 'flag_reason' | to_jsonb(t)
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql |       WHERE t.user_id = v_uid));\n  v_out := v_out \|\| jsonb_build_object('nps_responses' |       WHERE true));\n  v_out := v_out \|\| jsonb_build_object('nps_responses'
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | AND t.user_id IS NULL AND t.created_at | AND t.created_at
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | = v_email AND t.recipient_id IS NULL) | = v_email)
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role, authenticated;
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | DROP FUNCTION IF EXISTS public.export_my_data(); | SELECT 1;
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql |       WHERE lower(t.email) = v_email AND t.created_at >= v_created)); |       WHERE lower(t.email) = v_email));
 * @mutate src/test/helpers/dataExportInventory.ts |   "profiles.email": { reason: | "profiles.no_such_column": { reason:
 * @mutate src/test/helpers/dataExportInventory.ts |   "retained_bans.email_sha256": { reason: | "retained_banz.email_sha256": { reason:
 * @mutate supabase/migrations/20260926180859_export_my_data_crew_fee_shares.sql | to_jsonb(t) - 'created_by' | to_jsonb(t)
 * @mutate supabase/functions/export-my-data/index.ts |       storage_objects: storageObjects, |       files: storageObjects,
 * @mutate scripts/lib/privacyJourney.mjs | KNOWN_NOT_EXPORTED = []; | KNOWN_NOT_EXPORTED = ["reports"];
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
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
        .replace(/AND t\.created_at >= v_created/g, "")
        .replace(/AND t\.(?:user_id|recipient_id) IS NULL/g, "")
        .replace(/AND t\.status = 'published'\s+AND t\.feedback_visible_at IS NOT NULL AND t\.feedback_visible_at <= now\(\)/g, "")
        .replace(/\bt\.id IN\b|\bt\.job_id IN\b/g, "");
      return /\bt\.\w+|\btrue\b/i.test(residue.replace(/^WHERE/i, ""));
    });
    expect(unscoped.map((s) => s.name)).toEqual([]);
    expect(body).toMatch(/v_uid\s+uuid\s*:=\s*p_user_id;/);
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

  it("Q408: only service_role can execute it, and the no-argument door is dropped", () => {
    const file = defs.get("export_my_data")?.file ?? "";
    const mig = blankSqlComments(read(`supabase/migrations/${file}`)).replace(/\s+/g, " ");
    expect(mig).toMatch(/DROP FUNCTION IF EXISTS public\.export_my_data\(\);/);
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;");
    // Nothing after it grants the function back to a signed-in or anonymous role.
    const later = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f > file);
    for (const f of later) {
      expect(blankSqlComments(read(`supabase/migrations/${f}`)), f).not.toMatch(/GRANT[^;]*export_my_data[^;]*\b(authenticated|anon|PUBLIC)\b/i);
    }
  });

  it("Q409: rows matched by email count only from this account's creation on (gift cards excepted)", () => {
    expect(body).toMatch(/SELECT lower\(u\.email\), u\.created_at INTO v_email, v_created FROM auth\.users u/);
    for (const name of ["email_send_log", "suppressed_emails", "notification_logs"]) {
      const text = (sections.find((x) => x.name === name)?.text ?? "").replace(/\s+/g, " ");
      expect(text, name).toMatch(/\(?lower\(t\.\w+\) = v_email (?:AND t\.user_id IS NULL )?AND t\.created_at >= v_created\)?/);
    }
    // A gift is sent to an address before its owner has an account.
    expect((sections.find((x) => x.name === "gift_cards")?.text ?? "")).not.toMatch(/v_created/);
    // An address match never exports a row another account owns (#1838 review).
    const flat = (name: string) => (sections.find((x) => x.name === name)?.text ?? "").replace(/\s+/g, " ");
    expect(flat("notification_logs")).toContain("(lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)");
    expect(flat("gift_cards")).toContain("(lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)");
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
    // Q408: the service-role client, with the id getUser() verified.
    expect(fn).toMatch(/await admin\.rpc\("export_my_data", \{ p_user_id: user\.id \}\)/);
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
