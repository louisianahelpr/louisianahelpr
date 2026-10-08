/**
 * Q1254 (owner decision 2026-10-07): a booked job's place and details change
 * only through a request EVERY booked Helpr accepts (a crew's every member);
 * text fields only, never photos; unanswered by the start it expires.
 *
 * Executable proof: src/test/pglite/jobDetailChange.pglite.mjs (the real jobs
 * trigger chain, the poster's lock and the Helpr's whitelist; OLD STATE RED;
 * the migration 3x). This file pins the shape of the NEWEST definitions so a
 * later restatement cannot drop a clause silently, and holds the flag that
 * unlocks the columns to its one writer.
 *
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |   IF v_waiting > 0 THEN | IF false THEN
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |      OR NOT (v_uid = ANY (v_booked)) THEN |      THEN
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |   IF now() >= v_req.expires_at\n | IF false\n
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |     UPDATE public.job_detail_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id; |     NULL;
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |     CHECK (cardinality(changed_fields) > 0 AND changed_fields <@ ARRAY['title', 'description', 'location', 'materials_note']::text[]), |     CHECK (cardinality(changed_fields) > 0 AND changed_fields <@ ARRAY['title', 'description', 'location', 'materials_note', 'photos']::text[]),
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |       IF changed_col IN ('title', 'description', 'location', 'latitude', 'longitude', 'materials_note')\n | IF changed_col IN ('title', 'description', 'location', 'latitude', 'longitude', 'materials_note', 'budget')\n
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |   PERFORM set_config('app.detail_change_rpc', '0', true); | PERFORM 1;
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |      v_starts_at)\n  RETURNING id INTO v_id; |      v_starts_at + interval '30 days')\n  RETURNING id INTO v_id;
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |     INSERT INTO public.job_detail_change_answers (request_id, helper_id) VALUES (v_id, v_helper); |     NULL;
 * Q1499: a changed address never keeps the old pin, and booked jobs are re-geocoded.
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |     NEW.latitude := NULL;\n    NEW.longitude := NULL; |     NULL;
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql | CREATE TRIGGER zzzzzz_jobs_location_clears_coords | CREATE TRIGGER aa_jobs_location_clears_coords
 * @mutate supabase/functions/backfill-job-geocode/index.ts | const GEOCODE_STATUSES = ["open", "accepted", "in_progress"]; | const GEOCODE_STATUSES = ["open"];
 * G1: an agreed new address must carry its own map point (a pinless booked job verifies any arrival).
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |     IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 | IF false AND v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |          latitude = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_latitude ELSE latitude END, |          latitude = latitude,
 * H1: an agreed address that geocodes to the same point keeps it (the clear stands aside for the agreed write).
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |   IF current_setting('app.detail_change_rpc', true) = '1' THEN\n    RETURN NEW;\n  END IF;\n  IF NEW.location |   IF NEW.location
 * G4: the geocoder writes only for the address it looked up.
 * @mutate supabase/functions/backfill-job-geocode/index.ts |           .eq("location", job.location) |           .not("location", "is", null)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const allSql = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");
const DEFS = effectiveDefs(dir);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const FIELDS = ["title", "description", "location", "materials_note"];

describe("a booked job's place and details change only by a request every booked Helpr accepts (Q1254)", () => {
  const request = body("request_job_detail_change");
  const respond = body("respond_job_detail_change");
  const whitelist = body("enforce_helper_jobs_column_whitelist");

  it("inventory: both RPCs exist, SECURITY DEFINER, and anon cannot run them", () => {
    expect(request.length).toBeGreaterThan(2000);
    expect(respond.length).toBeGreaterThan(2000);
    expect(request).toMatch(/SECURITY DEFINER/);
    expect(respond).toMatch(/SECURITY DEFINER/);
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.request_job_detail_change(uuid, jsonb) FROM PUBLIC, anon;");
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.respond_job_detail_change(uuid, boolean) FROM PUBLIC, anon;");
  });

  it("only the poster asks, and every Helpr booked at that moment gets an answer row", () => {
    expect(request).toMatch(/IF v_uid IS DISTINCT FROM v_job\.customer_id THEN\s+RAISE EXCEPTION 'not_authorized'/);
    expect(request).toMatch(/v_booked := public\.job_booked_helpr_ids\(v_job\.id\)/);
    expect(request).toMatch(/FOREACH v_helper IN ARRAY v_booked LOOP\s+INSERT INTO public\.job_detail_change_answers \(request_id, helper_id\) VALUES \(v_id, v_helper\);/);
    // The booked set is the lock's own: the job's Helpr and every roster row naming one.
    const booked = body("job_booked_helpr_ids");
    expect(booked).toMatch(/j\.helper_id IS NOT NULL/);
    expect(booked).toMatch(/g\.helper_id IS NOT NULL/);
  });

  it("text fields only: the four columns, never photos, and the request expires at the job's start", () => {
    expect(allSql).toContain("changed_fields <@ ARRAY['title', 'description', 'location', 'materials_note']::text[]");
    expect(request).toMatch(/WHERE k NOT IN \('title', 'description', 'location', 'latitude', 'longitude', 'materials_note'\)\)\s+THEN\s+RAISE EXCEPTION 'detail_change_invalid'/);
    expect(request).toMatch(/v_starts_at := \(v_job\.date_needed \+ COALESCE\(v_job\.start_time, '00:00'::time\)\) AT TIME ZONE 'America\/Chicago'/);
    expect(request).toMatch(/v_job\.materials_note, CASE WHEN 'materials_note' = ANY \(v_fields\) THEN v_materials END,\s+v_starts_at\)\s+RETURNING id INTO v_id;/);
  });

  it("only a Helpr the request asked, still booked, answers; an expired or overtaken request changes nothing", () => {
    expect(respond).toMatch(/WHERE a\.request_id = v_req\.id AND a\.helper_id = v_uid\)\s+OR NOT \(v_uid = ANY \(v_booked\)\) THEN\s+RAISE EXCEPTION 'not_authorized'/);
    expect(respond).toMatch(/IF now\(\) >= v_req\.expires_at\s+OR v_job\.date_needed IS NULL OR now\(\) >= v_starts_at/);
    for (const f of FIELDS) {
      expect(respond).toContain(`('${f}' = ANY (v_req.changed_fields) AND v_job.${f} IS DISTINCT FROM v_req.old_${f})`);
    }
  });

  it("one decline ends it; the change applies only once no booked Helpr is left un-accepted", () => {
    expect(respond).toMatch(/IF NOT p_accept THEN\s+UPDATE public\.job_detail_change_requests SET status = 'declined'/);
    const waiting = respond.search(/IF v_waiting > 0 THEN\s+RETURN jsonb_build_object\('status', 'waiting'/);
    const flag = respond.indexOf("PERFORM set_config('app.detail_change_rpc', '1', true);");
    const apply = respond.indexOf("UPDATE public.jobs");
    const clear = respond.indexOf("PERFORM set_config('app.detail_change_rpc', '0', true);");
    expect(waiting).toBeGreaterThan(0);
    expect(respond).toMatch(/a\.helper_id = ANY \(v_booked\) AND a\.answer <> 'accepted'/);
    expect(flag).toBeGreaterThan(waiting);
    expect(apply).toBeGreaterThan(flag);
    expect(clear).toBeGreaterThan(apply);
    // Nothing between the flag and the apply but the apply itself.
    expect(respond.slice(apply, clear).match(/UPDATE /g)?.length).toBe(1);
  });

  it("the flag unlocks exactly the four columns, in the Helpr's whitelist, and only respond_job_detail_change sets it", () => {
    expect(whitelist).toMatch(
      /IF changed_col IN \('title', 'description', 'location', 'latitude', 'longitude', 'materials_note'\)\s+AND current_setting\('app\.detail_change_rpc', true\) = '1' THEN\s+CONTINUE;/,
    );
    const setters = [...DEFS.entries()].filter(([, d]) => /set_config\(\s*'app\.detail_change_rpc',\s*'1'/.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(setters).toEqual(["respond_job_detail_change"]);
  });

  it("Q1499: an address change clears the old coordinates, after every lock has judged the write, and booked jobs are re-geocoded", () => {
    const fn = body("jobs_location_clears_coords");
    // H1: the agreed write always carries its own point; a same-point typo fix must keep it.
    expect(fn).toMatch(/BEGIN\s+IF current_setting\('app\.detail_change_rpc', true\) = '1' THEN\s+RETURN NEW;\s+END IF;\s+IF NEW\.location IS DISTINCT FROM OLD\.location/);
    expect(fn).toMatch(/IF NEW\.location IS DISTINCT FROM OLD\.location\s+AND NEW\.latitude IS NOT DISTINCT FROM OLD\.latitude\s+AND NEW\.longitude IS NOT DISTINCT FROM OLD\.longitude THEN\s+NEW\.latitude := NULL;\s+NEW\.longitude := NULL;/);
    // BEFORE triggers fire in name order: this one must sort after every other
    // BEFORE trigger any migration puts on jobs, so the poster's lock and the
    // Helpr's whitelist never see the server's clear as a client write.
    const names = [...allSql.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE[^;]*?ON public\.jobs\b/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    const mine = "zzzzzz_jobs_location_clears_coords";
    expect(names).toContain(mine);
    expect(names.filter((n) => n !== mine && n > mine)).toEqual([]);
    const geocoder = readFileSync("supabase/functions/backfill-job-geocode/index.ts", "utf8");
    expect(geocoder).toContain('const GEOCODE_STATUSES = ["open", "accepted", "in_progress"];');
    expect(geocoder.match(/\.in\("status", GEOCODE_STATUSES\)/g)?.length).toBe(2);
    expect(blankComments(geocoder)).toMatch(/\.in\("status", GEOCODE_STATUSES\)\s+\.eq\("location", job\.location\)\s+\.is\("latitude", null\)/);
  });

  it("G1: an agreed new address carries its own map point, written in the same update", () => {
    expect(request).toMatch(/IF 'location' = ANY \(v_fields\) THEN[\s\S]{0,400}IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN\s+RAISE EXCEPTION 'detail_change_location_unmapped';/);
    expect(respond).toContain("latitude = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_latitude ELSE latitude END,");
    expect(respond).toContain("longitude = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_longitude ELSE longitude END,");
    // The app's "Ask to change the details" and its client (src/lib/jobDetailChange.ts) were
    // removed (owner, 2026-10-08: "delete ask to change the details"); the server half stands.
  });

  it("clients cannot write the request or answer tables; only the parties read them", () => {
    expect(allSql).toContain("REVOKE ALL ON TABLE public.job_detail_change_requests FROM PUBLIC, anon, authenticated;");
    expect(allSql).toContain("REVOKE ALL ON TABLE public.job_detail_change_answers FROM PUBLIC, anon, authenticated;");
    expect(allSql).toContain("GRANT SELECT ON TABLE public.job_detail_change_requests TO authenticated;");
    expect(allSql).toContain("GRANT SELECT ON TABLE public.job_detail_change_answers TO authenticated;");
    expect(allSql).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\.job_detail_change_(?:requests|answers) TO authenticated/);
  });
});
