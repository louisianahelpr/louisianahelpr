// THE PRESS HARNESS MUST WAIT FOR A LOADING STATE THAT IS ONLY WORDS, AND FOR
// THE WHOLE LOAD, NOT ITS FIRST QUIET INSTANT.
//
// nightly-red #2353 (press run 37296257389, shard 8, /admin?view=people as
// admin): three user rows failed "control not found on a freshly loaded page".
// settle() counted only LOADING_SEL (aria-busy / pulse / shimmer) and returned
// at the first instant that held none. Measured against prod 2026-10-05: a
// cold load of that screen shows a bare shell for 130-245ms between two
// "Loading…" stages, then `<p>Loading users…</p>` (no marker at all), so the
// rows were re-read while their per-row summaries were still pending and
// "Audit W. … 1 completed …" no longer matched its own identity.
//
// Fixed in scripts/audit/pressLoadHealth.mjs: countLoadingMarkers also counts a
// text-only "Loading …" line, and awaitLoadingQuiet needs zero markers for the
// whole quiet window. The inventory below is every such placeholder in src/.
//
// @mutate scripts/audit/pressLoadHealth.mjs | if (rx.test((el.textContent | if (false && rx.test((el.textContent
// @mutate scripts/audit/pressLoadHealth.mjs | if (now() - quietSince >= quietMs) return | if (true) return
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";

import {
  LOADING_SEL,
  LOADING_TEXT_RX_SOURCE,
  awaitLoadingQuiet,
  countLoadingMarkers,
} from "../../scripts/audit/pressLoadHealth.mjs";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

/** Every JSX text node in src/ that is a "Loading …" placeholder. */
function loadingPlaceholders(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of walkSource(["src"], [".tsx"])) {
    if (/\.test\.tsx$/.test(file) || file.startsWith("src/test/")) continue;
    const src = blankComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/>\s*(Loading[^<>{}]*?(?:…|\.\.\.))\s*</g)) {
      out.push({ file, text: m[1].replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

const markers = () => countLoadingMarkers([LOADING_SEL, LOADING_TEXT_RX_SOURCE]);

describe("#2353: settle() sees a text-only loading line", () => {
  const inventory = loadingPlaceholders();

  it("the inventory is real (built from src/, includes the #2353 screen)", () => {
    expect(inventory.length).toBeGreaterThan(15);
    expect(inventory.some((p) => p.file.endsWith("AdminUsers.tsx") && p.text === "Loading users…")).toBe(true);
  });

  it("every placeholder in src/ counts as a loading marker, which LOADING_SEL alone missed", () => {
    const missed: string[] = [];
    for (const { file, text } of inventory) {
      const { container, unmount } = render(<main><h1>Users</h1><p className="text-muted-foreground">{text}</p></main>);
      // The old settle() looked only at LOADING_SEL: it saw nothing here.
      expect(container.querySelectorAll(LOADING_SEL).length).toBe(0);
      if (markers() === 0) missed.push(`${file}: ${text}`);
      unmount();
    }
    expect(missed).toEqual([]);
  });

  it("a settled screen holds no marker (no false 'still loading')", () => {
    render(<main><h1>Users</h1><p>Loading is done when the list shows.</p><p>59 total users</p></main>);
    expect(markers()).toBe(0);
  });
});

describe("#2353: settle() waits for a quiet WINDOW, not a quiet instant", () => {
  /** A fake page whose probe returns `seq` in turn, on a fake clock of `step` ms per poll. */
  const fakePage = (seq: number[], step = 50) => {
    let t = 0;
    let i = 0;
    return {
      now: () => t,
      page: {
        evaluate: async () => seq[Math.min(i++, seq.length - 1)],
        waitForTimeout: async (ms: number) => {
          t += ms || step;
        },
      },
    };
  };

  it("a 150ms bare-shell gap between two loading stages does not end the wait", async () => {
    // loading, 3 quiet polls (150ms gap, as measured), loading again, then quiet for good.
    const seq = [2, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { page, now } = fakePage(seq);
    const r = await awaitLoadingQuiet(page, { probe: "x", quietMs: 600, timeoutMs: 8600, pollMs: 50, now });
    expect(r.quiet).toBe(true);
    // Returned only after the SECOND quiet run lasted 600ms: polls 6..18.
    expect(r.waitedMs).toBeGreaterThanOrEqual(6 * 50 + 600);
  });

  it("a screen that never stops loading is bounded and reported", async () => {
    const { page, now } = fakePage([1]);
    const r = await awaitLoadingQuiet(page, { probe: "x", quietMs: 600, timeoutMs: 8600, pollMs: 50, now });
    expect(r).toEqual({ quiet: false, waitedMs: 8600 });
  });

  it("a probe that throws (navigation in flight) counts as loading", async () => {
    let n = 0;
    let t = 0;
    const page = {
      evaluate: async () => {
        if (n++ < 3) throw new Error("Execution context was destroyed");
        return 0;
      },
      waitForTimeout: async (ms: number) => {
        t += ms;
      },
    };
    const r = await awaitLoadingQuiet(page, { probe: "x", quietMs: 200, timeoutMs: 5000, pollMs: 50, now: () => t });
    expect(r.quiet).toBe(true);
    expect(r.waitedMs).toBeGreaterThanOrEqual(3 * 50 + 200);
  });

  it("press-every-control's settle() is built on both", () => {
    const src = readFileSync("scripts/audit/press-every-control.mjs", "utf8");
    const at = src.indexOf("const settle = async");
    const settle = src.slice(at, src.indexOf("\n      };", at));
    expect(settle).toContain("awaitLoadingQuiet(");
    expect(settle).toContain("countLoadingMarkers");
    expect(settle).toContain("LOADING_TEXT_RX_SOURCE");
    expect(settle).toContain("quietMs: SETTLE_MS");
  });
});
