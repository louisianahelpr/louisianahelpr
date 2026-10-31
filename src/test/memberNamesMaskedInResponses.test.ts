/**
 * Members never see each other's last names, not even in a network response (owner rule 2026-10-21;
 * migration 20261021131322_member_names_first_and_initial.sql).
 *
 * The class: a SQL function or view a client role can call (EXECUTE / SELECT for authenticated or
 * anon) that reads profiles.full_name and hands it back. The client shortens names on screen
 * (formatName -> "First L."), but the surname was still in the response body. Q2292 covers the
 * notification text producers (src/test/notificationNamesAreFirstAndInitial.test.ts); this covers
 * every callable reader.
 *
 * How: replay every migration (src/test/helpers/effectiveFunctionDefs.ts, rewrites included) for the
 * EFFECTIVE body of each public function, and replay the function grants in file order (a new
 * function starts with EXECUTE for PUBLIC, anon and authenticated, Supabase's default privileges;
 * GRANT / REVOKE ... ON FUNCTION and ON ALL FUNCTIONS IN SCHEMA public move it; DROP removes it).
 * Every callable, non-trigger function whose body still reads `full_name` once each
 * display_name_for_viewer(...) / member_display_name(...) call is blanked is a failure, unless it
 * is listed in RAW_NAME_OK with why. The list is exact and two-way. Views: the newest CREATE VIEW
 * of every view must not read full_name at all (none does today).
 * Behaviour (each reader under the real roles, formatName parity, 3x replay):
 * src/test/pglite/memberNamesMaskedInResponses.pglite.mjs.
 *
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql | p.user_id, public.display_name_for_viewer(p.full_name, p.user_id) AS full_name, p.avatar_url | p.user_id, p.full_name, p.avatar_url
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql | CROSS JOIN LATERAL (SELECT public.display_name_for_viewer(p.full_name, p.user_id) AS name) d | CROSS JOIN LATERAL (SELECT p.full_name AS name) d
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql | SELECT q.id, q.quoter_id, public.display_name_for_viewer(p.full_name, q.quoter_id)::text, p.avatar_url::text, | SELECT q.id, q.quoter_id, p.full_name::text, p.avatar_url::text,
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql |            ELSE public.member_display_name(p_full_name, NULL) |            ELSE p_full_name
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql | REVOKE ALL ON FUNCTION public.display_name_for_viewer(text, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.display_name_for_viewer(text, uuid) FROM PUBLIC;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase", "migrations");
const THIS = "20261021131322_member_names_first_and_initial.sql";

/** Callable functions that may hand back a full name. name -> why. Exact and two-way. */
const RAW_NAME_OK: Record<string, string> = {
  admin_ban_settlement_reviews: "admin only: RAISE admin_only unless has_role(v_uid, 'admin')",
  admin_list_category_suggestions: "admin only: RAISE not_authorized unless has_role(auth.uid(), 'admin')",
  admin_support_queue: "admin only: has_role(auth.uid(), 'admin') in WHERE, a member gets no rows",
  admin_support_replies: "admin only: has_role(auth.uid(), 'admin') in WHERE, a member gets no rows; the name is the replying admin's",
  get_helper_tiers: "admin only: has_role(auth.uid(), 'admin') in WHERE, a member gets no rows",
  get_payout_batches: "admin only: has_role(auth.uid(), 'admin') in WHERE, a member gets no rows",
  get_pending_credentials: "admin only: has_role(auth.uid(), 'admin') in WHERE, a member gets no rows",
  apply_low_rating_flag: "returns only an action and a count; the name goes into the admins' fan-out notice",
  declutter_guest_seller_first_name:
    "BUY-16 (20261031062900, lead-approved): returns only the first word of the seller's name (left(split_part(...), 40)), never the last name, for a live, unhidden, non-seed listing while Declutter is open to everyone",
};
/** Functions no client may call that read full_name raw, which a callable function calls. name -> why. Exact and two-way. */
const INDIRECT_OK: Record<string, string> = {
  apply_consequence_ladder:
    "returns only an action and a count (RETURN jsonb_build_object('action', ..., 'prior_count', ...)); the name goes into the admins' fan-out notice",
};
/** The RAW_NAME_OK entries justified as admin-only: each body must carry the admin gate. */
const ADMIN_ONLY = Object.keys(RAW_NAME_OK).filter((k) => RAW_NAME_OK[k].startsWith("admin only"));

/** The member-facing readers the migration masks: each must call display_name_for_viewer. */
const MASKED_READERS = ["get_safe_profiles", "search_profiles_by_name", "get_my_saved_helpers", "get_quotes_for_request", "get_public_profile_reviews"];
/** The first-name readers / builders: each takes the first word of member_display_name. */
const FIRST_NAME_READERS = ["helpr_task_view", "nudge_confirm", "record_backout_notice", "notify_message_recipient"];
/** A first-name reader restated verbatim by a later migration for another reason (its name line unchanged). EXACT. */
const RESTATED_LATER: Record<string, string> = {
  // Whole-dollar delivery take-home (owner 2026-10-21); only take_home_cents changed.
  // Audit 1c #1/#4 (2026-10-29): handed_over_at and problem_open added; the name read is verbatim.
  helpr_task_view: "20261030012018_helpr_delivery_seller_handover.sql",
  // Q2399 card hold at post: the offer branch's money gate reads job_payment_is_listed; the name read is verbatim.
  // A2-B15 (2026-10-29): the poster's own reopen files no backout notice; the name read is verbatim.
  record_backout_notice: "20261029162907_poster_own_reopen_files_no_backout_notice.sql",
  // Messages audit H1/M4/M6 (owner 2026-10-30): mute, 15-minute throttle, preview switch, email; the name read is verbatim.
  notify_message_recipient: "20261030212051_message_snooze_ends.sql",
};

/** Blank every call to the masking helpers, balanced parentheses, so what is left reads names raw. */
function withoutMaskCalls(body: string): string {
  let out = body;
  for (;;) {
    const m = /\b(?:display_name_for_viewer|member_display_name)\s*\(/i.exec(out);
    if (!m) return out;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) break;
    }
    out = out.slice(0, m.index) + " ".repeat(i + 1 - m.index) + out.slice(i + 1);
  }
}

/** A raw read: the full_name token, not an output alias (`AS full_name`) and not a quoted json key. */
const RAW_READ = /(?<!\bAS\s+)(?<!['"])\bfull_name\b(?!['"])/i;

/** The body between the dollar quotes of a CREATE FUNCTION statement, comments blanked. */
function bodyOf(stmt: string): string {
  const code = blankSqlComments(stmt);
  const open = /\bAS\s+(\$\w*\$)/i.exec(code);
  if (!open) return "";
  const start = open.index + open[0].length;
  return code.slice(start, code.indexOf(open[1], start));
}
const returnsTrigger = (stmt: string) => /\breturns\s+(?:event_)?trigger\b/i.test(blankSqlComments(stmt).slice(0, 600));
const readsRaw = (body: string) => RAW_READ.test(withoutMaskCalls(body));

type Acl = { pub: boolean; anon: boolean; auth: boolean };
/** name -> who may EXECUTE it, replaying CREATE / DROP / GRANT / REVOKE in migration order. */
function replayFunctionGrants(): Map<string, Acl> {
  const acl = new Map<string, Acl>();
  const NAME = /(?:\bpublic\.)?"?(\w+)"?\s*\(/g;
  for (const file of migrationFiles(DIR)) {
    const code = blankSqlComments(readFileSync(join(DIR, file), "utf8"));
    const events: { at: number; apply: () => void }[] = [];
    for (const m of code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
      const name = m[1].toLowerCase();
      events.push({ at: m.index!, apply: () => void (acl.has(name) || acl.set(name, { pub: true, anon: true, auth: true })) });
    }
    for (const m of code.matchAll(/\bdrop\s+function\s+(?:if\s+exists\s+)?([^;]*);/gi)) {
      const names = [...m[1].matchAll(/(?:\bpublic\.)?"?(\w+)"?\s*(?:\(|,|$|\s+cascade|\s+restrict)/gi)].map((x) => x[1].toLowerCase());
      events.push({ at: m.index!, apply: () => names.forEach((nm) => acl.delete(nm)) });
    }
    for (const m of code.matchAll(/\b(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+(all\s+functions\s+in\s+schema\s+public|(?:function|routine)s?\s+[\s\S]*?)\s+(to|from)\s+([^;]*);/gi)) {
      const grant = m[1].toLowerCase() === "grant";
      const roles = m[4].toLowerCase();
      const all = /^all\s+functions/i.test(m[2]);
      const names = all ? null : [...m[2].replace(/^(?:function|routine)s?\s+/i, "").matchAll(NAME)].map((x) => x[1].toLowerCase());
      events.push({
        at: m.index!,
        apply: () => {
          for (const nm of names ?? [...acl.keys()]) {
            const a = acl.get(nm);
            if (!a) continue;
            if (/\bpublic\b/.test(roles)) a.pub = grant;
            if (/\banon\b/.test(roles)) a.anon = grant;
            if (/\bauthenticated\b/.test(roles)) a.auth = grant;
          }
        },
      });
    }
    events.sort((x, y) => x.at - y.at).forEach((e) => e.apply());
  }
  return acl;
}

const defs = effectiveDefs(DIR);
const acl = replayFunctionGrants();
const callable = (name: string) => {
  const a = acl.get(name);
  return !!a && (a.pub || a.anon || a.auth);
};
/** Callable, non-trigger functions whose effective body mentions full_name at all. */
const inventory = [...defs.entries()]
  .filter(([name, d]) => callable(name) && !returnsTrigger(d.stmt) && /\bfull_name\b/i.test(bodyOf(d.stmt)))
  .map(([name]) => name)
  .sort();
const rawReaders = inventory.filter((name) => readsRaw(bodyOf(defs.get(name)!.stmt)));

/**
 * The two shapes the body scan above cannot see (lh-authz-rls review, finding 3): a callable function that
 * gets the name from a function a client cannot call, and one that serialises a whole profiles row.
 */
const internalRawReaders = [...defs.entries()]
  .filter(([name, d]) => !callable(name) && !returnsTrigger(d.stmt) && readsRaw(bodyOf(d.stmt)))
  .map(([name]) => name);
function indirectReads(body: string): string[] {
  return internalRawReaders.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`, "i").test(body));
}
function dumpsProfileRows(stmt: string): boolean {
  const code = blankSqlComments(stmt);
  if (/\breturns\s+setof\s+(?:public\.)?profiles\b/i.test(code)) return true;
  const body = bodyOf(stmt);
  const aliases = [
    ...[...body.matchAll(/\b(?:from|join)\s+(?:public\.)?profiles\s+(?:as\s+)?(\w+)/gi)].map((m) => m[1]),
    ...[...body.matchAll(/\b(\w+)\s+(?:public\.)?profiles(?:%rowtype)?\s*;/gi)].map((m) => m[1]),
  ].filter((a) => !/^(where|on|using|join|left|inner|cross|limit|order|group)$/i.test(a));
  return aliases.some((a) => new RegExp(`\\b(?:to_jsonb|row_to_json|to_json|jsonb_agg|json_agg)\\s*\\(\\s*${a}\\s*\\)|\\b${a}\\.\\*`, "i").test(body));
}
const callableBodies = [...defs.entries()].filter(([name, d]) => callable(name) && !returnsTrigger(d.stmt));

/** name -> newest CREATE VIEW statement text (comments blanked) of every view no later DROP VIEW removed. */
function newestViews(): Map<string, string> {
  const views = new Map<string, string>();
  for (const file of migrationFiles(DIR)) {
    const code = blankSqlComments(readFileSync(join(DIR, file), "utf8"));
    const events: { at: number; apply: () => void }[] = [];
    for (const m of code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?[\s\S]*?(?:;|\$\w*\$)/gi)) {
      events.push({ at: m.index!, apply: () => void views.set(m[1].toLowerCase(), m[0]) });
    }
    for (const m of code.matchAll(/\bdrop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?([^;]*);/gi)) {
      const names = [...m[1].matchAll(/(?:\bpublic\.)?"?(\w+)"?\s*(?:,|$|\s+cascade|\s+restrict)/gi)].map((x) => x[1].toLowerCase());
      events.push({ at: m.index!, apply: () => names.forEach((nm) => views.delete(nm)) });
    }
    events.sort((x, y) => x.at - y.at).forEach((e) => e.apply());
  }
  return views;
}

describe("members never see another member's last name in a response", () => {
  it("reads the inventories (floors)", () => {
    expect(defs.size).toBeGreaterThan(1000);
    expect(inventory.length).toBe(28); // exact: a new reader of full_name must be looked at. 28 with BUY-16's guest first-name read (20261031062900, 2026-10-31: declutter_guest_seller_first_name returns the first word only, listed in RAW_NAME_OK); 27 with Wanted photos and replies (20261030064727, 2026-10-30, B77/B82: declutter_my_wanted names the seller of each reply to the poster through member_display_name, "Ann S."); 26 with the Free change (20261030064021, 2026-10-30, Q2487: declutter_request_free names the asker to the giver and declutter_free_requests_for_item lists who asked, both through member_display_name, "Ann S."); 24 with admin_booking_sources (20261030013347, 2026-10-29, B59: admin-only, names each Helpr through display_name_for_viewer); 23 with declutter_admin_open_problems (20261028195212, 2026-10-28: admin-only, names buyer and seller through member_display_name, "Ann S."); 22 with find_helprs (20261027201848, 2026-10-27, Q2437: Find a Helpr names each Helpr through display_name_for_viewer); 21 with declutter_checkout_free (20261027170717, 2026-10-27: names the taker to the giver through member_display_name); 20 with admin_support_replies (20261023200521, 2026-10-23: admin-only, names the replying admin); 19 with board 141 (20261021102943, 2026-10-21: its three refund-request RPCs name the other party through member_display_name); 16 on the TRAIN K tree (2026-10-21): TRAIN J added the Declutter Wanted readers (declutter_wanted_browse names the poster through member_display_name)
    expect([...newestViews().keys()].sort()).toEqual(["analytics_events_real", "jobs_helper_safe", "open_jobs_browse"]); // prod pg_class, 2026-10-21
  });

  it("the inventory holds every callable function prod showed reading full_name (2026-10-21)", () => {
    // Live: pg_get_functiondef ILIKE '%full_name%' AND has_function_privilege('authenticated', oid, 'EXECUTE').
    // member_display_name is not here: its body reads only its p_full_name argument.
    for (const name of ["admin_ban_settlement_reviews", "admin_list_category_suggestions", "admin_support_queue", "apply_low_rating_flag",
      "claim_series_dates", "get_helper_tiers", "get_my_saved_helpers", "get_payout_batches", "get_pending_credentials",
      "get_public_profile_reviews", "get_quotes_for_request", "get_safe_profiles", "helpr_task_view", "nudge_confirm", "search_profiles_by_name"]) {
      expect(inventory, name).toContain(name);
    }
  });

  it("the grant replay agrees with prod for the functions that read full_name (pg_proc.proacl, 2026-10-21)", () => {
    // Measured live with has_function_privilege('authenticated', oid, 'EXECUTE') before this migration.
    for (const name of ["get_safe_profiles", "search_profiles_by_name", "get_my_saved_helpers", "get_quotes_for_request",
      "get_public_profile_reviews", "helpr_task_view", "nudge_confirm", "member_display_name", "claim_series_dates", ...Object.keys(RAW_NAME_OK)]) {
      expect(callable(name), name).toBe(true);
    }
    for (const name of ["complete_job_accept", "detect_stuck_payments", "purge_user_data", "retain_ban_for_user", "sweep_expired_auto_bans",
      "wipe_pre_verification_account", "notify_admins_new_member", "apply_consequence_ladder", "display_name_for_viewer"]) {
      expect(callable(name), name).toBe(false);
    }
    expect(acl.get("get_safe_profiles")!.anon).toBe(true);
  });

  it("the checker strips a mask call and still sees a raw read", () => {
    expect(readsRaw("SELECT public.display_name_for_viewer(p.full_name, p.user_id) AS full_name")).toBe(false);
    expect(readsRaw("SELECT public.member_display_name(p.full_name, NULL) INTO v")).toBe(false);
    expect(readsRaw("jsonb_build_object('full_name', public.member_display_name(p.full_name, NULL))")).toBe(false);
    expect(readsRaw("SELECT p.user_id, p.full_name, p.avatar_url")).toBe(true);
    expect(readsRaw("SELECT split_part(btrim(p.full_name), ' ', 1)")).toBe(true);
    expect(readsRaw("WHERE p.full_name ILIKE '%' || q || '%'")).toBe(true);
    expect(readsRaw("public.display_name_for_viewer(p.full_name, p.user_id) || full_name")).toBe(true);
  });

  it("every callable function reads full_name only through the masking helpers (or is listed with why)", () => {
    expect(rawReaders.filter((name) => !(name in RAW_NAME_OK))).toEqual([]);
  });

  it("no callable function reads a name through a function a client cannot call", () => {
    expect(internalRawReaders.length).toBeGreaterThan(5);
    expect(indirectReads("SELECT public.apply_consequence_ladder(x)")).toContain("apply_consequence_ladder");
    const reads = callableBodies
      .filter(([name]) => !(name in RAW_NAME_OK))
      .flatMap(([name, d]) => indirectReads(bodyOf(d.stmt)).map((fn) => ({ name, fn })));
    expect(reads.filter((r) => !(r.fn in INDIRECT_OK)).map((r) => `${r.name} -> ${r.fn}`)).toEqual([]);
    // Two-way: every listed internal reader is still one, and a callable function still reaches it.
    for (const fn of Object.keys(INDIRECT_OK)) {
      expect(internalRawReaders, fn).toContain(fn);
      expect(reads.some((r) => r.fn === fn), fn).toBe(true);
    }
  });

  it("no callable function hands back a whole profiles row", () => {
    expect(dumpsProfileRows("CREATE FUNCTION f() RETURNS jsonb AS $$ SELECT to_jsonb(p) FROM public.profiles p $$;")).toBe(true);
    expect(dumpsProfileRows("CREATE FUNCTION f() RETURNS jsonb AS $$ DECLARE v public.profiles; BEGIN RETURN to_jsonb(v); END $$;")).toBe(true);
    expect(dumpsProfileRows("CREATE FUNCTION f() RETURNS SETOF public.profiles AS $$ SELECT 1 $$;")).toBe(true);
    expect(dumpsProfileRows("CREATE FUNCTION f() RETURNS jsonb AS $$ SELECT to_jsonb(p.user_id) FROM public.profiles p $$;")).toBe(false);
    expect(callableBodies.length).toBeGreaterThan(350);
    // The admin-only RAW_NAME_OK entries may (get_pending_credentials does); everyone else may not.
    expect(callableBodies.filter(([name, d]) => !(name in RAW_NAME_OK) && dumpsProfileRows(d.stmt)).map(([name]) => name)).toEqual([]);
    expect(dumpsProfileRows(defs.get("get_pending_credentials")!.stmt)).toBe(true);
  });

  it("every listed exception is still callable and still reads full_name raw (two-way)", () => {
    for (const name of Object.keys(RAW_NAME_OK)) {
      expect(rawReaders, name).toContain(name);
    }
  });

  it("every admin-only exception carries the admin gate in its body", () => {
    expect(ADMIN_ONLY.length).toBe(7); // 7 with admin_support_replies (2026-10-23)
    for (const name of ADMIN_ONLY) {
      expect(bodyOf(defs.get(name)!.stmt), name).toMatch(/\bhas_role\s*\([^;]*?'admin'/i);
    }
  });

  it("the member-facing readers return display_name_for_viewer, the first-name readers member_display_name", () => {
    for (const name of MASKED_READERS) {
      expect(defs.get(name)!.file, name).toBe(THIS);
      expect(bodyOf(defs.get(name)!.stmt), name).toMatch(/\bpublic\.display_name_for_viewer\(\s*\w+\.full_name\s*,/);
    }
    expect(Object.keys(RESTATED_LATER).every((n) => FIRST_NAME_READERS.includes(n))).toBe(true);
    for (const name of FIRST_NAME_READERS) {
      expect(defs.get(name)!.file, name).toBe(RESTATED_LATER[name] ?? THIS);
      expect(readsRaw(bodyOf(defs.get(name)!.stmt)), name).toBe(false);
      expect(bodyOf(defs.get(name)!.stmt), name).toMatch(/\bpublic\.member_display_name\(\s*(?:\w+\.)?full_name\s*,/);
    }
  });

  it("display_name_for_viewer shows the full name only to the owner, an admin or the server, and no client may call it", () => {
    const d = defs.get("display_name_for_viewer");
    expect(d?.file).toBe(THIS);
    const body = bodyOf(d!.stmt);
    expect(body).toMatch(/WHEN p_owner_id IS NOT NULL AND p_owner_id = \(SELECT auth\.uid\(\)\) THEN p_full_name/);
    expect(body).toMatch(/WHEN \(SELECT public\.is_server_context\(\)\) THEN p_full_name/);
    expect(body).toMatch(/public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\) THEN p_full_name/);
    expect(body).toMatch(/ELSE public\.member_display_name\(p_full_name, NULL\)/);
    expect(callable("display_name_for_viewer")).toBe(false);
  });

  it("member_display_name splits on formatName's exact whitespace set, never the locale's \\s", () => {
    const body = bodyOf(defs.get("member_display_name")!.stmt);
    expect(defs.get("member_display_name")!.file).toBe(THIS);
    expect(body).not.toMatch(/\\s/);
    expect(body.match(/\[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff\]\+/g)?.length).toBe(3);
  });

  it("no view reads full_name", () => {
    const bad = [...newestViews().entries()].filter(([, sql]) => /\bfull_name\b/i.test(sql)).map(([name]) => name);
    expect(bad).toEqual([]);
  });
});
