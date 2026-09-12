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
 * KNOWN OFFENDERS — pages that hand-roll `min-h-screen` instead of using a
 * shell. This list must only ever SHRINK. It exists so the gate can be turned
 * on today without a risky same-day rewrite of two large screens, not to
 * excuse them: both were found by this test the first time it ran, which is
 * the whole point.
 *
 * Deleting an entry is the fix. Adding one is not allowed — a new page has no
 * reason to be here, and the assertion below says so.
 */
const KNOWN_OFFENDERS = new Set([
  "Admin.tsx",       // hand-rolled `min-h-screen` + its own sidebar layout
  "UserProfile.tsx", // hand-rolled `min-h-screen bg-premium-page pb-safe-nav`
]);

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
      if (!usesShell && !KNOWN_OFFENDERS.has(file)) offenders.push(file);
    }
    expect(
      offenders,
      `These pages render no shared shell. Use one of ${ALLOWED_SHELLS.join(", ")} — ` +
        `or, if a page genuinely renders no UI, add it to NO_SHELL_BY_DESIGN with a reason:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("the known-offenders list only shrinks", () => {
    // A page listed here that HAS since been fixed must be removed from the
    // list, or the exemption silently outlives the problem and the next page
    // to regress hides behind it.
    const stillBroken = [...KNOWN_OFFENDERS].filter((file) => {
      const path = join(PAGES_DIR, file);
      if (!existsSync(path)) return false;
      const src = readFileSync(path, "utf8");
      return !ALLOWED_SHELLS.some((shell) => new RegExp(`<${shell}[\\s/>]`).test(src));
    });
    expect(
      [...KNOWN_OFFENDERS].filter((f) => !stillBroken.includes(f)),
      "These pages now use a shell — delete them from KNOWN_OFFENDERS so the " +
        "exemption cannot cover a future regression.",
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
