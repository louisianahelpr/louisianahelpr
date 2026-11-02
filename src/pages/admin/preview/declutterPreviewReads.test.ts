/**
 * Audit 1102c P7 (Q2625): the preview's toasts called reads writes, in broken grammar ("Preview: this would checkout
 * porch days", "this would my free pause"). A read RPC the sample does not answer now says "Preview: not loaded
 * (<name>)"; only a write or action says "this would ...". Both are still answered without being sent.
 *
 * Which RPCs are reads is not guessed from names: DECLUTTER_PREVIEW_READ_RPCS must equal, exactly, the RPCs the
 * Declutter folders call that every migration declares STABLE or IMMUTABLE (scripts/audit/declaredReadRpcs.mjs;
 * Postgres refuses a write inside one). A new Declutter read, or a read made VOLATILE, fails here until the list follows.
 *
 * @mutate src/pages/admin/preview/declutterPreviewBackend.ts | DECLUTTER_PREVIEW_READ_RPCS.has(name) ? "read" : "write" | "write"
 * @mutate src/pages/admin/preview/declutterPreviewReads.ts |   return kind === "read" ? `Preview: not loaded (${what}).` : `Preview: this would ${what}.`; |   return `Preview: this would ${what}.`;
 * @mutate src/pages/admin/preview/declutterPreviewReads.ts |   "declutter_admin_open_problems", |   "declutter_respond_offer", "declutter_admin_open_problems",
 * @mutate src/pages/admin/preview/declutterPreviewReads.ts |   "declutter_admin_open_problems", |
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { declaredReadRpcSet } from "../../../../scripts/audit/declaredReadRpcs.mjs";
import { createDeclutterPreviewFetch } from "./declutterPreviewBackend";
import { DECLUTTER_PREVIEW_READ_RPCS, previewBlockedWords } from "./declutterPreviewReads";
import { declutterPreviewSample } from "./declutterPreviewSamples";

const FOLDERS = ["src/lib/declutter/", "src/components/declutter/", "src/lib/helprTasks/"];
const BASE = "https://unit.supabase.co";
const ADMIN = "00000000-0000-4000-a000-000000000001";

/** Every supabase.rpc("name") the Declutter folders' source calls (comments blanked). */
function declutterRpcs(): string[] {
  const names = new Set<string>();
  for (const f of trackedFiles("src")) {
    if (!FOLDERS.some((d) => f.startsWith(d)) || !/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
    const src = blankComments(readFileSync(join(process.cwd(), f), "utf8"));
    for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

describe("Q2625: the preview tells a blocked read from a blocked write", () => {
  it("the read list is exactly the Declutter folders' RPCs declared STABLE or IMMUTABLE", () => {
    const called = declutterRpcs();
    const declared = declaredReadRpcSet();
    expect(called.length).toBeGreaterThan(150);
    expect(declared.size).toBeGreaterThan(400);
    const reads = called.filter((n) => declared.has(n));
    expect(reads.length).toBeGreaterThan(70);
    expect([...DECLUTTER_PREVIEW_READ_RPCS].sort()).toEqual(reads);
  });

  it("an unanswered read RPC is reported as a read, a write RPC as a write; neither is sent", async () => {
    const realFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const blocked: [string, string][] = [];
    const sample = declutterPreviewSample("paid", "buyer", ADMIN, Date.parse("2026-11-02T12:00:00Z"));
    const { fetch } = createDeclutterPreviewFetch({
      supabaseUrl: BASE, sample: () => sample, ownUserId: () => ADMIN,
      realFetch: realFetch as unknown as typeof globalThis.fetch, onBlocked: (w, k) => blocked.push([w, k]),
    });
    expect(DECLUTTER_PREVIEW_READ_RPCS.has("declutter_price_hint")).toBe(true);
    expect(DECLUTTER_PREVIEW_READ_RPCS.has("declutter_set_watch")).toBe(false);
    for (const name of ["declutter_price_hint", "declutter_set_watch"]) {
      await fetch(`${BASE}/rest/v1/rpc/${name}`, { method: "POST", body: "{}" });
    }
    expect(blocked).toEqual([["price hint", "read"], ["set watch", "write"]]);
    expect(realFetch).not.toHaveBeenCalled();
    // The page's toast words for each kind.
    expect(previewBlockedWords("price hint", "read")).toBe("Preview: not loaded (price hint).");
    expect(previewBlockedWords("set watch", "write")).toBe("Preview: this would set watch.");
  });
});
