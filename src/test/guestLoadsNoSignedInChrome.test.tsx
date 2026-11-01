/**
 * A signed-out visitor downloads no signed-in chrome (owner, 2026-10-30: "nothing
 * should ever be slow for users"). A lazy chunk is fetched the moment it renders,
 * even if the component then returns null, so mounting the dock and its siblings
 * for a guest pulled signed-in-shared, signed-in-deep and Sentry onto /browse:
 * 24 extra files, ~200 KB gzip (Lighthouse run 41080594282).
 *
 * Inventory from source: every `lazy(` component App.tsx renders beside the routes
 * (outside <Routes>, so it mounts on every page). Each is either inside a
 * SignedInChrome/SignedInOnly gate or named in EVERY_VISITOR with the reason.
 *
 * @mutate src/App.tsx | <MobileNav /> | </Suspense></SignedInChrome><MobileNav /><SignedInChrome><Suspense fallback={null}>
 * @mutate src/components/DeferredToasters.tsx | <SignedInOnly>\n        <SuccessMomentHost />\n      </SignedInOnly> | <SuccessMomentHost />
 * @mutate src/components/SignedInChrome.tsx | return !!user \|\| (isLoading && maybeSignedIn); | return true;
 * @mutate src/components/SignedInChrome.tsx | classList.add("no-bottom-nav") | classList.add("no-bottom-nav-off")
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { SignedInChrome, SignedInOnly } from "@/components/SignedInChrome";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, isLoading: false, hint: false }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: auth.user, isLoading: auth.isLoading }),
}));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => auth.hint }));

/** Lazy components that DO draw for a guest, or that route the visitor. */
const EVERY_VISITOR: Record<string, string> = {
  ScrollToTop: "scroll restoration for every visitor",
  PermissionRationaleMount: "anyone can be asked for a device permission",
};

const app = blankComments(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"));

/** App's beside-the-routes region: from the app shell's first mount to </AppLockGate>. */
const shell = app.slice(app.indexOf("<OfflineBannerLayoutProvider>"), app.indexOf("</OfflineBannerLayoutProvider>"));
const lazyNames = [...app.matchAll(/^const (\w+) = lazy\(/gm)].map((m) => m[1]);
const mounted = lazyNames.filter((n) => new RegExp(`<${n}\\s*/>`).test(shell));
const gated = [...shell.matchAll(/<(SignedInChrome|SignedInOnly)>([\s\S]*?)<\/\1>/g)].map((m) => m[2]).join("\n");

describe("App mounts no signed-in chunk for a guest", () => {
  it("finds the mounts it is checking", () => {
    expect(shell.length).toBeGreaterThan(200);
    expect(mounted.length).toBeGreaterThan(8);
  });

  it.each(mounted)("%s is gated, or says why every visitor needs it", (name) => {
    const inGate = new RegExp(`<${name}\\s*/>`).test(gated);
    expect(inGate, `${name} is both gated and listed in EVERY_VISITOR`).not.toBe(name in EVERY_VISITOR);
  });

  it("EVERY_VISITOR names only mounts that exist", () => {
    for (const name of Object.keys(EVERY_VISITOR)) expect(mounted).toContain(name);
  });

  it("the win-beat host (which imports signed-in-shared) waits for a signed-in visitor too", () => {
    const toasters = blankComments(readFileSync(resolve(process.cwd(), "src/components/DeferredToasters.tsx"), "utf8"));
    expect(toasters).toMatch(/<SignedInOnly>\s*<SuccessMomentHost \/>\s*<\/SignedInOnly>/);
  });
});

describe("the gate", () => {
  const Child = () => <p>chrome</p>;
  const html = document.documentElement;

  beforeEach(() => {
    auth.user = null;
    auth.isLoading = false;
    auth.hint = false;
    html.classList.remove("no-bottom-nav");
  });

  it.each([
    ["a guest, auth settled", null, false, false, false],
    ["a guest, auth still resolving: no token means no fetch", null, true, false, false],
    ["a stored token while auth resolves", null, true, true, true],
    ["a stale token once auth says nobody", null, false, true, false],
    ["a signed-in person", { id: "u" }, false, true, true],
    ["a signed-in person whose stored token was not readable", { id: "u" }, false, false, true],
  ])("%s", (_label, user, isLoading, hint, drawn) => {
    auth.user = user;
    auth.isLoading = isLoading;
    auth.hint = hint;
    const a = render(<SignedInChrome><Child /></SignedInChrome>);
    expect(screen.queryAllByText("chrome").length).toBe(drawn ? 1 : 0);
    expect(html.classList.contains("no-bottom-nav")).toBe(!drawn);
    a.unmount();
    const b = render(<SignedInOnly><Child /></SignedInOnly>);
    expect(screen.queryAllByText("chrome").length).toBe(drawn ? 1 : 0);
    b.unmount();
  });

  it("gives the dock clearance back when someone signs in, so the dock can claim it", () => {
    const { rerender } = render(<SignedInChrome><Child /></SignedInChrome>);
    expect(html.classList.contains("no-bottom-nav")).toBe(true);
    auth.user = { id: "u" };
    rerender(<SignedInChrome><Child /></SignedInChrome>);
    expect(html.classList.contains("no-bottom-nav")).toBe(false);
  });
});
