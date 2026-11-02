// Q2249: the /login loading skeleton must draw Login's board 37 card, not the old layout.
//
// LoginRouteSkeleton is the Suspense fallback for /login's lazy chunk. It cannot import AuthShell or Login (it has to
// stay in the entry chunk), so it copies their geometry. When board 37 (2026-10-20) moved Login to a max-w-sm column
// with no title row and an in-card "Log in" head under the H emblem (lg:p-8), the skeleton kept the old page-measure
// column, a [back] [Log In] row above the card and lg:p-10, so a cold /login load jumped and changed its heading.
// This reads both files (comments blanked) and pins every shared measurement together, so either side moving alone
// turns it red.
//
// @mutate src/components/LoginRouteSkeleton.tsx | <div className="w-full max-w-sm"> | <div className="w-full page-measure">
// @mutate src/pages/auth/Login.tsx | <div className="liquid-glass p-5 sm:p-6 lg:p-8 space-y-6"> | <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
// @mutate src/components/LoginRouteSkeleton.tsx | <h1 className="text-page-title text-foreground">Log in</h1> | <h1 className="text-page-title text-foreground">Log In</h1>
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(join(REPO, rel), "utf8"));
const LOGIN = read("src/pages/auth/Login.tsx");
const SKELETON = read("src/components/LoginRouteSkeleton.tsx");
const SHELL = read("src/components/auth/AuthShell.tsx");
const MARK = read("src/components/HelprMark.tsx");
const EN = read("src/lib/i18n/enScreens.ts");

/** Every className="liquid-glass …" string in a file. */
const glassCards = (src: string) => [...src.matchAll(/className="(liquid-glass[^"]*)"/g)].map((m) => m[1]);

describe("the /login skeleton draws Login's board 37 card (Q2249)", () => {
  const shellTag = /<AuthShell\b([^>]*)>/.exec(LOGIN);

  it("uses Login's AuthShell column width and no title row above the card", () => {
    expect(shellTag, "Login renders <AuthShell …>").not.toBeNull();
    const props = shellTag![1];
    const width = /maxWidth="(\w+)"/.exec(props)?.[1] ?? "lg";
    const map = /const widthMap[^{]*\{([\s\S]*?)\};/.exec(SHELL)?.[1] ?? "";
    const cls = new RegExp(`(?:^|[\\s,])"?${width}"?:\\s*"([^"]+)"`, "m").exec(map)?.[1];
    expect(cls, `AuthShell widthMap has ${width}`).toBeTruthy();
    expect(SKELETON).toContain(`<div className="w-full ${cls}">`);
    // Login passes no title, so AuthShell draws no [back] [title] row; the skeleton must not draw one either.
    expect(props).not.toMatch(/\btitle=/);
    expect(props).toMatch(/\bhideBack\b/);
    expect(SKELETON).not.toContain("text-headline-hero");
  });

  it("draws the same liquid-glass card, with the same padding scale", () => {
    const login = glassCards(LOGIN);
    const skeleton = glassCards(SKELETON);
    expect(login).toHaveLength(1);
    expect(skeleton).toEqual(login);
  });

  it("heads the card like Login: the H emblem's height, the same stack, the same h1 and its words", () => {
    const head = /<div className="([^"]+)" data-testid="login-card-head">/.exec(LOGIN)?.[1];
    expect(head).toBeTruthy();
    expect(SKELETON).toContain(`<div className="${head}">`);

    const mark = /<HelprMark\b[^>]*size="(\w+)"[^>]*emblemOnly[^>]*\/>/.exec(LOGIN)?.[1];
    expect(mark, "Login's card head uses an emblem-only HelprMark").toBeTruthy();
    const h = new RegExp(`emblemSizeMap\\s*=\\s*\\{[^}]*\\b${mark}:\\s*"(h-\\d+)"`).exec(MARK)?.[1];
    expect(h).toBeTruthy();
    expect(SKELETON).toMatch(new RegExp(`<Skeleton className="${h} `));

    const loginH1 = /\{!mfaChallenge && \([\s\S]*?<h1 className="([^"]+)">\{t\("login\.title"\)\}<\/h1>/.exec(LOGIN)?.[1];
    expect(loginH1).toBeTruthy();
    const title = /"login\.title":\s*"([^"]+)"/.exec(EN)?.[1];
    expect(title).toBe("Log in");
    expect(SKELETON).toContain(`<h1 className="${loginH1}">${title}</h1>`);
    // Exactly one h1 during the load, as after it.
    expect(SKELETON.match(/<h1\b/g)).toHaveLength(1);
  });

  it("pins a non-trivial number of measurements", () => {
    // Floor: column, card, head stack, emblem, h1 class and words.
    const pinned = [shellTag, glassCards(SKELETON)[0], /data-testid="login-card-head"/.exec(LOGIN), /emblemSizeMap/.exec(MARK)];
    expect(pinned.filter(Boolean).length).toBeGreaterThan(3);
  });
});
