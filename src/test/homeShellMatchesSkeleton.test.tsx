/**
 * Q2705 B (lead 11-05: "A+B now"; owner rule: every page under 2 s). On a Slow 4G phone a signed-in /home showed only
 * the index.html boot logo until the whole app had arrived: live 11-05, 375 px, Slow 4G + 4x, LCP 4284 ms, the app
 * drawn at ~4.1 s (Q1158 lab notes). The auth pages already paint from the HTML (authShellsMatchPages.test.tsx); this
 * does the same for a signed-in phone opening /home, with Home's OWN route skeleton (never a hand-rolled one).
 *
 * index.html carries #lh-home-shell, exactly what DashboardRouteSkeleton renders at a phone width. This renders the
 * same tree and requires the block to be that markup, so a change to the skeleton turns this red until the block is
 * rewritten from the source:
 *   LH_WRITE_HOME_SHELL=1 npx vitest run src/test/homeShellMatchesSkeleton.test.tsx
 * It also pins the inline script that shows it (/home, a stored session, web, under 900px), the show rule, that
 * main.tsx drops it when not shown, that HomeDashboard takes it away once painted and the app on any other route, and
 * that the build inlines its CSS.
 *
 * @mutate src/pages/home/HomeDashboard.tsx |   useEffect(() => removeShellOncePainted(HOME_SHELL_ID), []); |
 * @mutate src/components/landing/HomeShellLeaves.tsx | !== "/home") document.getElementById(HOME_SHELL_ID)?.remove(); | === "/x") document.getElementById(HOME_SHELL_ID)?.remove();
 * @mutate src/components/DashboardRouteSkeleton.tsx | <Skeleton className="h-8 w-56 max-w-full rounded-ds-md" /> | <Skeleton className="h-9 w-56 max-w-full rounded-ds-md" />
 * @mutate index.html |         if (!stored) return; |
 * @mutate index.html | window.innerWidth >= 900) return; | window.innerWidth >= 9000) return;
 * @mutate index.html |         if (location.search \|\| location.hash \|\| window.Capacitor |         if (window.Capacitor
 * @mutate src/index.css | [data-lh-app-shell="home"] #lh-home-shell {\n  display: block; | [data-lh-app-shell="home"] #lh-home-shell {\n  display: none;
 * @mutate src/components/RouteErrorBoundary.tsx |     dropHomeShell();\n |\n
 * @mutate src/components/ErrorBoundary.tsx |     dropHomeShell();\n |\n
 * @mutate src/components/ProtectedRoute.tsx |   useEffect(() => { if (ownScreenInstead) dropHomeShell(); }, [ownScreenInstead]); |
 * @mutate src/main.tsx | if (document.documentElement.getAttribute("data-lh-app-shell") !== "home") document.getElementById("lh-home-shell")?.remove(); |
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LucideProvider } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import DashboardRouteSkeleton from "@/components/DashboardRouteSkeleton";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn(), logError: vi.fn() }));
import { blankComments } from "./helpers/blankNonCode";
import { inlineShellCss, SHELL_END } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const START = '<div id="lh-home-shell" aria-hidden="true" inert data-lh-shell="start">';

function rendered(): string {
  // A phone: AppShell and the skeleton read the desktop query on their first render; the shell is shown under 900px.
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
          <MemoryRouter initialEntries={["/home"]}>
            <DashboardRouteSkeleton />
          </MemoryRouter>
        </LucideProvider>
      </QueryClientProvider>,
    );
  } finally {
    window.matchMedia = mm;
  }
}

function block(html: string): string {
  const a = html.indexOf(START);
  expect(a, "index.html has the home shell").toBeGreaterThan(-1);
  const b = html.indexOf(SHELL_END, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + START.length, b);
}

const showScript = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-app-shell")) ?? "";

describe("a signed-in phone's /home paints Home's own skeleton from the HTML (Q2705 B)", () => {
  it("index.html's home block is byte-for-byte what DashboardRouteSkeleton renders at a phone width", () => {
    const want = rendered();
    let html = readFileSync(INDEX, "utf8");
    if (process.env.LH_WRITE_HOME_SHELL === "1") {
      const a = html.indexOf(START) + START.length;
      html = html.slice(0, a) + want + html.slice(html.indexOf(SHELL_END, a));
      writeFileSync(INDEX, html);
    }
    expect(block(html)).toBe(want);
    expect(want.length).toBeGreaterThan(2000);
    expect(want).toContain('data-testid="dashboard-route-skeleton"');
    expect(want).toContain('data-skeleton-part="next-up"');
  });

  it("is shown only on /home, with a stored session, on the phone web, and removed after 10 s at most", () => {
    const src = showScript(readFileSync(INDEX, "utf8"));
    expect(src).not.toBe("");
    type Opts = { search?: string; hash?: string; capacitor?: boolean; protocol?: string; width?: number; throws?: boolean };
    const run = (pathname: string, keys: string[] = ["sb-proj-auth-token"], o: Opts = {}) => {
      const attrs: [string, string][] = [];
      const timers: number[] = [];
      const store = o.throws
        ? { get length(): number { throw new Error("blocked"); }, key: () => null }
        : { length: keys.length, key: (i: number) => keys[i] ?? null };
      new Function("document", "location", "localStorage", "window", "setTimeout", src)(
        { documentElement: { setAttribute: (n: string, v: string) => attrs.push([n, v]) }, getElementById: () => null },
        { pathname, search: o.search ?? "", hash: o.hash ?? "", protocol: o.protocol ?? "https:" },
        store,
        { innerWidth: o.width ?? 375, ...(o.capacitor ? { Capacitor: {} } : {}) },
        (_: unknown, ms: number) => timers.push(ms),
      );
      return { shown: attrs.find(([n]) => n === "data-lh-app-shell")?.[1] ?? null, timers };
    };
    expect(run("/home")).toEqual({ shown: "home", timers: [10000] });
    expect(run("/home/").shown).toBe("home");
    expect(run("/home", ["helpr_lang", "sb-abc-auth-token"]).shown).toBe("home");
    expect(run("/home", []).shown, "a guest is sent to sign in").toBeNull();
    expect(run("/home", ["helpr_lang", "sb-abc-auth-token-code-verifier"]).shown, "not a session").toBeNull();
    expect(run("/home", [], { throws: true }).shown, "storage blocked").toBeNull();
    for (const p of ["/", "/login", "/homes", "/home/x"]) expect(run(p).shown, p).toBeNull();
    expect(run("/home", undefined, { width: 900 }).shown, "the desktop website has its rail and bar").toBeNull();
    expect(run("/home", undefined, { width: 899 }).shown).toBe("home");
    expect(run("/home", undefined, { search: "?job=1" }).shown, "a query can forward to the feed").toBeNull();
    expect(run("/home", undefined, { hash: "#x" }).shown).toBeNull();
    expect(run("/home", undefined, { capacitor: true }).shown, "native app").toBeNull();
    expect(run("/home", undefined, { protocol: "capacitor:" }).shown, "native app").toBeNull();

    const index = readFileSync(INDEX, "utf8");
    expect(index).toMatch(/#lh-login-shell,\s*#lh-signup-shell,\s*#lh-home-shell \{\s*display: none;\s*\}/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-app-shell="home"\] #lh-home-shell \{\s*display: block;\s*position: fixed;/);
  });

  it("main.tsx drops it when not shown; HomeDashboard takes it away once painted, and the app off /home", () => {
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('if (document.documentElement.getAttribute("data-lh-app-shell") !== "home") document.getElementById("lh-home-shell")?.remove();');
    const home = blankComments(readFileSync(join(ROOT, "src/pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("useEffect(() => removeShellOncePainted(HOME_SHELL_ID), []);");
    const leaves = blankComments(readFileSync(join(ROOT, "src/components/landing/HomeShellLeaves.tsx"), "utf8"));
    expect(leaves).toContain('if ((pathname.replace(/\\/+$/, "") || "/") !== "/home") document.getElementById(HOME_SHELL_ID)?.remove();');
    const helper = blankComments(readFileSync(join(ROOT, "src/components/landing/homeShell.ts"), "utf8"));
    expect(helper).toContain('export const HOME_SHELL_ID = "lh-home-shell";');
    const app = blankComments(readFileSync(join(ROOT, "src/App.tsx"), "utf8"));
    expect(app).toContain("<HomeShellLeaves />");
  });

  it("the build inlines its CSS and show rule with the other shells'", () => {
    const sheet = [".page-measure{max-width:40rem}", ".app-top-bar{height:4rem}", ".unused-anywhere-xyz{color:red}"].join("");
    const { html } = inlineShellCss(readFileSync(INDEX, "utf8"), sheet);
    const at = html.indexOf('<style id="lh-shell-css">');
    const css = html.slice(at, html.indexOf("</style>", at));
    expect(css, "Home's frame, absent from the landing and auth shells").toContain(".page-measure{max-width:40rem}");
    expect(css).not.toContain("unused-anywhere-xyz");
    expect(css).toContain('[data-lh-app-shell="home"] #lh-home-shell{display:block;position:fixed;inset:0;');
  });

  it("an error card at /home takes the skeleton away (the route boundary, the app boundary, ProtectedRoute's own screens)", () => {
    const shell = document.createElement("div");
    shell.id = "lh-home-shell";
    document.body.appendChild(shell);
    const Boom = () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <MemoryRouter initialEntries={["/home"]}>
          <RouteErrorBoundary>
            <Boom />
          </RouteErrorBoundary>
        </MemoryRouter>,
      );
    } finally {
      spy.mockRestore();
    }
    expect(document.getElementById("lh-home-shell"), "RouteErrorBoundary's card is not covered by the bones").toBeNull();

    const app = blankComments(readFileSync(join(ROOT, "src/components/ErrorBoundary.tsx"), "utf8"));
    expect(app).toMatch(/componentDidCatch\(error: Error, errorInfo: React\.ErrorInfo\) \{\s*dropHomeShell\(\);/);
    const route = blankComments(readFileSync(join(ROOT, "src/components/RouteErrorBoundary.tsx"), "utf8"));
    expect(route).toMatch(/componentDidCatch\(error: Error, errorInfo: React\.ErrorInfo\) \{\s*dropHomeShell\(\);/);
    const guard = blankComments(readFileSync(join(ROOT, "src/components/ProtectedRoute.tsx"), "utf8"));
    expect(guard).toContain("const ownScreenInstead = showingProfileError || !!profile?.under_13_blocked_at;");
    expect(guard).toContain("useEffect(() => { if (ownScreenInstead) dropHomeShell(); }, [ownScreenInstead]);");
  });
});
