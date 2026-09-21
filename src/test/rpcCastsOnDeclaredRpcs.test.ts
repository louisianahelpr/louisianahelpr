import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";

/**
 * A CAST ON AN RPC types.ts ALREADY DESCRIBES IS TYPE COVERAGE THROWN AWAY.
 *
 * `staleRpcCastComments.test.ts` is the sibling of this guard and catches the
 * casts that ADMIT what they are: the ones carrying a "drop this once types.ts
 * is regenerated" note. That wording was the whole handle it had, so the 14
 * casts that never wrote the note — `apply_to_job`, `block_user_and_settle`,
 * `rpc_withdraw_dispute`, both dispute paths, the four in `useUserProfileData`
 * — sailed straight past it while suppressing exactly the same checks: the
 * argument NAMES, the argument TYPES and the RETURN shape of functions the
 * generated `Functions` block spells out in full.
 *
 * This guard drops the comment requirement entirely. If types.ts declares the
 * RPC, no cast may appear anywhere inside the call.
 *
 * THE ONE LEGITIMATE EXCEPTION, and why it has to be spelled. A generated
 * `Args` type renders every parameter as non-null (`p_message: string`), so a
 * parameter that genuinely takes NULL as a meaningful value — `apply_to_job`'s
 * `p_message` (no note on an application), `set_thread_snooze`'s `_until`
 * (NULL = mute forever) — cannot be expressed. Those keep a cast on THAT ONE
 * ARGUMENT, and must say so with a `// nullable-arg:` line naming the column
 * or the migration. The marker is deliberately specific: "the types are stale"
 * can be written about anything, "this parameter takes NULL" cannot.
 *
 * It also refuses a re-introduced `fn: string` RPC wrapper — the shape
 * `postedJobsHelpers.callUntypedRpc` had, which routed six fully-declared RPCs
 * through a single `as unknown as` and made the whole set invisible to a guard
 * that works by RPC name.
 */

const ROOT = resolve(__dirname, "../..");

/** `as any` / `as never` / `as unknown` — the three that silence `rpc`. */
const CAST = /\bas\s+(?:any|never|unknown)\b/;

/** The justification a nullable parameter must carry to keep its cast. */
const NULLABLE_ARG = /\/\/\s*nullable-arg:/;

/** How many lines above the call may carry the `// nullable-arg:` note. */
const COMMENT_WINDOW = 12;

/** Every function name declared in the generated `Functions` block. */
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

/**
 * The text of ONE `supabase.rpc` call, and nothing after it.
 *
 * Bounded rather than a fixed line window on purpose: `useUserProfileData` has
 * a clean `supabase.rpc(...)` two lines above an unrelated
 * `Promise.resolve({ … } as any)`, and a line window would report the cast
 * against the call forever.
 *
 * Two shapes. A direct call ends when its own parentheses balance. A
 * `supabase.rpc.bind(supabase) as unknown as (fn: "x", …) => …` balances at
 * `(supabase)` long before the interesting part, so that shape is read to the
 * end of the statement instead.
 */
function callRegion(text: string, at: number): string {
  const after = text.slice(at + "supabase.rpc".length);
  if (after.startsWith(".bind(")) {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      const c = text[i];
      if (c === "(" || c === "{" || c === "[") depth += 1;
      else if (c === ")" || c === "}" || c === "]") depth -= 1;
      else if (c === ";" && depth <= 0) return text.slice(at, i);
    }
    return text.slice(at);
  }
  const open = text.indexOf("(", at);
  if (open === -1) return text.slice(at, at + 200);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return text.slice(at);
}

interface Offender {
  file: string;
  line: number;
  rpc: string;
  snippet: string;
}

export function findOffenders(files: string[], known: Set<string>): Offender[] {
  const out: Offender[] = [];
  for (const file of files) {
    if (file.endsWith("rpcCastsOnDeclaredRpcs.test.ts")) continue; // this file quotes the shapes
    const src = readSource(file);
    if (!src) continue;
    const lines = src.split("\n");
    for (const m of src.matchAll(/supabase\.rpc/g)) {
      const at = m.index!;
      const line = src.slice(0, at).split("\n").length;
      // A doc comment quoting the shape it forbids is not a call site.
      const own = lines[line - 1].trim();
      if (own.startsWith("//") || own.startsWith("*")) continue;
      const region = callRegion(src, at);
      if (!CAST.test(region)) continue;
      const before = lines.slice(Math.max(0, line - 1 - COMMENT_WINDOW), line - 1).join("\n");
      if (NULLABLE_ARG.test(region) || NULLABLE_ARG.test(before)) continue;
      const named = /"([a-z0-9_]+)"/.exec(region);
      // A wrapper typed `fn: string` names no RPC at all and hides every one
      // routed through it — reported under its own pseudo-name rather than
      // skipped for lack of a literal.
      const rpc = named?.[1] ?? (/\bfn\s*:\s*string\b/.test(region) ? "<untyped fn: string>" : null);
      if (!rpc) continue;
      if (rpc !== "<untyped fn: string>" && !known.has(rpc)) continue;
      out.push({
        file: file.slice(ROOT.length + 1),
        line,
        rpc,
        snippet: region.split("\n")[0].trim().slice(0, 90),
      });
    }
  }
  return out;
}

describe("supabase.rpc casts on RPCs types.ts already declares", () => {
  const known = generatedRpcNames();
  const FILES = walkSource([resolve(ROOT, "src")]);

  it("reads the generated Functions block, and a non-empty source tree", () => {
    expect(known.size).toBeGreaterThan(100);
    expect(known.has("apply_to_job")).toBe(true);
    expect(known.has("block_user_and_settle")).toBe(true);
    // Floor the scan too: a walker that returned nothing would make the
    // "has none" assertion below pass by describing nothing.
    expect(FILES.length).toBeGreaterThan(1000);
  });

  it("has none, except a parameter documented `// nullable-arg:`", () => {
    const offenders = findOffenders(FILES, known);
    expect(
      offenders.map((o) => `${o.file}:${o.line} — ${o.rpc}: ${o.snippet}`),
      "types.ts declares these RPCs; the cast suppresses their argument and return checking. " +
        "Fix the mismatch, or — for a parameter that genuinely takes NULL — cast that ONE " +
        "argument and justify it with a `// nullable-arg:` line.",
    ).toEqual([]);
  });

  it("can fail: the same scan over a fixture that still casts", () => {
    // Every guard must be shown able to fail (CLAUDE.md). The fixture carries
    // all three shapes that existed before this guard landed, plus the one
    // that must stay green.
    const fixture = resolve(ROOT, "src/test/fixtures/declaredRpcCast.ts.txt");
    expect(findOffenders([fixture], known).map((o) => o.rpc)).toEqual([
      "apply_to_job",
      "record_job_view",
      "<untyped fn: string>",
    ]);
  });
});

// A cast re-added to an RPC types.ts already declares must be seen. The
// inventory is DERIVED from two independent sources — the generated Functions
// block and a walk of src/ — so neither side is its own oracle. It is a
// SOURCE-TEXT scan: it reads types.ts, never prod's pg_proc.
// @mutate src/components/JobTracking.tsx | await supabase.rpc("mark_helper_arrival", { | await supabase.rpc("mark_helper_arrival" as never, {
