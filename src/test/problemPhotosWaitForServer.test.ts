/**
 * Audit 1b D2-7: the problem form and the refund-request form show their photo picker only once the server takes the
 * photos there, and the day it does, the picker turns on (two-way: a flag that disagrees with the migrations is red
 * either way). Read from the EFFECTIVE definitions the migrations leave (effectiveDefs), never one file.
 *
 * Server side (Builder 44; measured on prod 2026-10-29 with pg_get_functiondef, read-only):
 *   - declutter_handover_photo_access(name, p_write => true): a member uploads only while the order is 'paid'. The
 *     problem form is offered on handed-over orders only (owner: not while an order waits for pickup), so every
 *     problem photo would be refused until the write rule also allows the problem folder in the 24-hour window.
 *   - declutter_ask_refund(uuid, text, text): no photos until it takes p_photo_paths.
 *
 * @mutate src/lib/declutter/problemPhotos.ts | export const PROBLEM_FORM_PHOTOS_READY = true; | export const PROBLEM_FORM_PHOTOS_READY = false;
 * @mutate src/lib/declutter/problemPhotos.ts | export const REFUND_FORM_PHOTOS_READY = true; | export const REFUND_FORM_PHOTOS_READY = false;
 * @mutate supabase/migrations/20261030071818_declutter_returns.sql | = 'problem' AND o.status = 'handed_over'\n                               AND (public.declutter_problem_window_open(o.id) | = 'problem' AND o.status = 'nope'\n                               AND (true
 * @mutate supabase/migrations/20261031100935_declutter_problem_notices_name_the_item.sql | CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text,\n  p_photo_paths text[] DEFAULT '{}') | CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text,\n  p_photos text[] DEFAULT '{}')
 * @mutate src/components/declutter/DeclutterProblemForm.tsx | {PROBLEM_FORM_PHOTOS_READY && <ProblemPhotoPicker | {true && <ProblemPhotoPicker
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx | {REFUND_FORM_PHOTOS_READY && <ProblemPhotoPicker | {true && <ProblemPhotoPicker
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { PROBLEM_FORM_PHOTOS_READY, REFUND_FORM_PHOTOS_READY, PROBLEM_PHOTO_MAX } from "@/lib/declutter/problemPhotos";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const access = flat(DEFS.get("declutter_handover_photo_access")?.stmt ?? "");
const ask = DEFS.get("declutter_ask_refund")?.stmt ?? "";
const report = DEFS.get("declutter_report_problem")?.stmt ?? "";

/** The storage write rule's branch (from IF p_write THEN to the read branch's RETURN). */
function writeBranch(): string {
  const at = access.indexOf("IF p_write THEN");
  // Up to the read branch: returns (20261030071818) put a nested IF (the return folder) inside the write branch.
  const end = access.indexOf("RETURN public.has_role(v_uid, 'admin')", at);
  return at < 0 || end < 0 ? "" : access.slice(at, end);
}

/** A member may upload into the problem folder after the handover (while the problem window is open). */
function problemUploadsAfterHandover(): boolean {
  const w = writeBranch();
  return /declutter_problem_window_open\(|'handed_over'/.test(w);
}

describe("D2-7: the photo pickers wait for the server, and turn on when it is ready", () => {
  it("reads the live definitions (floor)", () => {
    expect(access).toMatch(/split_part\(p_name, '\/', 3\) NOT IN \('handover', 'problem'(, 'return')?\)/);
    expect(writeBranch().length).toBeGreaterThan(50);
    expect(writeBranch()).toContain("o.status = 'paid'");
    expect(ask.length).toBeGreaterThan(200);
    // The problem report already takes photo paths, in the problem folder, at most 6.
    expect(flat(report)).toContain("split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'");
    expect(flat(report)).toContain("cardinality(COALESCE(p_photo_paths, '{}')) > 6");
    expect(PROBLEM_PHOTO_MAX).toBeLessThanOrEqual(6);
  });

  it("the problem form's picker is on exactly when the server accepts problem photos after the handover", () => {
    expect(PROBLEM_FORM_PHOTOS_READY).toBe(problemUploadsAfterHandover());
  });

  it("the refund form's picker is on exactly when declutter_ask_refund takes p_photo_paths and the upload is allowed", () => {
    const head = ask.slice(0, ask.search(/\bAS\s+\$/i));
    expect(REFUND_FORM_PHOTOS_READY).toBe(/\bp_photo_paths\b/.test(head) && problemUploadsAfterHandover());
  });

  it("each form shows the picker only behind its flag", () => {
    expect(src("src/components/declutter/DeclutterProblemForm.tsx")).toContain("{PROBLEM_FORM_PHOTOS_READY && <ProblemPhotoPicker");
    expect(src("src/components/declutter/DeclutterRefundRequest.tsx")).toContain("{REFUND_FORM_PHOTOS_READY && <ProblemPhotoPicker");
  });
});
