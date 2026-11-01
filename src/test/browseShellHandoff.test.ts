/**
 * PERF-SHELL (Q652): the server-drawn /browse cards survive React's first commit (moved out of #boot-loader before
 * createRoot), only for a signed-out /browse visit, never longer than SHELL_MAX_MS, and DashboardGuest removes them
 * once its own feed has settled. One id across the renderer, the hand-off and the page.
 *
 * @mutate src/boot/browseShellHandoff.ts |   if (path !== "/browse" \|\| signedIn) { |   if (path !== "/browse") {
 * @mutate src/boot/browseShellHandoff.ts |   doc.body.appendChild(el); |   void doc.body;
 * @mutate src/boot/browseShellHandoff.ts |   setTimeout(() => el.remove(), SHELL_MAX_MS); |   void SHELL_MAX_MS;
 * @mutate src/pages/home/DashboardGuest.tsx |     if (shellCanGo) document.getElementById("lh-browse-shell")?.remove(); |     if (shellCanGo) void 0;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { adoptBrowseShell, BROWSE_SHELL_ELEMENT_ID, SHELL_MAX_MS } from "@/boot/browseShellHandoff";
import { BROWSE_SHELL_ID } from "@/lib/browseShellCards.mjs";

const page = () => {
  document.body.innerHTML = `<div id="root"><div id="boot-loader"><div id="${BROWSE_SHELL_ID}">cards</div></div></div>`;
};
const shell = () => document.getElementById(BROWSE_SHELL_ID);

describe("adoptBrowseShell", () => {
  afterEach(() => vi.useRealTimers());
  it("one id everywhere", () => {
    expect(BROWSE_SHELL_ELEMENT_ID).toBe(BROWSE_SHELL_ID);
    const guest = blankComments(readFileSync("src/pages/home/DashboardGuest.tsx", "utf8"));
    expect(guest.match(/document\.getElementById\("([^"]+)"\)\?\.remove\(\)/g)?.length).toBe(2);
    for (const m of guest.matchAll(/document\.getElementById\("([^"]+)"\)\?\.remove\(\)/g)) expect(m[1]).toBe(BROWSE_SHELL_ID);
  });
  it("signed-out /browse: moved to <body>, out of #root, then gone after SHELL_MAX_MS", () => {
    vi.useFakeTimers();
    for (const path of ["/browse", "/browse/"]) {
      page();
      adoptBrowseShell(path, false);
      expect(shell()?.parentElement, path).toBe(document.body);
      document.getElementById("root")!.innerHTML = ""; // what createRoot's first commit does
      expect(shell(), path).not.toBeNull();
      vi.advanceTimersByTime(SHELL_MAX_MS);
      expect(shell(), path).toBeNull();
    }
    expect(SHELL_MAX_MS).toBeLessThanOrEqual(10_000);
  });
  it("signed in, or any other page: removed at once", () => {
    for (const [path, signedIn] of [["/browse", true], ["/", false], ["/jobs", false]] as const) {
      page();
      adoptBrowseShell(path, signedIn);
      expect(shell(), `${path} ${signedIn}`).toBeNull();
    }
  });
  it("main.tsx adopts before the first createRoot, with the boot token probe", () => {
    const main = blankComments(readFileSync("src/main.tsx", "utf8"));
    const at = main.indexOf("adoptBrowseShell(window.location.pathname, tokenProbeAtBoot());");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(main.indexOf("createRoot(document.getElementById"));
  });
  it("DashboardGuest removes it once the feed has settled, in a layout effect", () => {
    const guest = blankComments(readFileSync("src/pages/home/DashboardGuest.tsx", "utf8")).replace(/\s+/g, " ");
    expect(guest).toContain('const shellCanGo = sessionChecked && (feedReady || phase === "offline-empty"); useLayoutEffect(() => { if (shellCanGo) document.getElementById("lh-browse-shell")?.remove(); }, [shellCanGo]);');
    // The page's own settled flag is the same condition (the footer waits on it).
    expect(guest).toContain('const feedSettled = feedReady || phase === "offline-empty";');
  });
});
