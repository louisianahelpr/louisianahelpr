/**
 * Q1582/Q1583 — one support request was TWO open ledger items.
 *
 * A guest's request at 2026-10-09T01:17:15Z was recorded by contact-support
 * as a user-report item ("Support (guest) [Other]", the message as sample)
 * and, 50ms later, by postSlackOpsAlert as an edge_slack item ("Support:
 * Other", the subject as sample): two items for one person, each needing its
 * own close. A signed-in sender's request was the same pair (the reports row's
 * trg_reports_zz_ledger item plus the Slack post's).
 *
 * The class: an edge function that records an occurrence as its OWN ledger
 * item (recordOpsAlertLedger, or a `reports` insert, which the trigger
 * records) passes `ledger: !<that item was recorded>` to every
 * postSlackOpsAlert call, so the Slack item is kept exactly when its own
 * write failed (lh-silent-failure review), and slack-alerts honours it. Inventory: every function under
 * supabase/functions/ that calls postSlackOpsAlert (comments blanked).
 *
 * @mutate supabase/functions/_shared/slack-alerts.ts |     if (input.ledger !== false) await recordOpsAlertLedger({ |     await recordOpsAlertLedger({
 * @mutate supabase/functions/contact-support/index.ts |       ledger: !itemRecorded, |       ledger: true,
 * @mutate supabase/functions/contact-support/index.ts |       itemRecorded = await recordOpsAlertLedger({ |       await recordOpsAlertLedger({
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FNS = join(ROOT, "supabase/functions");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.includes("/_shared/") && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/** Each postSlackOpsAlert({ … }) argument object, brace-matched. */
function slackCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/postSlackOpsAlert\(\s*\{/g)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

const files = walk(FNS).map((f) => ({ where: relative(ROOT, f), src: blankComments(readFileSync(f, "utf8")) }));
const callers = files.filter((f) => /postSlackOpsAlert\(/.test(f.src));
const ownItem = callers.filter((f) => /recordOpsAlertLedger\(|\.from\(\s*["']reports["']\s*\)\s*\.insert\(/.test(f.src));

describe("one support request is one ledger item (Q1582/Q1583)", () => {
  it("finds the Slack callers and the ones that record their own item", () => {
    expect(callers.length).toBeGreaterThan(30);
    expect(ownItem.map((f) => f.where)).toContain("supabase/functions/contact-support/index.ts");
  });

  it("a function that records its own ledger item passes ledger: false to every Slack post", () => {
    const doubled = ownItem.flatMap((f) =>
      slackCalls(f.src).filter((c) => !/\bledger:\s*!(\w+)\b/.test(c)).map(() => f.where),
    );
    expect(doubled, "this occurrence would be two open ledger items").toEqual([]);
    // …and the flag is the outcome of that function's OWN ledger write, so a
    // failed write keeps the Slack item instead of leaving none.
    for (const f of ownItem) {
      for (const c of slackCalls(f.src)) {
        const flag = /\bledger:\s*!(\w+)\b/.exec(c)?.[1];
        expect(f.src, `${f.where}: ${flag} must hold the result of recordOpsAlertLedger`).toMatch(
          new RegExp(`\\b${flag}\\s*=\\s*await recordOpsAlertLedger\\(`),
        );
      }
    }
  });

  it("slack-alerts skips its own ledger write when told to", () => {
    const shared = blankComments(readFileSync(join(FNS, "_shared/slack-alerts.ts"), "utf8"));
    expect(shared).toMatch(/ledger\?:\s*boolean/);
    const ledgerLib = blankComments(readFileSync(join(FNS, "_shared/opsAlertLedger.ts"), "utf8"));
    expect(ledgerLib).toMatch(/recordOpsAlertLedger\(o: LedgerOccurrence\): Promise<boolean>/);
    expect(ledgerLib).toMatch(/return res\.ok/);
    expect(shared).toMatch(/if \(input\.ledger !== false\) await recordOpsAlertLedger\(\{\s*sourceKind: 'edge_slack'/);
    expect(shared.match(/recordOpsAlertLedger\(\{\s*sourceKind: 'edge_slack'/g)?.length).toBe(1);
  });
});
