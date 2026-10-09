/**
 * EVERY edge-to-edge `supabase.functions.invoke(...)` sets its own
 * `Authorization` header (2026-10-09).
 *
 * MEASURED on prod: stripe-webhook's post-funding call to instant-job-match
 * returned 401 on every real job from 2026-10-08 17:48Z to 2026-10-09 12:16Z
 * (function_edge_logs: request carried `apikey` sb_secret_… and no
 * Authorization). supabase-js 2.117 sends an sb_secret_ key only as `apikey`;
 * the callee trusts only `Authorization: Bearer <secret>`. So the "new job near
 * you" push never reached a single Helpr. The class is any invoke in
 * supabase/functions without an explicit Authorization header; the inventory
 * is read from the source tree, so a new caller joins this check by existing.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...tsFiles(p));
    else if (/\.ts$/.test(d.name) && !/test/.test(d.name)) out.push(p);
  }
  return out;
}

/** Each `functions.invoke(` call's argument text (up to its matching paren). */
function invokeCalls(src: string): string[] {
  const calls: string[] = [];
  let i = src.indexOf("functions.invoke(");
  while (i !== -1) {
    let depth = 0;
    let j = i + "functions.invoke".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    calls.push(src.slice(i, j + 1));
    i = src.indexOf("functions.invoke(", j);
  }
  return calls;
}
const missingBearer = (call: string) => !/Authorization:\s*`Bearer /.test(call);

describe("edge-to-edge invokes carry their own Bearer", () => {
  it("catches the original post-funding call", () => {
    const original = `await supabase.functions.invoke("instant-job-match", {\n  body: { jobId },\n});`;
    expect(invokeCalls(original).filter(missingBearer)).toHaveLength(1);
  });

  it("every functions.invoke in supabase/functions sets Authorization", () => {
    const all = tsFiles("supabase/functions").flatMap((f) =>
      invokeCalls(blankComments(readFileSync(f, "utf8"))).map((c) => ({ f, c })));
    expect(all.length, "no invokes found — this check is looking at nothing").toBeGreaterThanOrEqual(2);
    expect(all.filter(({ c }) => missingBearer(c)).map(({ f }) => f)).toEqual([]);
  });
});
