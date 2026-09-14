import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";

/**
 * "DROP THE CAST ONCE types.ts IS REGENERATED" — AND THEN NOBODY DOES.
 *
 * Every one of these casts was written honestly. A new RPC ships in the same
 * commit as the code calling it, `src/integrations/supabase/types.ts` is a
 * snapshot taken before that migration existed, so the call cannot typecheck
 * and the author leaves a cast plus a note saying when it can go.
 *
 * The note is the problem. It names an event — the next regeneration — that
 * happens in a DIFFERENT commit, months later, touching a different file, done
 * by someone who has no reason to grep for the fifteen call sites it releases.
 * That is exactly what happened here: the regeneration landed in cb903ffa0 and
 * ~15 casts across `src/` went on suppressing type checking on the argument
 * names, argument types and return shape of RPCs the types now describe
 * perfectly. One of them (`record_profile_view`) was hiding a real
 * `string | undefined` being passed to a NOT NULL uuid argument.
 *
 * So the note stops being a note and becomes this check. The moment types.ts
 * learns an RPC, every comment still promising to drop that RPC's cast fails,
 * naming the file, the line and the RPC.
 *
 * WHAT IT DOES NOT CLAIM. It does not say a cast is wrong — a cast next to a
 * genuinely absent RPC is correct and stays green, and so does one whose
 * comment gives a reason other than "the types are stale" (`set_thread_snooze`
 * widens ONE nullable argument that generated `Args` types cannot express, and
 * says so). It only refuses to let the stale-types EXCUSE outlive the staleness.
 */

const ROOT = resolve(__dirname, "../..");

/**
 * Comment wording that promises the cast goes away when types.ts catches up.
 * Collected from the call sites themselves rather than invented: the four
 * phrasings below are every variant that existed before this guard landed.
 */
const STALE_EXCUSE =
  /(drop the cast once|until the next `?supabase gen types`?|until types(?:\.ts)? (?:are|is) regenerat|newer than the last types regeneration|not in the generated \w+ map until|types\.ts is a SNAPSHOT)/i;

/** A cast that suppresses `supabase.rpc`'s own typing. */
const CAST = /\(\s*supabase\.rpc as (?:any|never|unknown)|supabase\.rpc\(\s*$|supabase\.rpc\(\s*"[^"]+" as (?:never|any)/;

/** `"rpc_name" as never` / `rpc("rpc_name"` / `)("rpc_name"` — the called name. */
const RPC_NAME = /(?:supabase\.rpc|\)|\()\s*\(?\s*"([a-z0-9_]+)"/i;

/** How far past the comment a call site may sit before it is a different subject. */
const WINDOW = 12;

/** Every function name declared in the generated `Functions` block of types.ts. */
function generatedRpcNames(): Set<string> {
  const text = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const start = text.indexOf("    Functions: {");
  expect(start, "types.ts has no Functions block — the guard cannot read it").toBeGreaterThan(-1);
  const end = text.indexOf("    Enums: {", start);
  const block = text.slice(start, end > -1 ? end : undefined);
  const names = new Set<string>();
  for (const m of block.matchAll(/^ {6}([a-z0-9_]+): /gim)) names.add(m[1]);
  return names;
}

interface Offender {
  file: string;
  line: number;
  rpc: string;
  comment: string;
}

function findOffenders(files: string[], known: Set<string>): Offender[] {
  const out: Offender[] = [];
  for (const file of files) {
    if (file.endsWith("staleRpcCastComments.test.ts")) continue; // this file quotes the wording
    const src = readSource(file);
    if (!src) continue;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].trim().startsWith("//") && !lines[i].trim().startsWith("*")) continue;
      if (!STALE_EXCUSE.test(lines[i])) continue;
      // Walk forward to the first `supabase.rpc` call and read the RPC name out
      // of it. A comment whose nearest call is more than WINDOW lines away is
      // documenting something else.
      for (let j = i; j < Math.min(i + WINDOW, lines.length); j += 1) {
        if (!CAST.test(lines[j]) && !/supabase\.rpc\(/.test(lines[j])) continue;
        // The cast itself sits on or beside the call; the RPC NAME can be
        // several lines further down when the cast spells out a whole call
        // signature (iap.ts and PostedJobActions.tsx both did). Two windows,
        // so a multi-line cast is not silently skipped.
        const castWindow = lines.slice(j, Math.min(j + 3, lines.length)).join("\n");
        if (!/as (?:any|never|unknown)/.test(castWindow)) break; // cast already gone
        const window = lines.slice(j, Math.min(j + 8, lines.length)).join("\n");
        const name = RPC_NAME.exec(window.replace(/^[^(]*supabase\.rpc/, "supabase.rpc"));
        if (!name) break;
        if (known.has(name[1])) {
          out.push({
            file: file.slice(ROOT.length + 1),
            line: i + 1,
            rpc: name[1],
            comment: lines[i].trim(),
          });
        }
        break;
      }
    }
  }
  return out;
}

describe("stale `drop the cast once types are regenerated` comments", () => {
  const known = generatedRpcNames();

  it("reads the generated Functions block", () => {
    // If this ever went empty the guard would pass by describing nothing.
    expect(known.size).toBeGreaterThan(100);
    expect(known.has("record_profile_view")).toBe(true);
  });

  it("has no cast still excused by staleness for an RPC types.ts now declares", () => {
    const offenders = findOffenders(walkSource([resolve(ROOT, "src")]), known);
    expect(
      offenders.map((o) => `${o.file}:${o.line} — ${o.rpc} is in types.ts now: ${o.comment}`),
      "types.ts declares these RPCs, so the cast beside each comment is pure lost type coverage",
    ).toEqual([]);
  });

  it("can fail: the same scan over a fixture that still carries the excuse", () => {
    // Every guard must be shown able to fail (CLAUDE.md). The fixture is written
    // to the same shape the real call sites had before cb903ffa0.
    const fixture = resolve(ROOT, "src/test/fixtures/staleRpcCast.ts.txt");
    const offenders = findOffenders([fixture], known);
    // Both shapes: the one-liner, and the multi-line cast that spells out a
    // call signature so the RPC name sits several lines below the cast.
    expect(offenders.map((o) => o.rpc)).toEqual([
      "record_profile_view",
      "subscription_purchase_eligibility",
    ]);
  });
});
