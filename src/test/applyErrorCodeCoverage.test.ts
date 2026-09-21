/*
 * Every refusal the APPLY path can raise has a sentence the helper can read.
 *
 * FOUND 2026-09-21. `enforce_application_job_state` raises eight codes and
 * `enforce_ban_gate` a ninth. `applyErrorCopy.ts` mapped TWO. Every other one
 * fell through to "Couldn't send your application through — tap retry", and
 * every one of them is DETERMINISTIC — the retry it offers re-fails
 * identically, forever, for a helper who is told nothing about why.
 *
 * WHY THE EXISTING GUARD DID NOT SEE IT. `rpcErrorCopyCoverage.test.ts` builds
 * a genuinely derived inventory of RAISE codes from the migrations — and says
 * so in its own header: *"Triggers fired by an RPC's own writes are not
 * followed."* That is a correct scope for an RPC-coverage guard and it is
 * exactly the gap: `useApplyFlow` has a direct-INSERT fallback (its PGRST202
 * branch), so the client hits these TRIGGERS with no RPC in between. The codes
 * were outside the only inventory that could have named them.
 *
 * So this file covers the other half: codes raised by the TRIGGERS on a table
 * the client writes to directly.
 *
 * DERIVED, never listed. The trigger set comes from the migrations, the codes
 * come from those functions' newest bodies, and the copy comes from the real
 * `resolveApplyErrorCopy`. Nothing here is retyped — a hand-written list is
 * what let the vocabulary grow past the map in the first place, and it is the
 * single commonest hollow shape in this repo.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { resolveApplyErrorCopy } from "@/pages/dashboard/applyErrorCopy";

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");

/**
 * Trigger functions on `applications`, and the newest body of each.
 *
 * Newest-first by filename, which is apply order. A function redefined by a
 * later migration must be read from THAT one — grading a superseded body is
 * its own hollow shape, and six guards in this repo were doing it.
 */
function applicationsTriggerBodies(): Map<string, string> {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  // Which functions are attached to `applications` by a CREATE TRIGGER.
  const attached = new Set<string>();
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?trigger\s+\w+[\s\S]{0,200}?\bon\s+(?:public\.)?applications\b[\s\S]{0,300}?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)/gi,
    )) {
      attached.add(m[1]);
    }
  }

  const bodies = new Map<string, string>();
  for (const fn of attached) {
    const head = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?"?${fn}"?\\s*\\(`,
      "i",
    );
    for (let i = files.length - 1; i >= 0; i--) {
      const sql = readFileSync(join(MIGRATIONS, files[i]), "utf8");
      const at = sql.search(head);
      if (at === -1) continue;
      /*
       * THIS FUNCTION'S BODY, not the whole file. A first cut stored the
       * entire migration and harvested every RAISE in it — so a file that
       * also defines the completion gates and the dispute-evidence checks
       * contributed `completion_min_work_time` and
       * `dispute_evidence_invalid_url` to the APPLY path's vocabulary, and
       * the guard demanded apply copy for refusals the apply path cannot
       * raise. Bound to the dollar-quoted body.
       */
      const tag = sql.slice(at).match(/\bAS\s+(\$[a-z_]*\$)/i);
      if (!tag) continue;
      const open = sql.indexOf(tag[1], at);
      const close = sql.indexOf(tag[1], open + tag[1].length);
      if (close === -1) continue;
      bodies.set(fn, sql.slice(open, close));
      break;
    }
  }
  return bodies;
}

/** Bare snake_case RAISE messages — written for a program to match. */
function codesIn(sql: string): string[] {
  return [...blankSqlComments(sql).matchAll(/raise\s+exception\s+'([a-z][a-z0-9_]{3,})'/gi)].map((m) => m[1]);
}

describe("every apply-path refusal has copy", () => {
  const bodies = applicationsTriggerBodies();
  const codes = [...new Set([...bodies.values()].flatMap(codesIn))].sort();

  it("the inventory is real (a check that finds nothing cannot fail)", () => {
    expect(bodies.size, "no trigger functions found for `applications`").toBeGreaterThan(2);
    expect(codes.length, "no RAISE codes parsed out of them").toBeGreaterThan(5);
    // Two that must always be there — one from each of the two functions that
    // carry the bulk of the vocabulary.
    expect(codes).toContain("cannot_apply_to_own_job");
    expect(codes).toContain("job_not_open");
  });

  it.each(codes.map((c) => [c] as const))("`%s` resolves to a sentence", (code) => {
    const copy = resolveApplyErrorCopy(code);
    expect(
      copy,
      `${code} is raised on the apply path and has no entry in applyErrorCopy.ts, so the helper gets ` +
        `the generic "tap retry" toast. Every one of these refusals is DETERMINISTIC — the retry ` +
        `re-fails identically. Add a line saying what happened, and what they can do if anything.`,
    ).toBeTruthy();
    expect(copy, `${code}'s copy is the raw code — it must be a sentence`).not.toBe(code);
  });

  it("no copy offers a retry for a deterministic refusal", () => {
    // The generic fallback is what says "tap retry". A mapped code that also
    // told the helper to retry would be the same defect wearing a sentence.
    const retrying = codes
      .map((c) => [c, resolveApplyErrorCopy(c)] as const)
      .filter(([, copy]) => copy && /\b(retry|try again)\b/i.test(copy));
    expect(
      retrying.map(([c, copy]) => `${c}: ${copy}`),
      "these refusals cannot succeed on a retry, so the copy must not suggest one",
    ).toEqual([]);
  });
});

// PROVEN RED 2026-09-21: deleting any one of the eight entries added today
// (e.g. `job_expired`) fails "`job_expired` resolves to a sentence". Adding a
// RAISE code to a trigger on `applications` without copy fails the same case,
// which is the regression this exists to stop.
// SOURCE-TEXT PIN: it reads MIGRATIONS, not prod. A trigger function hand-
// applied to the live database, or a code raised by a function the trigger
// CALLS rather than raising itself, is outside its inventory —
// rpcErrorCopyCoverage.test.ts follows that transitive chain for RPCs.
// @mutate src/pages/dashboard/applyErrorCopy.ts | job_expired: "This posting has expired.", |
