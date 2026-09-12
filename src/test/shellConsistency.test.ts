import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY ROUTED PAGE RENDERS THROUGH A SHARED SHELL. No exceptions without a
 * reason written here.
 *
 * The owner has asked for this repeatedly, in these words: "THEY SHIULD ALL BE
 * THE SAME EVERY SINGLIE FUCKING ONE". It kept being re-asked because nothing
 * enforced it — a page could hand-roll its own frame and every gate stayed
 * green, so the drift was only ever caught by a human noticing that one screen
 * looked different from its neighbours. That is not a check, it is a tax on
 * the owner's attention.
 *
 * DERIVED FROM THE WORLD, NOT FROM A LIST. The set of pages under test comes
 * from what `App.tsx` actually imports, so adding a page adds a case
 * automatically. CLAUDE.md records this trap three times over: a registry that
 * is both a test's input AND its definition of correctness cannot fail for a
 * missing member. The ALLOWED shells are a list; the pages checked against
 * them are not.
 *
 * It also catches the inverse, which is how this got confusing: a page file
 * that exists, imports a shell, and is routed by nothing. Seven of those were
 * found on 2026-09-11 (AutoTip, HelprWrapped, HomeHistory, PetProfiles,
 * StrSettings, HelperAnalytics, WorkRecord) — every one a leftover from the
 * move to Profile tabs, and every one still readable by an auditor who would
 * reasonably believe they were live.
 */

const PAGES_DIR = join(process.cwd(), "src/pages");
const APP_TSX = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

/**
 * The approved shells. A page must render one of these — they are what own the
 * viewport lock, the safe-area insets, the scroll container and the bottom-nav
 * clearance, and re-implementing any of that per page is what CLAUDE.md's
 * "never hand-roll anything" rule exists to stop.
 */
const ALLOWED_SHELLS = [
  "AppShell",        // the one fixed-viewport primitive
  "PageScaffold",    // AppShell + the two-card layout
  "AppPage",         // AppShell + ProfileTabHeader
  "PublicHeaderPage", // PublicLayout + PageHeader (legal, help, support)
  "PublicLayout",    // marketing chrome
  "AuthShell",       // the signed-out / account-state card treatment
] as const;

/**
 * Pages that legitimately render no shell, each with the reason. Anything not
 * here MUST use a shell — that is the point of the file.
 */
const NO_SHELL_BY_DESIGN: Record<string, string> = {
  "ActivityLegacyRedirect.tsx": "renders <Navigate>, never any UI",
  "ShortLinkRedirect.tsx": "renders <Navigate>, never any UI",
  "Messages.tsx": "delegates entirely to ConversationList / ChatView, each of which owns a shell",
};

/**
 * DOCUMENT-SCROLL PAGES ARE NOT OFFENDERS — they are the other correct answer.
 *
 * This file used to carry a KNOWN_OFFENDERS set naming Admin.tsx and
 * UserProfile.tsx as debt, because they hand-roll `min-h-screen` instead of
 * rendering a shell. That was wrong, and dangerously so. CLAUDE.md defines TWO
 * legitimate page shapes, not one: fixed-shell pages build on AppShell, and
 * document-scroll pages use "a plain `min-h-screen bg-premium-page pb-safe-nav`
 * wrapper" and explicitly "do NOT use AppShell". Both `/admin` and `/user` are
 * in DOCUMENT_SCROLL_ROUTES. They were never offenders; ALLOWED_SHELLS simply
 * had no entry for the category they belong to, so the test manufactured two.
 *
 * The danger was not the false positive, it was the framing. The old comment
 * said the list "must only ever SHRINK" and that "deleting an entry is the
 * fix", which points the next reader at wrapping both pages in AppShell — and
 * that BREAKS them twice over: `html.app-shell { overflow: hidden }` would clip
 * everything below the fold on a page that is taller than the viewport by
 * design, and the shell's rail inset would land on top of the one
 * `html.web-desktop.desktop-rail:not(.app-shell) #root` already applies,
 * shoving the column over by a second rail width (the PostJob bug). An
 * exemption list that reads as a to-do list is worse than no list at all.
 *
 * So the category is DERIVED FROM THE WORLD, the same way the page set is: a
 * page is allowed to render no shell when the route that reaches it is in
 * DOCUMENT_SCROLL_ROUTES and it renders the documented wrapper. Nothing is
 * exempt by name, so nothing can outlive its reason — and a page that drops out
 * of DOCUMENT_SCROLL_ROUTES starts failing here immediately, which is exactly
 * the coupling CLAUDE.md asks for when it says a page's shell choice and its
 * entry in that list must agree.
 */
const VIEWPORT_HOOK = readFileSync(
  join(process.cwd(), "src/hooks/useAppShellViewport.ts"),
  "utf8",
);

/**
 * The route strings inside DOCUMENT_SCROLL_ROUTES, read from the hook itself.
 *
 * Comments are stripped FIRST. That list is more comment than code — each entry
 * carries a paragraph explaining why it is there — and several of those
 * paragraphs quote OTHER route names in double quotes. A naive string scan
 * therefore reports routes that are not on the list at all, which is how
 * "/profile" first appeared here: it is named in a comment saying the six
 * settings sub-pages left the list, and nowhere else.
 */
function documentScrollRoutes(): string[] {
  const body = VIEWPORT_HOOK.slice(
    VIEWPORT_HOOK.indexOf("DOCUMENT_SCROLL_ROUTES = ["),
  );
  const list = body
    .slice(0, body.indexOf("];"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Routes that keep the app shell on NATIVE while scrolling the document on web.
 * DashboardGuest and Legal both branch on `isNativePlatform` and render a fixed
 * shell on one side of it, so their presence in DOCUMENT_SCROLL_ROUTES is the
 * design, not a disagreement.
 */
function nativeAppShellRoutes(): string[] {
  const m = /NATIVE_APP_SHELL_ROUTES = \[([^\]]*)\]/.exec(VIEWPORT_HOOK);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/**
 * Page file -> the route paths App.tsx mounts it at.
 *
 * Line-based on purpose. A `<Route … />` regex spanning the element looks
 * obvious and is wrong: every route here nests self-closing components
 * (`<Admin />`) inside the element prop, so a non-greedy match to the first
 * `/>` ends INSIDE the element and consumes the very token you then test for.
 * One `<Route>` is always one line in this file, so the line is the unit.
 */
function routePathsForPage(file: string): string[] {
  const component = file.replace(/\.tsx$/, "");
  const mounted = new RegExp(`<${component}\\s*/>`);
  return APP_TSX.split("\n")
    .filter((line) => line.includes("<Route path=") && mounted.test(line))
    .map((line) => /<Route\s+path="([^"]+)"/.exec(line)?.[1])
    .filter((p): p is string => !!p);
}

/**
 * The documented document-scroll wrapper. `min-h-screen` is the load-bearing
 * half; the page must also paint the page canvas rather than inherit nothing.
 */
const DOC_SCROLL_WRAPPER = /min-h-screen[^"'`]*bg-premium-page|bg-premium-page[^"'`]*min-h-screen/;

function isLegitimateDocumentScrollPage(file: string, src: string): boolean {
  if (!DOC_SCROLL_WRAPPER.test(src)) return false;
  const docRoutes = documentScrollRoutes();
  return routePathsForPage(file).some((path) =>
    docRoutes.some((r) => path === r || path.startsWith(r + "/")),
  );
}


/** Page files imported by App.tsx — i.e. the ones a user can actually reach. */
function routedPageFiles(): string[] {
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .filter((f) => {
      const name = f.replace(/\.tsx$/, "");
      // Matches both `import X from "./pages/Name"` and the lazy form
      // `lazyWithPreload(() => import("./pages/Name"))`.
      return new RegExp(`pages/${name}["']`).test(APP_TSX);
    });
}

describe("shell consistency", () => {
  it("every routed page renders through a shared shell", () => {
    const offenders: string[] = [];
    for (const file of routedPageFiles()) {
      if (file in NO_SHELL_BY_DESIGN) continue;
      const src = readFileSync(join(PAGES_DIR, file), "utf8");
      const usesShell = ALLOWED_SHELLS.some((shell) =>
        new RegExp(`<${shell}[\\s/>]`).test(src),
      );
      if (usesShell) continue;
      if (isLegitimateDocumentScrollPage(file, src)) continue;
      offenders.push(file);
    }
    expect(
      offenders,
      `These pages render no shared shell. Use one of ${ALLOWED_SHELLS.join(", ")} — ` +
        `or, if a page genuinely renders no UI, add it to NO_SHELL_BY_DESIGN with a reason:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("a page's shell choice and DOCUMENT_SCROLL_ROUTES agree", () => {
    // CLAUDE.md: "A page's shell choice and its entry in that list must agree."
    // The failure this catches is one-directional and silent: a fixed-shell
    // page whose route is ALSO in DOCUMENT_SCROLL_ROUTES gets no viewport lock
    // (the hook withholds `html.app-shell`), so AppShell's 100dvh frame and the
    // bottom-nav clearance both stop applying and the page quietly scrolls the
    // document instead. Nothing errors; it just stops being the shell it says
    // it is.
    const docRoutes = documentScrollRoutes();
    const nativeShell = nativeAppShellRoutes();
    const disagreements: string[] = [];
    for (const file of routedPageFiles()) {
      if (file in NO_SHELL_BY_DESIGN) continue;
      const src = readFileSync(join(PAGES_DIR, file), "utf8");
      // AuthShell is the documented exception: it is a shell AND it scrolls the
      // document, so its routes belong on the list by design.
      if (/<AuthShell[\s/>]/.test(src)) continue;
      const usesShell = ALLOWED_SHELLS.some((shell) =>
        new RegExp(`<${shell}[\\s/>]`).test(src),
      );
      if (!usesShell) continue;
      // PublicLayout / PublicHeaderPage are marketing chrome and scroll the
      // document too — the lock only matters for the AppShell family.
      if (!/<(AppShell|PageScaffold|AppPage)[\s/>]/.test(src)) continue;
      for (const path of routePathsForPage(file)) {
        if (nativeShell.includes(path)) continue;
        if (docRoutes.some((r) => path === r || path.startsWith(r + "/"))) {
          disagreements.push(`${file} renders a fixed shell but ${path} is in DOCUMENT_SCROLL_ROUTES`);
        }
      }
    }
    expect(
      disagreements,
      "A fixed-shell page whose route is in DOCUMENT_SCROLL_ROUTES never gets " +
        "the viewport lock, so its shell silently stops working:\n" +
        disagreements.map((d) => `  - ${d}`).join("\n"),
    ).toEqual([]);
  });

  it("no page file is left behind, importing a shell but routed by nothing", () => {
    const all = readdirSync(PAGES_DIR).filter(
      (f) => f.endsWith(".tsx") && !f.includes(".test."),
    );
    const routed = new Set(routedPageFiles());
    const orphans = all.filter((f) => {
      if (routed.has(f)) return false;
      const src = readFileSync(join(PAGES_DIR, f), "utf8");
      // Only flag files that LOOK like pages — one that renders a shell is
      // claiming to be a screen, so an auditor will read it as live.
      return ALLOWED_SHELLS.some((shell) => new RegExp(`<${shell}[\\s/>]`).test(src));
    });
    expect(
      orphans,
      "These files render a page shell but no route reaches them, so they are dead " +
        "code that still reads as live to anyone auditing the app. Delete them, or " +
        "route them:\n" + orphans.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("the shells it names actually exist", () => {
    // Guards the list above against a rename silently turning every assertion
    // into a no-op — the failure mode where a check passes because it is
    // looking for something that no longer exists anywhere.
    const missing = ALLOWED_SHELLS.filter((shell) => {
      const candidates = [
        `src/components/${shell}.tsx`,
        `src/components/ui/${shell}.tsx`,
        `src/components/marketing/${shell}.tsx`,
        `src/components/auth/${shell}.tsx`,
      ];
      return !candidates.some((c) => existsSync(join(process.cwd(), c)));
    });
    expect(missing, `ALLOWED_SHELLS names components that do not exist: ${missing.join(", ")}`).toEqual([]);
  });
});
