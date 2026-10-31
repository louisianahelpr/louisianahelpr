/**
 * Q2275 (board 91): saved searches for every section, an alert per channel and
 * "N new since you looked". Pins the newest migration text so a later
 * CREATE OR REPLACE cannot quietly drop a rule. Behaviour (3x replay, Declutter
 * "chair" -> "1 new", RLS, grants) is proven by
 * src/test/pglite/savedSearchesEverySection.pglite.mjs.
 *
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |       AND s.section = 'jobs'\n      AND p.email_verified | AND p.email_verified
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql | AND s.notify_email\n     AND (s.last_emailed_at | AND (s.last_emailed_at
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |   IF v_email_ids IS NOT NULL THEN\n  UPDATE |   IF true THEN\n  UPDATE
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |       AND public.feature_enabled_for_user('declutter', s.user_id)\n |
 * @mutate supabase/migrations/20261031224850_saved_search_price_drop_counts.sql |            AND NOT public.declutter_seller_hidden(i.seller_id)\n |
 * @mutate supabase/migrations/20261031222115_saved_search_keeps_declutter_filters.sql |       AND (NOT v_seller_seed OR COALESCE(p.is_seed, false))\n | 
 * @mutate supabase/migrations/20261030071817_declutter_search_words.sql | REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.saved_search_new_counts() FROM PUBLIC;
 * @mutate supabase/migrations/20261031224850_saved_search_price_drop_counts.sql |   WHERE s.user_id = (SELECT auth.uid());\n$function$; |   WHERE true;\n$function$;
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort();

/** The newest CREATE OR REPLACE FUNCTION public.<name>(, any dollar tag, comments blanked. */
function newestBody(name: string): { file: string; body: string } {
  let hit: { file: string; body: string } | null = null;
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$;`, "g");
  for (const f of FILES) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) hit = { file: f, body: m[0] };
  }
  if (!hit) throw new Error(`no migration defines ${name}`);
  return hit;
}

/** Every statement in the migrations (comments blanked), in replay order. */
const ALL = FILES.map((f) => blankSqlComments(readFileSync(resolve(DIR, f), "utf8"))).join("\n");

/** The newest policy text per (table, name), with DROPs honoured. */
function livePolicies(table: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(String.raw`(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?${table}\b([\s\S]*?);`, "gi");
  for (const m of ALL.matchAll(re)) {
    if (m[1].toUpperCase() === "DROP") out.delete(m[2]);
    else out.set(m[2], m[3]);
  }
  return out;
}

describe("saved searches for every section (Q2275)", () => {
  const notify = newestBody("notify_saved_searches_on_new_job");
  const deliver = newestBody("deliver_saved_search_alert");
  const item = newestBody("deliver_saved_search_item_alerts");
  const counts = newestBody("saved_search_new_counts");

  it("reads real bodies (floor)", () => {
    expect(notify.body.length).toBeGreaterThan(1500);
    expect(deliver.body.length).toBeGreaterThan(2000);
    expect(item.body.length).toBeGreaterThan(2000);
    expect(counts.body.length).toBeGreaterThan(1500);
  });

  it("each sender reads only its own section's searches", () => {
    expect(notify.body, notify.file).toMatch(/s\.section = 'jobs'\s+AND p\.email_verified/);
    expect(deliver.body, deliver.file).toMatch(/s\.notify_enabled = true\s+AND s\.section = 'jobs'/);
    expect(item.body, item.file).toMatch(/WHERE s\.section = 'declutter'/);
  });

  it("the email channel is per search, once a day, and gates the send", () => {
    for (const { file, body } of [deliver, item]) {
      expect(body, file).toMatch(/AND s\.notify_email\s+AND \(s\.last_emailed_at IS NULL OR s\.last_emailed_at < now\(\) - interval '1 day'\)/);
      const gate = body.indexOf("IF v_email_ids IS NOT NULL THEN");
      const send = body.indexOf("send-notification-email");
      expect(gate, `${file}: no email gate`).toBeGreaterThan(0);
      expect(send, `${file}: email sent outside the gate`).toBeGreaterThan(gate);
    }
  });

  it("a test seller never alerts a real member by email either (Q137: the email skips declutter_notify's boundary)", () => {
    expect(item.body).toMatch(/AND \(NOT v_seller_seed OR COALESCE\(p\.is_seed, false\)\)/);
  });

  it("the pause and the block stop every sender", () => {
    for (const { file, body } of [notify, deliver, item]) {
      expect(body, file).toContain("NOT COALESCE(np.saved_searches_paused, false)");
    }
    for (const { file, body } of [deliver, item, counts]) {
      expect(body, `${file}: no block filter`).toMatch(/FROM public\.user_blocks b/);
    }
  });

  it("Declutter alerts use that member's switch; the count uses the declutter_items SELECT policy's own predicate", () => {
    expect(item.body).toContain("public.feature_enabled_for_user('declutter', s.user_id)");
    const policy = [...livePolicies("declutter_items").values()].find((p) => /FOR\s+SELECT/i.test(p) && /feature_enabled_for\('declutter'\)/.test(p));
    expect(policy, "no live declutter_items SELECT policy").toBeTruthy();
    for (const clause of ["public.feature_enabled_for('declutter')", "public.seed_hidden_in_discovery()"]) {
      expect(policy!, `the policy no longer says ${clause}`).toContain(clause);
      expect(counts.body, `${counts.file}: the count drops ${clause}`).toContain(clause);
    }
    // Q1852 (20261021142959): the policy reads the server-kept declutter_items.seller_hidden column
    // (= declutter_seller_out(seller_id)); the SECURITY DEFINER count may still ask the helper, which is
    // the same answer for a live or reserved row. Either spelling counts; dropping both does not.
    expect(policy!, "the policy no longer hides an out seller's listings").toContain("NOT seller_hidden");
    expect(counts.body, `${counts.file}: the count drops the hidden-seller filter`).toMatch(/NOT (?:public\.declutter_seller_hidden\(|i\.seller_hidden\b)/);
    // Jobs count reads the Browse view, never the base table.
    expect(counts.body).toContain("FROM public.open_jobs_browse j");
    expect(counts.body).not.toMatch(/FROM public\.jobs\b/);
  });

  it("the count RPC answers only for the caller and is not anon's", () => {
    expect(counts.body).toMatch(/WHERE s\.user_id = \(SELECT auth\.uid\(\)\);\s*\$\w*\$;$/);
    // The file holding the NEWEST body restates its revoke (a restatement restates its grants), and no
    // migration ever grants it to anon.
    expect(blankSqlComments(readFileSync(resolve(DIR, counts.file), "utf8")), counts.file).toMatch(/REVOKE ALL ON FUNCTION public\.saved_search_new_counts\(\) FROM PUBLIC, anon;/);
    expect(ALL).not.toMatch(/GRANT[^;]*ON FUNCTION public\.saved_search_new_counts\(\)[^;]*\banon\b/);
    expect(ALL).toMatch(/REVOKE ALL ON FUNCTION public\.deliver_saved_search_item_alerts\(uuid\) FROM PUBLIC, anon, authenticated;/);
  });

  it("members read and write only their own saved searches (RLS)", () => {
    expect(ALL).toMatch(/ALTER TABLE public\.saved_searches ENABLE ROW LEVEL SECURITY/);
    const live = livePolicies("saved_searches");
    const cmds = new Map<string, string>();
    for (const text of live.values()) {
      const cmd = /FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)/i.exec(text)?.[1]?.toUpperCase() ?? "ALL";
      cmds.set(cmd, text);
      expect(text, `a saved_searches ${cmd} policy is not own-rows`).toMatch(/auth\.uid\(\)\)?\s*=\s*user_id/);
    }
    expect([...cmds.keys()].sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("the section is a closed set, and a go-live queues the item", () => {
    expect(ALL).toMatch(/CHECK \(section IN \('jobs', 'declutter', 'shops', 'homes'\)\)/);
    expect(ALL).toMatch(/CREATE TRIGGER saved_search_on_item_live\s+AFTER UPDATE OF status ON public\.declutter_items/);
    expect(newestBody("sweep_saved_search_alert_queue").body).toContain("public.deliver_saved_search_item_alerts(r.item_id)");
  });
});
