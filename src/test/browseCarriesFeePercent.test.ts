/**
 * Q2400 (HIGH, 2026-10-25): an open job funded at 5% + 70c was shown with a 10% take-home on Browse, the map pin,
 * quick-apply, the job sheet, the job page and the first-job Home. Those reads carried the flat stamp
 * (helper_fee_flat_cents) but not the percent stamped with it (helper_fee_percent), so helprFlatFeeCents fell back to
 * HELPR_FLAT_FEE_PERCENT, now 10. The payout reads the job's own stamp and was right; the shown number was not.
 *
 * THE CLASS: a fee stamp never travels without its percent.
 *   (A) every newest browse definition (the open_jobs_browse view, get_ranked_open_jobs, get_open_jobs_for_map) that
 *       projects helper_fee_flat_cents projects helper_fee_percent right after it;
 *   (B) every client column list (a select string) that names helper_fee_flat_cents names helper_fee_percent, and
 *       every feeStamp object literal that carries the flat stamp carries the percent;
 *   (C) a browse read made before db-deploy lands keeps working: readJobsAheadOfDb drops helper_fee_percent on 42703;
 *   (D) the numbers: a $100 job stamped 5% + 70c pays $94.30, never the 10% default's $89.30.
 * Red on ready/lead-helpr-fee-1025 @ 1d2c319e2d (the view, both RPCs and 8 selects lacked the percent).
 *
 * @mutate supabase/migrations/20261031000945_guests_get_no_poster_id_or_street.sql |     helper_fee_flat_cents,\n    helper_fee_percent,\n |     helper_fee_flat_cents,\n
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |     j.helper_fee_flat_cents,\n    -- Q2400: and the percent stamped with it (a 5% job is never priced at 10%).\n    j.helper_fee_percent\n |     j.helper_fee_flat_cents\n
 * @mutate src/lib/guestJobsQuery.ts | parish, helper_fee_flat_cents, helper_fee_percent"; | parish, helper_fee_flat_cents";
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | is_group_job, photos, helper_fee_flat_cents, helper_fee_percent, recurrence_days | is_group_job, photos, helper_fee_flat_cents, recurrence_days
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents, helper_fee_percent: j.helper_fee_percent }} | feeStamp={{ helper_fee_flat_cents: j.helper_fee_flat_cents }}
 * @mutate src/lib/jobColumns.ts | export const BROWSE_VIEW_COLUMNS_AHEAD_OF_DB = ["helper_fee_percent", "scope_video_url"] as const; | export const BROWSE_VIEW_COLUMNS_AHEAD_OF_DB = ["scope_video_url"] as const;
 * @mutate src/lib/jobColumns.ts | ...(browseView ? BROWSE_VIEW_COLUMNS_AHEAD_OF_DB : []) | ...BROWSE_VIEW_COLUMNS_AHEAD_OF_DB
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | .maybeSingle<Record<string, unknown>>(), { browseView: true }), | .maybeSingle<Record<string, unknown>>()),
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { BROWSE_VIEW_COLUMNS_AHEAD_OF_DB, readJobsAheadOfDb } from "@/lib/jobColumns";
import { helprFlatFeeCents } from "@/lib/helprFlatFee";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");

describe("Q2400: a fee stamp never travels without its percent", () => {
  it("(A) the newest open_jobs_browse projects helper_fee_percent right after helper_fee_flat_cents", () => {
    const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
    let newest = "";
    let body = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      const m = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.open_jobs_browse\b([\s\S]*?)\n\s*FROM\s+jobs\b/i.exec(sql);
      if (m) { newest = f; body = m[1]; }
    }
    expect(newest, "a migration defines the view").not.toBe("");
    // Right after the stamp; A2-B6 (20261029194021) appends scope_video_url after it.
    expect(body).toMatch(/\bhelper_fee_flat_cents,\s*helper_fee_percent\b/);
  });

  it("(A) both browse RPCs' newest definitions return and project the percent after the stamp", () => {
    const defs = effectiveDefs(MIG);
    let n = 0;
    for (const name of ["get_ranked_open_jobs", "get_open_jobs_for_map"]) {
      const def = defs.get(name);
      expect(def, name).toBeTruthy();
      const stmt = blankSqlComments(def!.stmt);
      expect(stmt, `${name} RETURNS TABLE`).toMatch(/helper_fee_flat_cents integer, helper_fee_percent numeric\)/);
      expect(stmt, `${name} outer SELECT`).toMatch(/(?:j\.)?helper_fee_flat_cents,\s*(?:j\.)?helper_fee_percent\s*\n\s*FROM (?:public\.jobs j|scored)\b/);
      n++;
    }
    expect(n).toBe(2);
  });

  // ── (B) the client ───────────────────────────────────────────────────────────────────────────────────────────
  // src/ listed from git (Q1142), app code only.
  const files = trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith("/types.ts"))
    .map((f) => ({ file: f, code: blankComments(readFileSync(join(ROOT, f), "utf8")) }));

  it("(B) every select that names the flat stamp names its percent", () => {
    const lists: { file: string; text: string }[] = [];
    for (const { file, code } of files) {
      // A column list: a string literal of comma-separated identifiers that names the stamp.
      for (const m of code.matchAll(/(["'`])((?:[a-z_][a-z0-9_]*\s*,\s*)+[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)\1/g)) {
        if (/\bhelper_fee_flat_cents\b/.test(m[2])) lists.push({ file, text: m[2] });
      }
    }
    expect(lists.length, "selects naming the stamp").toBeGreaterThan(9);
    expect(lists.filter((l) => !/\bhelper_fee_percent\b/.test(l.text)).map((l) => `${l.file}: ${l.text.slice(-60)}`)).toEqual([]);
  });

  it("(B) every feeStamp object literal carrying the flat stamp carries its percent", () => {
    const stamps: string[] = [];
    const bad: string[] = [];
    for (const { file, code } of files) {
      for (const m of code.matchAll(/feeStamp=\{\{([^}]*)\}\}/g)) {
        if (!/helper_fee_flat_cents/.test(m[1])) continue;
        stamps.push(file);
        if (!/helper_fee_percent/.test(m[1])) bad.push(`${file}: ${m[1].trim()}`);
      }
    }
    expect(stamps.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("(C) a browse read before db-deploy lands drops the percent on 42703 and keeps working", async () => {
    expect(BROWSE_VIEW_COLUMNS_AHEAD_OF_DB).toContain("helper_fee_percent");
    const seen: string[] = [];
    const res = await readJobsAheadOfDb("id, budget, helper_fee_flat_cents, helper_fee_percent", async (cols) => {
      seen.push(cols);
      return cols.includes("helper_fee_percent") ? { error: { code: "42703" } } : { error: null };
    }, { browseView: true });
    expect(res.error).toBeNull();
    expect(seen).toEqual(["id, budget, helper_fee_flat_cents, helper_fee_percent", "id, budget, helper_fee_flat_cents"]);
    // A jobs-table read never loses the percent on a retry (lh-money-escrow review of Q2400, #1).
    const jobsSeen: string[] = [];
    await readJobsAheadOfDb("id, helper_fee_flat_cents, helper_fee_percent, materials_note", async (cols) => {
      jobsSeen.push(cols);
      return { error: jobsSeen.length === 1 ? { code: "42703" } : null };
    });
    expect(jobsSeen[1]).toBe("id, helper_fee_flat_cents, helper_fee_percent");
    // Every browse-view read that names the percent opts in, so a pre-deploy view never breaks it.
    const browseReads = files.filter((x) => /from\(\s*["']open_jobs_browse["']\s*\)/.test(x.code) && /readJobsAheadOfDb\(/.test(x.code));
    expect(browseReads.length).toBeGreaterThan(5);
    expect(browseReads.filter((x) => !/browseView:\s*true/.test(x.code)).map((x) => x.file)).toEqual([]);
  });

  it("(D) a $100 job stamped 5% + 70c keeps $94.30; only an unstamped percent falls back to today's default", () => {
    expect(100_00 - helprFlatFeeCents(100_00, { helper_fee_flat_cents: 70, helper_fee_percent: 5 })).toBe(94_30);
    expect(100_00 - helprFlatFeeCents(100_00, { helper_fee_flat_cents: 70, helper_fee_percent: 10 })).toBe(89_30);
  });
});
