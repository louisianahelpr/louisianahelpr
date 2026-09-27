/**
 * #1582, press-every-control run 36208184593 (shard 2): storage requests went
 * from 1,657 (run 36069319716) to 14,095, storage answered 429 on
 * `/object/sign/proof-photos/…`, and that photo did not render. The poster's
 * job list signed every proof photo with its own `createSignedUrl` POST, on
 * every gallery mount, and never reused the ten-minute URL it had just been
 * handed.
 *
 * signProofPhotoUrls (src/lib/proofPhotoStorage.ts) now signs what it does not
 * hold in ONE createSignedUrls request, shares an in-flight batch between
 * galleries, and reuses a URL while half its life is left.
 *
 * CLASS, from the app's own source: nothing in src/ signs a proof photo one
 * path at a time (every proof-photo sign goes through the batched signer).
 *
 * @mutate src/lib/proofPhotoStorage.ts |   return hit && hit.expiresAt - now >= (expiresInSeconds * 1000) / 2 ? hit.url : null; |   return null;
 * @mutate src/lib/proofPhotoStorage.ts | !usable(p, expiresInSeconds, now) && !inFlight.has(p) | !usable(p, expiresInSeconds, now)
 * @mutate src/lib/proofPhotoStorage.ts |       .createSignedUrls(objectPaths, expiresInSeconds); |       .createSignedUrls(objectPaths.slice(0, 1), expiresInSeconds);
 * @mutate src/lib/proofPhotoStorage.ts |     if (startedIn !== generation) return; |     void startedIn;
 * @mutate src/lib/proofPhotoStorage.ts |     const batch = enqueue(toSign, expiresInSeconds) |     const batch = signBatch(toSign, expiresInSeconds, generation)
 * @mutate src/lib/proofPhotoStorage.ts |   pending.clear(); |   void 0;
 *
 * run 36275729414: one load of the poster's "done" tab still sent 84 sign
 * POSTs, one per gallery, because each gallery's photos were disjoint. Galleries
 * that mount together now share one request (queued for a short window).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const batches: string[][] = [];
let missing = new Set<string>();
let gate: Promise<void> | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          batches.push([...paths]);
          if (gate) await gate;
          return {
            data: paths.map((path) =>
              missing.has(path) ? { path, error: "Object not found", signedUrl: null } : { path, error: null, signedUrl: `https://signed.test/${path}` },
            ),
            error: null,
          };
        },
      }),
    },
  },
}));
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));

import { resetProofPhotoSignCache, signProofPhotoUrls } from "@/lib/proofPhotoStorage";

const ROOT = resolve(__dirname, "..", "..");
const J = "2eae4508-8db9-494a-b94b-3edbdf53d93a";
const p = (n: string) => `${J}/${n}.png`;

describe("proof photos are signed in batches and reused (#1582)", () => {
  beforeEach(() => {
    batches.length = 0;
    missing = new Set();
    gate = null;
    report.mockClear();
    resetProofPhotoSignCache();
  });

  it("six photos in a gallery cost one request, in order, duplicates once", async () => {
    const vals = [p("b1"), p("b2"), p("b3"), p("a1"), p("a2"), p("b1")];
    const out = await signProofPhotoUrls(vals);
    expect(batches).toEqual([[p("b1"), p("b2"), p("b3"), p("a1"), p("a2")]]);
    expect(out).toEqual(vals.map((v) => `https://signed.test/${v}`));
  });

  it("a second gallery mount inside the URL's life signs nothing", async () => {
    await signProofPhotoUrls([p("b1"), p("a1")]);
    await signProofPhotoUrls([p("b1"), p("a1")]);
    expect(batches).toHaveLength(1);
  });

  it("a batch still in flight at sign-out does not refill the cache (Q724)", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const before = signProofPhotoUrls([p("b1")]);
    resetProofPhotoSignCache(); // the previous account signs out mid-request
    gate = null;
    release();
    await before;
    await signProofPhotoUrls([p("b1")]);
    expect(batches).toHaveLength(2);
  });

  it("two galleries asking at once share one request", async () => {
    await Promise.all([signProofPhotoUrls([p("b1"), p("a1")]), signProofPhotoUrls([p("a1"), p("b1")])]);
    expect(batches).toHaveLength(1);
  });

  it("galleries with DIFFERENT photos mounting together share one request (run 36275729414)", async () => {
    const galleries = Array.from({ length: 40 }, (_, i) => [p(`b${i}`), p(`a${i}`)]);
    const outs = await Promise.all(galleries.map((g) => signProofPhotoUrls(g)));
    expect(batches).toHaveLength(1);
    expect(outs[39]).toEqual([`https://signed.test/${p("b39")}`, `https://signed.test/${p("a39")}`]);
  });

  it("a gallery mounting while the request is already on the wire joins it", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const first = signProofPhotoUrls([p("b1")]);
    await new Promise((r) => setTimeout(r, 60)); // window flushed, request pending
    expect(batches).toHaveLength(1);
    const second = signProofPhotoUrls([p("b1")]);
    release();
    await Promise.all([first, second]);
    expect(batches).toHaveLength(1);
  });

  it("a very large window is split into chunks of at most 100 paths", async () => {
    const vals = Array.from({ length: 250 }, (_, i) => p(`x${i}`));
    await signProofPhotoUrls(vals);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("a queued, not yet sent window is dropped at sign-out", async () => {
    const before = signProofPhotoUrls([p("q1")]);
    resetProofPhotoSignCache();
    const after = signProofPhotoUrls([p("q2")]);
    await Promise.all([before, after]);
    // q2 opened a fresh window; the old window still flushes on its own but
    // cannot write its URLs back (generation check), so exactly q1 and q2 are
    // separate requests and nothing from before sign-out is merged into q2's.
    expect(batches).toContainEqual([p("q2")]);
  });

  it("a missing object is null and reported; its neighbours still render", async () => {
    missing = new Set([p("gone")]);
    const out = await signProofPhotoUrls([p("b1"), p("gone")]);
    expect(out).toEqual([`https://signed.test/${p("b1")}`, null]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a legacy absolute URL that names no object passes through; data: is never signed", async () => {
    const out = await signProofPhotoUrls(["https://example.invalid/x.png", "data:image/png;base64,AA"]);
    expect(out).toEqual(["https://example.invalid/x.png", null]);
    expect(batches).toEqual([]);
  });

  it("nothing in src/ signs a proof photo one path at a time", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const q = join(d, f);
        if (statSync(q).isDirectory()) walk(q);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(q);
      }
    };
    walk(resolve(ROOT, "src"));
    const signers = files.filter((f) => /proof-photos|PROOF_PHOTOS_BUCKET/.test(blankComments(readFileSync(f, "utf8"))) && /\.createSignedUrls?\(/.test(blankComments(readFileSync(f, "utf8"))));
    // Inventory floor, measured 2026-09-26: src/lib/proofPhotoStorage.ts.
    expect(signers.length).toBeGreaterThanOrEqual(1);
    const single = signers.filter((f) => /\.createSignedUrl\(/.test(blankComments(readFileSync(f, "utf8"))));
    expect(single.map((f) => f.replace(ROOT + "/", ""))).toEqual([]);
  });
});
