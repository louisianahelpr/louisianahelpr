/**
 * CLASS GUARD (docs/OPEN.md Q511): a store that keeps a local mirror of a
 * server table and "merges up" on load must push only what THIS device
 * changed and never saw confirmed. Pushing every key the device holds that the
 * server does not is how a Restore on one device was undone by another: the
 * second device's stale mirror re-archived the thread on its next load, and
 * it was hidden again everywhere.
 *
 * THE CLASS is derived from source: every module under src/lib that both
 * persists through safeStorage (a local mirror) and writes with `.upsert(`
 * (a merge-up). Each must decide what to push through a pending set (the
 * archive store's `planMergeUp`), or be on KNOWN_PUSHES_ALL with the queue
 * item that fixes it. KNOWN_PUSHES_ALL is exact in both directions.
 *
 * The rule itself is tested as a pure function: no network, no mock.
 *
 * @mutate src/lib/archivedConversations.ts |     if (pending.has(k)) push.push(k);\n    else drop.push(k); |     push.push(k);
 * @mutate src/lib/archivedConversations.ts |   for (const k of plan.push) localOnly.set(k, canonicalLocal.get(k)!); |   for (const [k, e] of canonicalLocal) if (!(k in server)) localOnly.set(k, e);
 * @mutate src/lib/archivedConversations.ts |   setPending(userId, key, true); |   void 0;
 * @mutate src/lib/archivedConversations.ts |   setPending(userId, key, false);\n  emitArchiveChanged();\n\n  void (async () => {\n    const base | emitArchiveChanged();\n\n  void (async () => {\n    const base
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { planMergeUp } from "@/lib/archivedConversations";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Mirror stores whose merge-up still pushes every local-only key.
// @two-way src/test/mirrorMergeUpPushesOnlyPending.test.ts:KNOWN_PUSHES_ALL lists a store that now pushes only pending keys
const KNOWN_PUSHES_ALL: Record<string, string> = {
  "src/lib/pinnedConversations.ts": "unpin on one device is re-pinned by another device's mirror; Q512",
};

function mirrorStores(): string[] {
  const dir = join(ROOT, "src", "lib");
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.ts$/.test(f) || /\.test\.ts$/.test(f)) continue;
    const rel = relative(ROOT, join(dir, f));
    const src = blankComments(read(rel));
    if (/\bsafeStorage\b/.test(src) && /\.upsert\(/.test(src)) out.push(rel);
  }
  return out.sort();
}

describe("a mirror merge-up pushes only this device's unconfirmed changes (Q511)", () => {
  const stores = mirrorStores();

  it("finds the mirror stores", () => {
    expect(stores.length).toBeGreaterThan(1);
    expect(stores).toContain("src/lib/archivedConversations.ts");
  });

  it("each store pushes through a pending set, or is a known, queued exception (exact both ways)", () => {
    const pushesOnlyPending = (rel: string) => {
      const src = blankComments(read(rel));
      return /planMergeUp\(/.test(src) && /readPending\(/.test(src);
    };
    const bad = stores.filter((s) => !pushesOnlyPending(s) && !(s in KNOWN_PUSHES_ALL));
    expect(bad, "a mirror store re-pushes keys another device removed: push only pending keys").toEqual([]);
    const stale = Object.keys(KNOWN_PUSHES_ALL).filter((s) => !stores.includes(s) || pushesOnlyPending(s));
    expect(stale, "KNOWN_PUSHES_ALL lists a store that now pushes only pending keys: remove it").toEqual([]);
  });

  it("the rule: a restore elsewhere sticks; an unconfirmed archive here is still sent", () => {
    const A = "j1_u1"; // confirmed earlier, then restored on another device
    const B = "j2_u2"; // archived here offline, never confirmed
    const C = "j3_u3"; // on the server too
    const plan = planMergeUp([A, B, C], new Set([C]), new Set([B]));
    expect(plan.drop).toEqual([A]);
    expect(plan.push).toEqual([B]);
    expect(plan.confirmed).toEqual([]);
    // A pending write that landed (response lost) is confirmed, not re-sent.
    const landed = planMergeUp([B], new Set([B]), new Set([B]));
    expect(landed).toEqual({ push: [], drop: [], confirmed: [B] });
  });

  it("the archive store wires it: archive marks pending, restore clears it, load pushes only plan.push", () => {
    const src = blankComments(read("src/lib/archivedConversations.ts"));
    const archive = src.slice(src.indexOf("export function archiveConversation"), src.indexOf("export function unarchiveConversation"));
    const restore = src.slice(src.indexOf("export function unarchiveConversation"), src.indexOf("export function isArchived"));
    expect(archive.length).toBeGreaterThan(100);
    expect(restore.length).toBeGreaterThan(100);
    expect(archive).toMatch(/setPending\(userId, key, true\)/);
    expect(archive).toMatch(/if \(!error\) setPending\(userId, key, false\)/);
    expect(restore).toMatch(/setPending\(userId, key, false\)/);
    expect(src).toMatch(/for \(const k of plan\.push\) localOnly\.set\(k, canonicalLocal\.get\(k\)!\);/);
  });
});
