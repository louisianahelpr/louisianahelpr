import { test, expect, devices } from "./prodTest";
import { LOCAL_BASE_URL } from "./localBase";

// Mobile viewport spot-check, replaces what humans had to do by hand
// during the 2026-05-09 QA pass (Cowork couldn't shrink Chrome below
// 856px because the in-browser extension panel reserved the rest of
// the window).
//
// This suite covers the 5 viewport widths the original test plan called
// out: 320, 375, 414 (iPhones), 768, 1024 (iPad / iPad Pro). For each:
//   - assert no horizontal scroll (both ways: documentElement.scrollWidth, and
//     per-element rects, because body{overflow-x:hidden} hides the first one)
//   - assert no uncaught JS error on render
//   - take a screenshot for visual review (uploaded as a CI artifact)
//
// TWO CLAIMS REMOVED FROM THIS LIST 2026-09-21, because the suite never made
// them and the list saying it did was the whole problem:
//
//   "the bottom-nav post-job FAB is reachable + not clipped" — there is NO
//   assertion about a FAB anywhere in this file, and never was. The words
//   survived only in this comment and in all 20 test NAMES ("… FAB reachable"),
//   which is worse than a missing check: a green run reported a guarantee that
//   did not exist. The pages here are public-only and the post-job FAB is
//   gated behind a session, so the check could not be written as stated
//   either. Renamed rather than faked; if the guest nav has a reachability
//   contract worth asserting, it wants a spec that can see a session.
//
//   "the landing-page hero phone-cluster doesn't escape" — that test existed,
//   targeted a component that has since been deleted, and had been SKIPPING on
//   all five viewports. Removed; see the note where it used to live.
//
// Pages tested are public-only — /dashboard etc. need an auth session
// which lives in a different test (post-and-apply.spec.ts). The
// landing page (`/`) and `/browse` are the two highest-value mobile
// surfaces because they're what every prospective user first sees.

// This checkout's local build, never the deployed site (e2e/localBase.ts).
const BASE_URL = LOCAL_BASE_URL;

// Viewport set per the original test plan. Names mirror the spec doc
// so failures map back to the exact device the bug reproduces on.
const VIEWPORTS = [
  { name: "iPhone-SE-original-320x568",  width: 320,  height: 568  },
  { name: "iPhone-SE-2nd-3rd-375x667",   width: 375,  height: 667  },
  { name: "iPhone-11-Pro-Max-414x896",   width: 414,  height: 896  },
  { name: "iPad-portrait-768x1024",      width: 768,  height: 1024 },
  { name: "iPad-Pro-portrait-1024x1366", width: 1024, height: 1366 },
] as const;

// Pages each viewport is exercised against. Pure-public routes only —
// /dashboard etc. live in post-and-apply.spec.ts.
const PAGES: { path: string; label: string }[] = [
  { path: "/",       label: "landing"   },
  { path: "/browse", label: "browse"    },
  { path: "/login",  label: "login"     },
  { path: "/signup", label: "signup"    },
];

// ──────────────────────────────────────────────────────────────────
// Per-viewport project — each row in `projects` becomes its own Playwright
// project, runs in parallel in CI, and emits its own screenshot folder.
// We can't easily declare these dynamically inside playwright.config.ts
// without invasive changes to the existing config, so this spec sets the
// viewport at runtime via test.use() inside the describe block.
// ──────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`mobile spot-check @ ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      // Use Mobile Safari user-agent on the iPhone widths so any
      // UA-sniffing branches in the SPA pick the iOS code path.
      userAgent: vp.width <= 414
        ? devices["iPhone 12"].userAgent
        : devices["iPad (gen 7)"].userAgent,
    });

    // Shown able to fail on Assertion 2 — an uncaught error on render, which is
    // what 20 public page-loads are for. A null dereference in the landing hero
    // is exactly that class, and it fails the landing legs at every viewport.
    //
    // NOT the overflow assertion, and the reason is worth keeping. A 1400px
    // element forced into the hero wrapper was `killed` while the element check
    // was naive and went back to SURVIVED once the check learned to skip
    // x-clipping ancestors (see Assertion 1b) — because that overflow IS inside
    // one, and this repo deliberately treats clipped wide elements as correct
    // (`clippedWideElements` in auditRoutes.ts, reported and not failed). So the
    // first verdict was measuring a case the codebase does not call a defect.
    // @mutate src/components/landing/HeroSection.tsx |   const [loggedIn, setLoggedIn] = useState(false); |   const [loggedIn, setLoggedIn] = useState(false);\n  (null as unknown as { boom(): void }).boom();
    for (const page of PAGES) {
      test(`${page.label} — no horizontal scroll, no JS error`, async ({ page: p }) => {
        const errors: string[] = [];
        p.on("pageerror", (err) => errors.push(err.message));

        await p.goto(`${BASE_URL}${page.path}`, { waitUntil: "domcontentloaded" });

        // Settle the SPA: wait for the React tree to mount + first paint.
        await p.locator("body").waitFor({ state: "visible", timeout: 10_000 });
        await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
          // Some routes hold a long-poll connection open (Supabase realtime).
          // domcontentloaded + body-visible above is enough — networkidle is
          // a nice-to-have, not a gate.
        });

        // ── Assertion 1: no horizontal scroll ──────────────────────
        // body.scrollWidth > window.innerWidth → the page overflows
        // the viewport horizontally, which is the #1 mobile-layout bug.
        const horizontalOverflow = await p.evaluate(() => {
          const scrollW = document.documentElement.scrollWidth;
          const innerW = window.innerWidth;
          return { scrollW, innerW, overflow: scrollW > innerW };
        });
        expect(
          horizontalOverflow.overflow,
          `Horizontal overflow on ${page.label} @ ${vp.width}px: ` +
          `scrollWidth=${horizontalOverflow.scrollW}, innerWidth=${horizontalOverflow.innerW}`,
        ).toBe(false);

        // ── Assertion 1b: nothing sticks out past the right edge ───
        //
        // Assertion 1 above cannot see most overflow, and it is worth being
        // precise about why. `src/index.css` sets `body { overflow-x: hidden }`
        // on purpose, to absorb the 1-2px that the .full-bleed -50vw trick can
        // spill. That clip also suppresses the SYMPTOM this spec measures:
        // documentElement.scrollWidth stops growing, so content that really is
        // off the side of the phone reports as fitting.
        //
        // Measured 2026-09-21: forcing a 1400px-wide element into the landing
        // hero at a 320px viewport left Assertion 1 GREEN on all five
        // viewports. The content was off-screen and unreachable; the metric
        // said the page fit.
        //
        // CLAUDE.md is not wrong about this and needs no change — its
        // proof-of-fit rule has TWO clauses: "assert documentElement.scrollWidth
        // <= clientWidth, no element wider than the viewport". The second clause
        // is the one that does the work in this codebase, and this spec had
        // implemented only the first.
        //
        // So measure the ELEMENTS — a bounding rect is unaffected by an
        // ancestor's clip. This is NOT a new technique in this repo, and the
        // commit that added it here overstated the scope: `measureLayout` in
        // e2e/happy-path/auditRoutes.ts already reports `overflowOffenders`
        // for exactly this reason (its comment names the same CSS), and both
        // the empty-state and error-state sweeps assert on it. The blind spot
        // was THIS spec and visual-audit/responsive.spec.ts's sibling metric,
        // not the repo. Bringing this file up to the standard the sweeps
        // already set.
        //
        // Scoped to text-bearing and interactive nodes, because those are the
        // ones a user actually loses; +2px absorbs sub-pixel rounding.
        const offCanvas = await p.evaluate(() => {
          const viewportW = window.innerWidth;
          const out: string[] = [];
          // An ancestor that legitimately clips or SCROLLS on x makes a child
          // past the right edge correct — a side-scrolling tab strip is the
          // common case. Same walk measureLayout uses for clippedWideElements;
          // without it, /my-posts@320 reports its overflow-x-auto strip's last
          // tab (right=326 of 320) as a defect.
          const clipped = (e: Element): boolean => {
            let p2 = e.parentElement;
            while (p2 && p2 !== document.body && p2 !== document.documentElement) {
              const ox = getComputedStyle(p2).overflowX;
              if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
              p2 = p2.parentElement;
            }
            return false;
          };
          const nodes = Array.from(
            document.querySelectorAll<HTMLElement>(
              "button, a, input, textarea, select, [role=button], h1, h2, h3, p, li, label",
            ),
          );
          for (const el of nodes) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const st = getComputedStyle(el);
            if (st.visibility === "hidden" || st.display === "none") continue;
            if (clipped(el)) continue;
            if (r.right > viewportW + 2 && r.left < viewportW) {
              out.push(
                `<${el.tagName.toLowerCase()}${el.className ? " ." + String(el.className).split(" ")[0] : ""}> right=${Math.round(r.right)} > ${viewportW}`,
              );
              if (out.length >= 5) break;
            }
          }
          return out;
        });
        expect(
          offCanvas,
          `Content past the right edge on ${page.label} @ ${vp.width}px. ` +
            `body{overflow-x:hidden} hides this from scrollWidth, so it is measured ` +
            `per element:\n  ${offCanvas.join("\n  ")}`,
        ).toEqual([]);

        // ── Assertion 2: no JS errors on render ────────────────────
        expect(
          errors,
          `Uncaught JS errors on ${page.label}:\n  ${errors.join("\n  ")}`,
        ).toEqual([]);

        // ── Assertion 3: the page rendered ITSELF, not an error screen ──
        //
        // Assertion 2 cannot see a component that threw. `RouteErrorBoundary`
        // catches it and renders "This page hit a problem." — so nothing reaches
        // `page.on("pageerror")`, and the fallback then satisfies every other
        // check here: it has no horizontal scroll and nothing past the right
        // edge, because it is a small centred card.
        //
        // Measured 2026-09-21: a null dereference injected into the landing
        // hero's render left this spec GREEN at all five viewports. Twenty
        // public page-loads could not tell a working page from a crashed one.
        // Same shape as a route sweep grading its redirect destination — every
        // invariant passes, on the wrong screen.
        const errorScreen = await p.evaluate(() => {
          const text = document.body.innerText || "";
          for (const m of ["This page hit a problem.", "You're offline.", "We've logged it."]) {
            if (text.includes(m)) return m;
          }
          return null;
        });
        expect(
          errorScreen,
          `${page.label} rendered RouteErrorBoundary ("${errorScreen}") instead of the page. ` +
            `Every other assertion here passes on that fallback, so without this one a crashed ` +
            `route is indistinguishable from a healthy one.`,
        ).toBeNull();

        // ── Screenshot for visual review ───────────────────────────
        // Saved per-viewport-per-page so a regression on iPhone SE
        // landing is one click away in the CI artifact tree.
        await p.screenshot({
          path: `test-results/mobile/${vp.name}/${page.label}.png`,
          fullPage: true,
        });
      });
    }

    // REMOVED 2026-09-21: `landing — phone cluster fits viewport`.
    //
    // It targeted src/components/landing/PhoneCluster.tsx, which NO LONGER
    // EXISTS, by looking for the "46 active now" pill — a string that appears
    // nowhere in src/ any more. Its own comment admitted the selector was
    // "best-effort... doesn't have a stable test-id yet", and it handled a miss
    // with `test.skip(true, "…update selector")`.
    //
    // So it had been skipping on ALL FIVE viewports, in a spec that
    // mobile-viewports.yml runs in CI, which reported 20 passed / 5 skipped and
    // read as green. That is the worst shape a check can have: it disarms
    // itself in exactly the circumstance it exists to detect, because a layout
    // regression is what makes a selector stop matching. A check that goes
    // quiet when its target moves is worse than no check — the row is still
    // there, so the coverage looks real.
    //
    // Nothing is lost by deleting it. The overflow concern it named — the
    // landing page not fitting a narrow phone — is asserted directly and
    // without a fragile selector by `landing — no horizontal scroll, FAB
    // reachable` above, which runs at 320/375/414/768/1024 and passes.
  });
}
