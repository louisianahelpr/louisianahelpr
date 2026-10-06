/**
 * Q1245 — the terms a booked Helpr agreed to are locked against the poster.
 *
 * The lh-authz-rls review of Q1204 found eight booked-job columns the lock did
 * not address. Measured 2026-10-04: no SQL function, edge function or client
 * update writes any of them. Seven join locked_when_booked
 * (20261004193548); helpers_needed was already locked on every booked job by
 * the crew shape lock (enforce_group_job_has_no_lead: once checkout has
 * opened, and a booking needs a funded job). Pinned on the definitions the
 * database holds; behaviour, red then green:
 * src/test/pglite/bookedJobTermsLocked.pglite.mjs (applied 3x: ALL PASS;
 * NEW_MIGRATION=skip: 7 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const TERMS = ["requires_w9", "credential_tier", "pricing_mode", "is_recurring", "recurrence_interval", "department", "business_id"];

function arrayCols(body: string, name: string): string[] {
  const m = new RegExp(`${name}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`, "i").exec(body);
  return [...(m?.[1] ?? "").matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

describe("Q1245: a booked job's terms are locked against the poster", () => {
  const lock = blankSqlComments(defs.get("enforce_poster_jobs_money_lock")?.stmt ?? "");
  const booked = arrayCols(lock, "locked_when_booked");

  it("the parse sees the lock's booked list", () => {
    expect(booked.length).toBeGreaterThan(15);
    expect(booked).toContain("date_needed");
  });

  it.each(TERMS)("%s is in locked_when_booked", (col) => {
    expect(booked).toContain(col);
  });

  it("helpers_needed stays with the crew shape lock that already owns it", () => {
    const crew = blankSqlComments(defs.get("enforce_group_job_has_no_lead")?.stmt ?? "").replace(/\s+/g, " ");
    expect(crew).toContain("NEW.helpers_needed IS DISTINCT FROM OLD.helpers_needed");
    expect(crew).toContain("AND NOT public.is_server_context()");
    expect(crew).toContain("OLD.payment_status IS DISTINCT FROM 'unpaid'");
  });
});

// @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |     'requires_w9',\n |
// @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |     'business_id',\n |     'location_x',\n
