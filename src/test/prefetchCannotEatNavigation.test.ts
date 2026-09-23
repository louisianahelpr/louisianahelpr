import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __resetChunkReloadForTests,
  beginSpeculativePrefetch,
  isSpeculativePrefetchInFlight,
} from "@/lib/chunkReload";

/**
 * THE CLASS: a speculative route prefetch that can trigger the destructive
 * stale-chunk recovery reload, and so eat the navigation the user asked for.
 *
 * `hardReloadBypassCache` (src/lib/chunkReload.ts) ends with
 * `location.replace(href + "&_v=<now>")` — it reloads whatever page is CURRENT,
 * i.e. the page being LEFT. WebKit cancels the old document's in-flight
 * requests once a new navigation starts, and a cancelled module preload raises
 * `vite:preloadError`. So the user's own navigation cancels a prefetch, the
 * cancellation is misread as a stale deploy, and the recovery reload replaces
 * the destination with the origin.
 *
 * REPRODUCED AS A REAL USER in WebKit, 2026-09-22
 * (scripts/repro-chunk-nav-eaten.mjs): hover a real footer link on `/` so the
 * real `prefetchRoute` fires, serve that chunk slowly (bad LTE), then run the
 * app's own money hand-off — `window.location.href = url`,
 * openExternalUrl.ts:45, the web branch of all 14 Stripe hand-offs — to a
 * destination that takes a few seconds, as a cold Stripe redirect does.
 * Result: `landedOnDestination: false`, final URL `/?_v=1790102063790`. The
 * user tapped through to pay and was returned to the page they started on.
 *
 * WHY THE GUARD IS SHAPED THIS WAY, AND WHY NOTHING WEAKER WORKS:
 *  - The cancelled preload's message is "Importing a module script failed.",
 *    byte-for-byte what a genuinely 404'd stale chunk raises. Message sniffing
 *    cannot separate them; a fix built on it would be a coin flip.
 *  - So the discriminator is PROVENANCE, not payload: a prefetch is warming a
 *    route the user has not asked for. Declining recovery for it defers
 *    nothing that matters — a genuinely stale chunk still fails, and still
 *    recovers, when the user actually navigates to that route.
 *
 * This file is what keeps the gate installed, keeps it NARROW (speculative
 * prefetches only — never the user's own route load), and keeps it LEAK-FREE
 * (a count that never settles would suppress recovery forever, which is the
 * one way this gate could become more dangerous than the hole).
 */

// The gate is one line and invisible: remove it and the money hand-off is
// eaten again, exactly as in the 2026-09-22 WebKit repro.
// @mutate src/lib/chunkReload.ts | if (isSpeculativePrefetchInFlight()) return;\n  if (isLateBackgroundImportPending()) { | if (false) return;\n  if (isLateBackgroundImportPending()) {
// @mutate src/main.tsx | handleVitePreloadError(event); | void event;
// The prefetch must actually REGISTER as speculative. Drop the registration
// and the gate is permanently closed — the flag never goes true.
// @mutate src/lib/routePrefetch.ts | const settle = beginSpeculativePrefetch(); | const settle = () => {};
// The count must settle on the REJECTION path too. `.finally` → `.then` leaks
// a count on every failed prefetch, and a leaked count suppresses every
// genuine recovery from then on — worse than the hole this closes.
// @mutate src/lib/routePrefetch.ts | .finally(settle); | .then(settle);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a speculative prefetch cannot eat the user's navigation", () => {
  beforeEach(() => __resetChunkReloadForTests());

  // Since Q170 the listener's body lives in chunkReload.ts as
  // handleVitePreloadError, so tests can drive it; main.tsx only registers it.
  const handlerBody = () => {
    const src = read("src/lib/chunkReload.ts");
    const start = src.indexOf("export const handleVitePreloadError");
    expect(start, "handleVitePreloadError is missing from chunkReload.ts").toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n};", start));
  };

  it("main.tsx routes vite:preloadError through handleVitePreloadError", () => {
    const main = read("src/main.tsx");
    expect(
      /addEventListener\("vite:preloadError",[\s\S]*?handleVitePreloadError\(event\);\s*\}\);/.test(main),
      "main.tsx no longer hands vite:preloadError to handleVitePreloadError, so the speculative-prefetch gate is not on the recovery path",
    ).toBe(true);
  });

  it("the handler declines recovery while a speculative prefetch is in flight", () => {
    expect(
      /if\s*\(\s*isSpeculativePrefetchInFlight\(\)\s*\)\s*return;/.test(handlerBody()),
      "handleVitePreloadError no longer gates recovery on isSpeculativePrefetchInFlight(), so a prefetch cancelled by the user's own navigation can again replace their destination with the page they were leaving",
    ).toBe(true);
  });

  it("the gate is checked BEFORE recovery is attempted, not after", () => {
    const body = handlerBody();
    const gate = body.indexOf("isSpeculativePrefetchInFlight()");
    const recover = body.indexOf("recoverFromChunkError()", gate);
    expect(gate, "the speculative-prefetch gate is missing from handleVitePreloadError").toBeGreaterThan(-1);
    expect(
      recover,
      "recoverFromChunkError() no longer runs after the gate — the gate cannot protect a call that already happened",
    ).toBeGreaterThan(gate);
  });

  it("routePrefetch registers every speculative import and settles it", () => {
    const rp = read("src/lib/routePrefetch.ts");
    expect(
      /const settle = beginSpeculativePrefetch\(\);/.test(rp),
      "routePrefetch no longer registers its imports as speculative, so the gate can never engage",
    ).toBe(true);
    // `.finally` and not `.then`: a failed prefetch is exactly the case that
    // must still decrement, and it is also the common one.
    expect(
      /\.finally\(settle\)/.test(rp),
      "routePrefetch settles the speculative count somewhere other than .finally — a rejected prefetch would leak a count and suppress every later genuine recovery",
    ).toBe(true);
  });

  it("the flag is false at rest, true only while a prefetch is outstanding", () => {
    expect(isSpeculativePrefetchInFlight()).toBe(false);
    const settle = beginSpeculativePrefetch();
    expect(isSpeculativePrefetchInFlight()).toBe(true);
    settle();
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });

  it("nested prefetches only clear once ALL of them have settled", () => {
    const a = beginSpeculativePrefetch();
    const b = beginSpeculativePrefetch();
    a();
    expect(
      isSpeculativePrefetchInFlight(),
      "one settled prefetch cleared the flag while another was still in flight",
    ).toBe(true);
    b();
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });

  it("a settle called twice cannot drive the count negative and wedge the gate open", () => {
    const a = beginSpeculativePrefetch();
    const b = beginSpeculativePrefetch();
    a();
    a();
    a();
    expect(
      isSpeculativePrefetchInFlight(),
      "a double-settled prefetch drove the count below zero, so the still-outstanding prefetch stopped counting",
    ).toBe(true);
    b();
    expect(isSpeculativePrefetchInFlight()).toBe(false);
  });

  it("recovery is NOT gated on anything but speculation — the user's own chunk load still recovers", () => {
    // The gate must be the speculative flag alone. Widening it to, say, any
    // in-flight import would suppress the genuine stale-deploy recovery this
    // whole module exists for. (The Q170 late-background branch below it does
    // not decline an unrelated chunk: backgroundImport.test.ts proves that.)
    const gateLine = handlerBody()
      .split("\n")
      .find((l) => l.includes("isSpeculativePrefetchInFlight()")) ?? "";
    expect(
      /^\s*if\s*\(\s*isSpeculativePrefetchInFlight\(\)\s*\)\s*return;\s*$/.test(gateLine),
      `the recovery gate has grown extra conditions (${gateLine.trim()}) — it must decline for speculative prefetches and nothing else`,
    ).toBe(true);
  });
});
