/*
 * CLASS GUARD: a shared-checkout rebuild must never be reported as a product
 * defect.
 *
 * The cost of not having this, measured 2026-09-22: a lane chased a 1-in-20
 * "inbox row never paints" failure through ConversationList's row layout, the
 * Active-tab filter, loadConversations' jobTitle/jobStatus plumbing, the
 * virtualizer's scrollMargin and the unread-jump rAF — all of it unreachable,
 * because `document.body.textContent` was `""` and the app had never mounted.
 * Another lane had run `npm run build` in the same checkout; `vite build`
 * empties outDir, so the live preview began 404ing the chunks the loaded
 * index.html named, chunkReload fired its `?_v=` recovery, and THAT 404'd too.
 *
 * `assertFreshBundle` is the right check and was already wired in — but it is
 * `let checked = false; if (checked) return;`, once per worker. It proves the
 * bundle was fresh when the worker STARTED and is blind to one that dies
 * mid-run. Re-running it per test would not help either: once the rebuild
 * finishes, disk and server agree again and the hashes match, while the page
 * loaded before it stays dead. That is why this keys on the SYMPTOM instead.
 */

import { describe, it, expect } from "vitest";
import { rebuiltUnderUsMessage } from "./staleBundle";

const CHUNKS = [
  "/assets/app-shared-IgrYbgHw.js",
  "/assets/react-vendor-CvO076g8.js",
  "/assets/lucide-XPUjrC3x.js",
];
const RECOVERY = ["http://127.0.0.1:4191/messages?_v=1790102794858"];

describe("a rebuilt dist is explained, not mistaken for a defect", () => {
  it("says nothing at all when the run was clean", () => {
    // THE IMPORTANT HALF. Every passing test and every genuine product failure
    // goes down this branch; if it ever starts returning a message, the suite
    // grows a blanket excuse that hides real defects.
    expect(rebuiltUnderUsMessage({ lostChunks: [], recoveries: [] })).toBeNull();
  });

  it("explains a run where chunks 404'd", () => {
    const m = rebuiltUnderUsMessage({ lostChunks: CHUNKS, recoveries: [] });
    expect(m).toBeTruthy();
    expect(m).toContain("NOT A PRODUCT DEFECT");
    expect(m).toContain("BLANK DOCUMENT");
    for (const c of CHUNKS) expect(m).toContain(c);
  });

  it("explains a run where only the app's own recovery fired", () => {
    // The 404s happen in a frame that is then navigated away from, so a run can
    // surface the recovery without the response events. Either alone is proof.
    const m = rebuiltUnderUsMessage({ lostChunks: [], recoveries: RECOVERY });
    expect(m).toBeTruthy();
    expect(m).toContain("_v=1790102794858");
    expect(m).toContain("chunkReload.ts");
  });

  it("names assertFreshBundle's blind spot, so nobody re-derives it", () => {
    const m = rebuiltUnderUsMessage({ lostChunks: CHUNKS, recoveries: RECOVERY })!;
    expect(m).toContain("once per worker");
    expect(m).toContain("vite build");
    // The actionable next step, not just a diagnosis.
    expect(m).toContain("your own port");
  });

  it("truncates a long chunk list instead of burying the message", () => {
    const many = Array.from({ length: 10 }, (_, i) => `/assets/chunk-${i}.js`);
    const m = rebuiltUnderUsMessage({ lostChunks: many, recoveries: [] })!;
    expect(m).toContain("and 4 more");
    expect(m).not.toContain("/assets/chunk-9.js");
  });
});

// Proof this is able to fail.
// @mutate src/test/staleBundle.ts | if (lostChunks.length === 0 && recoveries.length === 0) return null; | if (lostChunks.length >= 0) return null;
// @mutate src/test/staleBundle.ts | xs.slice(0, n).map((x) => "    " + x) | xs.slice(0, 99).map((x) => "    " + x)
