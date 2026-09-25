/**
 * A PROD SPEC'S CLEANUP DELETES ONLY ITS OWN RUN'S ROWS (nightly-red #1754).
 *
 * prod-audit run 36069316906, "double-tap Send delivers exactly one message":
 * the message was inserted (POST /rest/v1/messages 201 at 23:05:19.851Z) and
 * then the poll for it read 0 for 15 s. function/edge logs: at 23:05:21.432Z and
 * 21.663Z another runner deleted `messages?content=like.*[E2E-PRODAUDIT]*` as
 * helper-e2e and poster-e2e. That runner was Vacuity run 36062275531, replaying
 * e2e/prod-audit/interruptions.spec.ts under a mutation at the same minute
 * ("killed e2e/prod-audit/interruptions.spec.ts ⟵ src/pages/post-job/useJobSubmit.ts",
 * 23:06:55Z). Its afterEach removed every marked row on the shared accounts,
 * including the one this run was asserting on.
 *
 * The shared accounts are driven by more than one run at a time, so a cleanup
 * deletes by RUN_MARKER (MARKER plus this process's token); a bare-MARKER
 * delete is allowed only for leftovers older than any live run.
 *
 * @mutate e2e/prod-audit/interruptions.spec.ts | ...(await cleanupMarked(request, helper, { run: RUN_MARKER })), | ...(await cleanupMarked(request, helper, { leftoverBefore: Date.now() })),
 * @mutate e2e/prod-audit/harness.ts | const age = "leftoverBefore" in scope ? | const age = false ?
 * @mutate e2e/prod-audit/messy-input.spec.ts | const enc = encodeURIComponent(`*${RUN_MARKER}*`); | const enc = encodeURIComponent(`*${MARKER}*`);
 * @mutate e2e/prod-audit/interruptions.spec.ts | const text = `${RUN_MARKER} double-tap ${nonce()}`; | const text = `${MARKER} double-tap ${nonce()}`;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const DIR = "e2e/prod-audit";
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));
const files = readdirSync(join(ROOT, DIR))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => `${DIR}/${f}`);
const harness = read(`${DIR}/harness.ts`);

describe("prod-audit cleanup is scoped to the run that wrote the rows", () => {
  it("RUN_MARKER is MARKER plus a letters-only token, so every MARKER sweeper still finds a leftover", () => {
    expect(harness).toMatch(/export const MARKER = "\[E2E-PRODAUDIT\]";/);
    expect(harness).toMatch(/export const RUN_MARKER = `\$\{MARKER\} run\$\{Array\.from\(\{ length: 8 \}, \(\) => "abcdefghijklmnopqrstuvwxyz"\[/);
  });

  it("cleanupMarked's bare-MARKER branch deletes only leftovers older than any live run", () => {
    const body = /export async function cleanupMarked\([\s\S]*?\n\}/.exec(harness)?.[0] ?? "";
    expect(body, "cleanupMarked not found — this guard has rotted").not.toBe("");
    expect(body).toMatch(/const age = "leftoverBefore" in scope \? `&created_at=lt\.\$\{/);
    expect(body).toMatch(/like\.\$\{enc\}\$\{age\}/);
    expect(harness).toMatch(/export const LEFTOVER_AGE_MS = 6 \* 60 \* 60_000;/);
    const timeout = /prod-audit:[\s\S]*?timeout-minutes:\s*(\d+)/.exec(readFileSync(join(ROOT, ".github/workflows/prod-audit.yml"), "utf8"));
    expect(timeout, "prod-audit.yml job timeout not found").not.toBeNull();
    expect(6 * 60, "a leftover must be older than the longest prod-audit run").toBeGreaterThan(Number(timeout![1]));
  });

  it("every afterEach/afterAll cleanup is run-scoped; only beforeAll clears leftovers", () => {
    let calls = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/cleanupMarked\(\s*\w+\s*,\s*\w+\s*,\s*\{\s*(run|leftoverBefore)\b/g)) {
        calls++;
        const before = src.slice(0, m.index);
        const hook = [...before.matchAll(/test\.(beforeAll|beforeEach|afterEach|afterAll)\(/g)].pop()?.[1] ?? "test body";
        if (m[1] === "leftoverBefore" && hook !== "beforeAll") offenders.push(`${f}: leftover sweep in ${hook}`);
      }
      const unscoped = src.match(/cleanupMarked\(\s*\w+\s*,\s*\w+\s*\)/g) ?? [];
      offenders.push(...unscoped.map((u) => `${f}: ${u} with no scope`));
    }
    expect(calls, "almost no cleanupMarked calls found — the scan is broken").toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it("no spec deletes by the bare MARKER, and a file that cleans up by run writes only run-marked text", () => {
    const bare: string[] = [];
    for (const f of files) {
      const src = read(f);
      if (/encodeURIComponent\(`\*\$\{MARKER\}\*`\)/.test(src)) bare.push(`${f}: a like-pattern built from the bare MARKER`);
      if (f.endsWith(".spec.ts") && /cleanupMarked\([^)]*\{\s*run:/.test(src) && /`\$\{MARKER\} /.test(src)) bare.push(`${f}: writes \`\${MARKER} …\` text its run-scoped cleanup cannot remove`);
    }
    expect(bare).toEqual([]);
  });
});
