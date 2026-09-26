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
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const batches: string[][] = [];
let missing = new Set<string>();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          batches.push([...paths]);
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

  it("two galleries asking at once share one request", async () => {
    await Promise.all([signProofPhotoUrls([p("b1"), p("a1")]), signProofPhotoUrls([p("a1"), p("b1")])]);
    expect(batches).toHaveLength(1);
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
